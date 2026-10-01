/**
 * The screen: which of a niche's stored companies are no buyer, and why. Import
 * declines what one file shows (closed places, chains inside the file); the screen
 * sees every stored company of the niche at once, across files and sources.
 *
 * A decline is a reason on the row (`companies.decline_reason`), never a delete: the
 * row, its raw and its leads stay, and every stage that researches, verifies or
 * writes skips it. Each run recomputes every verdict, so a loosened rule lifts its
 * declines. It also fills a blank country from the stored import row.
 *
 * Order: platform site, public body, foreign, the niche's own rule, chain.
 */
import type { Queryable } from "@wren/db";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { isPlatformDomain, registrableDomain } from "../emails.js";
import { type Company, companies } from "../schema.js";
import { ISO_ALPHA2, normalizeCountry } from "./countries.js";
import { PUBLIC_BODY } from "./overture.js";

/** The firms still in play: every stage that researches, verifies or writes selects with it. */
export const inPlay = isNull(companies.declineReason);

export type ScreenedCompany = Pick<Company, "id" | "domain" | "name" | "country" | "raw">;

export interface CompanyScreen {
  /** Countries the niche sells to (ISO alpha-2). A firm known to be elsewhere is declined. */
  readonly countries: readonly string[];
  /** Places under one registered domain that make a chain (branch subdomains count). */
  readonly chainAt: number;
  /** The niche's own rule: a reason, or null. */
  readonly decline?: (company: ScreenedCompany) => string | null;
}

/** A legal-entity suffix or a staffing word: a business, whatever else its name says. */
const COMMERCIAL =
  /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|ltd|limited|lp|llp|pllc|plc)\b|staffing|recruit|personnel|placement|talent|\btemps?\b/i;

export const isCommercialName = (name: string): boolean => COMMERCIAL.test(name);

const GOVERNMENT_NAME = new RegExp(
  [
    "\\b(state|county|city|commonwealth|province|government|ministry|municipality|village|township|borough|parish) of\\b",
    "^[a-z.' -]{2,40} county$",
    "\\b(department|dept\\.?) (of|employment)\\b",
    "\\b(state|government) (offices|agency|department)\\b",
    "school district|\\bunified school\\b|\\bpublic (library|schools?)\\b",
    "employment security|mayor'?s office|human (resources|services) administration",
    "\\bcounty (human|social) services?\\b|\\bdss\\b",
  ].join("|"),
  "i",
);

/** A government office by its name ("County of X", "Department of Labor"), never a firm with "LLC". */
export const publicBodyName = (name: string): boolean =>
  GOVERNMENT_NAME.test(name) && !isCommercialName(name);

/** Country-code domains used worldwide as generic names: they say nothing about where a firm is. */
const GENERIC_CCTLDS = new Set([
  "ai",
  "cc",
  "co",
  "fm",
  "gg",
  "io",
  "la",
  "ly",
  "me",
  "sh",
  "so",
  "to",
  "tv",
  "ws",
]);

/** The country a domain's ending names (`.uk` → GB), or null for generic and global endings. */
export function domainCountry(domain: string): string | null {
  const tld = domain.slice(domain.lastIndexOf(".") + 1).toLowerCase();
  if (tld.length !== 2 || GENERIC_CCTLDS.has(tld)) return null;
  const code = tld === "uk" ? "GB" : tld.toUpperCase();
  return ISO_ALPHA2.has(code) ? code : null;
}

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Places the import saw at this firm's domain: `places_with_domain` when a source counted them. */
function placesOf(raw: unknown): number {
  const n = Number(record(raw)?.places_with_domain);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** The parent domain's chain size: firms stored under it, or the most places one source counted. */
export function chainSizes(
  rows: readonly Pick<ScreenedCompany, "domain" | "raw">[],
): Map<string, number> {
  const firms = new Map<string, number>();
  const places = new Map<string, number>();
  for (const r of rows) {
    if (!r.domain) continue;
    const parent = registrableDomain(r.domain);
    firms.set(parent, (firms.get(parent) ?? 0) + 1);
    places.set(parent, Math.max(places.get(parent) ?? 0, placesOf(r.raw)));
  }
  for (const [parent, n] of places) firms.set(parent, Math.max(firms.get(parent) ?? 0, n));
  return firms;
}

/** One firm's verdict, given the chain sizes of every parent domain in the niche. */
export function screenCompany(
  company: ScreenedCompany,
  screen: CompanyScreen,
  chains: ReadonlyMap<string, number>,
): string | null {
  const { domain, name, country } = company;
  // A job board or social page: no firm to research there, and no address to write.
  if (domain && isPlatformDomain(domain)) return "platform_site";
  if ((domain && PUBLIC_BODY.test(domain)) || (name && publicBodyName(name))) return "public_body";
  for (const where of [country, domain ? domainCountry(domain) : null])
    if (where && !screen.countries.includes(where)) return "foreign";
  const own = screen.decline?.(company);
  if (own) return own;
  if (domain && (chains.get(registrableDomain(domain)) ?? 0) >= screen.chainAt) return "chain";
  return null;
}

export interface ScreenStats {
  companies: number;
  /** Blank countries filled from the stored import row. */
  country_filled: number;
  /** Firms declined now, by reason. */
  declined: Record<string, number>;
  /** Verdicts that changed this run (new declines and lifted ones). */
  changed: number;
}

const PAGE = 2000;

function push<K>(groups: Map<K, number[]>, key: K, id: number): void {
  const ids = groups.get(key);
  if (ids) ids.push(id);
  else groups.set(key, [id]);
}

/** Screen every company of `niche`; `dryRun` counts without writing. */
export async function runScreen(
  db: Queryable,
  niche: string,
  screen: CompanyScreen,
  opts: { dryRun?: boolean } = {},
): Promise<ScreenStats> {
  // Pass 1, light: every domain and its place count, so chains span pages.
  const light = await db
    .select({
      domain: companies.domain,
      raw: sql<unknown>`jsonb_build_object('places_with_domain', ${companies.raw} -> 'places_with_domain')`,
    })
    .from(companies)
    .where(eq(companies.niche, niche));
  const chains = chainSizes(light);

  const stats: ScreenStats = { companies: 0, country_filled: 0, declined: {}, changed: 0 };
  const fills = new Map<string, number[]>();
  const verdicts = new Map<string | null, number[]>();
  let after = 0;
  for (;;) {
    const page = await db
      .select({
        id: companies.id,
        domain: companies.domain,
        name: companies.name,
        country: companies.country,
        raw: companies.raw,
        declineReason: companies.declineReason,
      })
      .from(companies)
      .where(and(eq(companies.niche, niche), gt(companies.id, after)))
      .orderBy(asc(companies.id))
      .limit(PAGE);
    if (page.length === 0) break;
    after = page[page.length - 1]?.id as number;
    for (const row of page) {
      stats.companies += 1;
      if (row.country == null) {
        const found = normalizeCountry(record(row.raw)?.country as string | undefined);
        if (found) {
          row.country = found;
          stats.country_filled += 1;
          push(fills, found, row.id);
        }
      }
      const reason = screenCompany(row, screen, chains);
      if (reason) stats.declined[reason] = (stats.declined[reason] ?? 0) + 1;
      if (reason !== row.declineReason) {
        stats.changed += 1;
        push(verdicts, reason, row.id);
      }
    }
  }
  if (opts.dryRun) return stats;
  for (const [country, ids] of fills)
    for (let i = 0; i < ids.length; i += PAGE)
      await db
        .update(companies)
        .set({ country })
        .where(inArray(companies.id, ids.slice(i, i + PAGE)));
  for (const [declineReason, ids] of verdicts)
    for (let i = 0; i < ids.length; i += PAGE)
      await db
        .update(companies)
        .set({ declineReason })
        .where(inArray(companies.id, ids.slice(i, i + PAGE)));
  return stats;
}
