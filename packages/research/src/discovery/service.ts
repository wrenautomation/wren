/**
 * Website discovery over the DB (funnel L1). Two runs, both provenance-tracked as
 * imports rows with per-company evidence appended as sightings:
 *
 * - runDomainDiscovery: companies with NO domain get name-derived candidates,
 *   pruned by free DoH DNS, then the ownership gate; a passing candidate attaches
 *   with domain_verified_at set.
 * - runDomainVerification: companies whose domain was asserted but never verified
 *   get the same gate against their existing domain; passes stamp
 *   domain_verified_at, failures are counted and listed, never auto-detached.
 *
 * Neither run overwrites an existing domain or steals one claimed by another company.
 */
import {
  type Company,
  companies,
  DohStatusError,
  type ImportBatch,
  imports,
  resolve,
  sightings,
} from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { domainCandidates } from "./candidates.js";
import { gatePage } from "./gate.js";

export const DISCOVERY_SOURCE_TYPE = "domain-discovery";
export const VERIFICATION_SOURCE_TYPE = "domain-verification";

export interface Page {
  url: string;
  title: string;
  text: string;
}
/** The domain's homepage as text, or null when unreachable. The polite-fetcher implementation lives with enrichment. */
export type HomepageFetcher = (domain: string) => Promise<Page | null>;
/** true/false when DNS answered; null when the resolver had trouble (never a miss). */
export type Resolves = (domain: string) => Promise<boolean | null>;

export const dohResolves: Resolves = async (domain) => {
  try {
    if ((await resolve(domain, "A")).length) return true;
    return (await resolve(`www.${domain}`, "A")).length > 0;
  } catch (err) {
    if (err instanceof DohStatusError) return null;
    return null;
  }
};

export interface DiscoveryOptions {
  genericWords?: ReadonlySet<string>;
  limit?: number;
  /** Scope to one niche's companies. */
  niche?: string | null;
  resolves?: Resolves;
  fetchHomepage: HomepageFetcher;
}

export interface DiscoveryStats {
  companies_scanned: number;
  no_name: number;
  candidates_tried: number;
  dns_misses: number;
  resolver_errors: number;
  fetch_misses: number;
  gate_rejections: number;
  already_claimed: number;
  domains_attached: number;
  /** Present only on a niche-scoped run: NULL-niche companies invisible to it. */
  niche_null_skipped?: number;
}

export async function runDomainDiscovery(
  db: Queryable,
  opts: DiscoveryOptions,
): Promise<{ batch: ImportBatch; stats: DiscoveryStats }> {
  const generic = opts.genericWords ?? new Set<string>();
  const resolves = opts.resolves ?? dohResolves;
  const niche = opts.niche ?? null;
  const [batch] = (await db
    .insert(imports)
    .values({
      sourceType: DISCOVERY_SOURCE_TYPE,
      sourceRef: `run limit=${opts.limit ?? null} niche=${niche}`,
      stats: {},
    })
    .returning()) as [ImportBatch];

  const claimed = new Set(
    (await db.select({ domain: companies.domain }).from(companies))
      .map((r) => r.domain)
      .filter((d): d is string => !!d),
  );
  const where =
    niche === null
      ? isNull(companies.domain)
      : and(isNull(companies.domain), eq(companies.niche, niche));
  const q = db.select().from(companies).where(where).orderBy(asc(companies.id));
  const rows: Company[] = opts.limit === undefined ? await q : await q.limit(opts.limit);

  const counts: DiscoveryStats = {
    companies_scanned: 0,
    no_name: 0,
    candidates_tried: 0,
    dns_misses: 0,
    resolver_errors: 0,
    fetch_misses: 0,
    gate_rejections: 0,
    already_claimed: 0,
    domains_attached: 0,
  };
  if (niche !== null) {
    const [r] = await db
      .select({ n: count() })
      .from(companies)
      .where(and(isNull(companies.domain), isNull(companies.niche)));
    counts.niche_null_skipped = r?.n ?? 0;
  }

  let rowNumber = 0;
  for (const company of rows) {
    rowNumber += 1;
    counts.companies_scanned += 1;
    if (!company.name) {
      counts.no_name += 1;
      continue;
    }
    for (const candidate of domainCandidates(company.name, { genericWords: generic })) {
      if (claimed.has(candidate)) {
        counts.already_claimed += 1;
        continue;
      }
      counts.candidates_tried += 1;
      const answered = await resolves(candidate);
      if (answered === null) {
        counts.resolver_errors += 1;
        continue;
      }
      if (!answered) {
        counts.dns_misses += 1;
        continue;
      }
      const page = await opts.fetchHomepage(candidate);
      if (page === null) {
        counts.fetch_misses += 1;
        continue;
      }
      const evidence = gatePage({
        url: page.url,
        pageTitle: page.title,
        pageText: page.text,
        companyName: company.name,
        sourceKey: company.sourceKey,
        genericWords: generic,
      });
      if (evidence === null) {
        counts.gate_rejections += 1;
        continue;
      }
      await db
        .update(companies)
        .set({ domain: candidate, domainVerifiedAt: sql`now()` })
        .where(eq(companies.id, company.id));
      claimed.add(candidate);
      counts.domains_attached += 1;
      await db
        .insert(sightings)
        .values({
          companyId: company.id,
          importId: batch.id,
          rowNumber,
          raw: { discovered_domain: candidate, evidence },
        });
      break; // one proven domain per company; stop guessing
    }
  }
  await db.update(imports).set({ stats: counts }).where(eq(imports.id, batch.id));
  return { batch: { ...batch, stats: counts }, stats: counts };
}

export interface DomainVerificationOptions {
  genericWords?: ReadonlySet<string>;
  limit?: number;
  niche?: string | null;
  fetchHomepage: HomepageFetcher;
}

export interface DomainVerificationStats {
  companies_scanned: number;
  fetch_misses: number;
  gate_rejections: number;
  domains_verified: number;
  niche_null_skipped?: number;
  unverified_preview: string[];
}

export async function runDomainVerification(
  db: Queryable,
  opts: DomainVerificationOptions,
): Promise<{ batch: ImportBatch; stats: DomainVerificationStats }> {
  const generic = opts.genericWords ?? new Set<string>();
  const niche = opts.niche ?? null;
  const [batch] = (await db
    .insert(imports)
    .values({
      sourceType: VERIFICATION_SOURCE_TYPE,
      sourceRef: `run limit=${opts.limit ?? null} niche=${niche}`,
      stats: {},
    })
    .returning()) as [ImportBatch];

  const base = and(isNotNull(companies.domain), isNull(companies.domainVerifiedAt));
  const where = niche === null ? base : and(base, eq(companies.niche, niche));
  const q = db.select().from(companies).where(where).orderBy(asc(companies.id));
  const rows: Company[] = opts.limit === undefined ? await q : await q.limit(opts.limit);

  const counts: DomainVerificationStats = {
    companies_scanned: 0,
    fetch_misses: 0,
    gate_rejections: 0,
    domains_verified: 0,
    unverified_preview: [],
  };
  if (niche !== null) {
    const [r] = await db
      .select({ n: count() })
      .from(companies)
      .where(and(base, isNull(companies.niche)));
    counts.niche_null_skipped = r?.n ?? 0;
  }
  const unverified: string[] = [];

  let rowNumber = 0;
  for (const company of rows) {
    rowNumber += 1;
    counts.companies_scanned += 1;
    const domain = company.domain as string;
    const page = await opts.fetchHomepage(domain);
    if (page === null) {
      counts.fetch_misses += 1;
      unverified.push(`${domain}: unreachable`);
      continue;
    }
    const evidence = gatePage({
      url: page.url,
      pageTitle: page.title,
      pageText: page.text,
      companyName: company.name,
      sourceKey: company.sourceKey,
      genericWords: generic,
    });
    if (evidence === null) {
      counts.gate_rejections += 1;
      unverified.push(`${domain}: page does not speak for the firm`);
      continue;
    }
    await db
      .update(companies)
      .set({ domainVerifiedAt: sql`now()` })
      .where(eq(companies.id, company.id));
    counts.domains_verified += 1;
    await db
      .insert(sightings)
      .values({
        companyId: company.id,
        importId: batch.id,
        rowNumber,
        raw: { verified_domain: domain, evidence },
      });
  }
  counts.unverified_preview = unverified.slice(0, 20);
  await db.update(imports).set({ stats: counts }).where(eq(imports.id, batch.id));
  return { batch: { ...batch, stats: counts }, stats: counts };
}
