/**
 * The `exaSearch` stage (designs/2026-10-05-social-reads.md): firms by niche and city from Exa's
 * company index. autobrowse's `web GET /exa/companies` is one search; each is one import of source
 * `exa_search`, one row per result, so every result is kept whole. A firm is its result's own site;
 * a result on LinkedIn or a directory is keyed by that page (`li:<slug>`, `exa:<host><path>`),
 * never dropped. A search is read again every EXA_SEARCH_EVERY_DAYS, paced by a bucket over the
 * imports. About $0.007 a search, on the keys' free credit: a spent ring stops the pass, never pays.
 */
import {
  extractDomain,
  IDENTITY_KEY,
  isPlatformDomain,
  type LeadSource,
  type RawRow,
  registrableDomain,
  runImport,
} from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { atomic, type Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { type Bucket, bucketRoom, refusedBy, retryAfter } from "../pacing.js";

export const EXA_SEARCH_COMMAND = "enrich exa-search";
export const EXA_SEARCH_SOURCE = "exa_search";
/**
 * Searches a day: 30 x 7 mills is $0.21 of autobrowse's 330-mill daily `exa` cap a key, about $6.30 a
 * month. The pool sleeps to the next local day once a pass finds nothing, so on an idle pool a
 * bucket only gets its burst a day: the burst is the daily amount, and autobrowse's pace spaces the calls.
 */
export const EXA_SEARCH_BUCKET: Bucket = { perDay: 30, burst: 30 };
/** A city's firms change slowly: a search is read again after this. */
export const EXA_SEARCH_EVERY_DAYS = 30;
/** Results a search asks for: one price up to 25. */
export const EXA_RESULTS = 25;

/** One result as `web GET /exa/companies` answers it; `raw` is Exa's result whole. */
export interface ExaFirm {
  url: string;
  title: string | null;
  domain: string;
  raw: unknown;
}

/** Every (query, city) pair as search text, a city's queries together, the first city first. */
export function exaSearches(queries: readonly string[], cities: readonly string[]): string[] {
  return cities.flatMap((city) => queries.map((q) => q.replaceAll("{city}", city)));
}

/** `web/exa/companies?q=...`: one search's reads share it, so its last read is findable. */
export const exaRef = (q: string): string => `web/exa/companies?${new URLSearchParams({ q })}`;

/** `li:<slug>` for a LinkedIn company page, else `exa:<host><path>`: a page that stands for a firm. */
export function exaPageKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    const slug = /^\/company\/([^/]+)/.exec(path)?.[1];
    if (host.endsWith("linkedin.com") && slug) return `li:${slug}`.slice(0, 64);
    return `exa:${host}${path}`.slice(0, 64);
  } catch {
    return `exa:${url.toLowerCase()}`.slice(0, 64);
  }
}

/** One row per result, the result whole under `exa`; its own site is the firm, else its page. */
export function exaRows(
  results: readonly ExaFirm[],
  q: string,
  platforms: Iterable<string> = [],
): RawRow[] {
  const extra = [...platforms];
  return results.map((r) => {
    const host = extractDomain(r.url);
    const own = host && !isPlatformDomain(host, extra) ? registrableDomain(host) : null;
    return {
      company_name: r.title,
      website: own ?? r.url,
      query: q,
      exa: r.raw,
      ...(own ? {} : { [IDENTITY_KEY]: { source_key: exaPageKey(r.url) } }),
    };
  });
}

/** Searches left in the bucket now, and how long until the next when none. */
export async function exaSearchRoom(
  db: Queryable,
  now: Date,
  bucket: Bucket = EXA_SEARCH_BUCKET,
): Promise<{ room: number; nextInMs: number }> {
  const rows = await db.execute<{ at: string }>(sql`
    select imported_at as at from imports
    where source_type = ${EXA_SEARCH_SOURCE}
      and imported_at > ${now.toISOString()}::timestamptz - interval '2 days'
    order by imported_at`);
  return bucketRoom(
    rows.map((r) => new Date(r.at).getTime()),
    now.getTime(),
    bucket,
  );
}

/** The searches due a read: never read first (in list order), then the longest ago. */
export async function exaSearchesDue(
  db: Queryable,
  searches: readonly string[],
  opts: { now: Date; limit: number },
): Promise<string[]> {
  if (searches.length === 0 || opts.limit <= 0) return [];
  const refs = searches.map(exaRef);
  const rows = await db.execute<{ ref: string; at: string }>(sql`
    select source_ref as ref, max(imported_at) as at from imports
    where source_type = ${EXA_SEARCH_SOURCE}
      and source_ref in (${sql.join(
        refs.map((r) => sql`${r}`),
        sql`, `,
      )})
    group by source_ref`);
  const last = new Map(rows.map((r) => [r.ref, new Date(r.at).getTime()]));
  const due = opts.now.getTime() - EXA_SEARCH_EVERY_DAYS * 86_400_000;
  return searches
    .map((q, i) => ({ q, at: last.get(refs[i] as string) ?? 0 }))
    .filter((s) => s.at <= due)
    .sort((a, b) => a.at - b.at)
    .slice(0, opts.limit)
    .map((s) => s.q);
}

export type ExaSearchOutcome = "read" | "capped" | "spent" | "error";

export interface ExaSearchUnit {
  q: string;
  outcome: ExaSearchOutcome;
  results: number;
  created: number;
  seen: number;
  batch: number | null;
  error: string | null;
}

/** Run one search and import its results; a site error comes back as data, never thrown. */
export async function exaSearchUnit(
  db: Queryable,
  sites: SiteClient,
  w: { q: string; niche: string; n?: number; platforms?: Iterable<string> },
): Promise<ExaSearchUnit> {
  const none = { q: w.q, results: 0, created: 0, seen: 0, batch: null };
  let results: ExaFirm[];
  try {
    results = (
      await sites.call<{ results: ExaFirm[] }>("web", "GET", "/exa/companies", {
        q: w.q,
        n: w.n ?? EXA_RESULTS,
      })
    ).results;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    // A 429 is autobrowse's daily cap or pace: stop the pass, the bucket tries later.
    if (retryAfter(err) !== null) return { ...none, outcome: "capped", error: why };
    // A 402 is every Exa key out of credit until the 1st: stop, never pay.
    if (err instanceof SiteCallError && err.status === 402)
      return { ...none, outcome: "spent", error: why };
    if (refusedBy(err) === null) throw err;
    return { ...none, outcome: "error", error: why };
  }
  const platforms = [...(w.platforms ?? [])];
  const source: LeadSource = {
    sourceType: EXA_SEARCH_SOURCE,
    sourceRef: exaRef(w.q),
    rows: () => exaRows(results, w.q, platforms),
  };
  const { batch, stats } = await atomic(db, (tx) =>
    runImport(tx, source, { niche: w.niche, extraPlatformDomains: platforms }),
  );
  return {
    q: w.q,
    outcome: "read",
    results: results.length,
    created: stats.companies_created,
    seen: stats.companies_seen,
    batch: batch.id,
    error: null,
  };
}

export interface ExaSearchStats {
  selected: number;
  read: number;
  results: number;
  created: number;
  seen: number;
  errors: number;
  /** Why the run stopped early; null = it ran out of searches. */
  stopped: string | null;
}

export const emptyExaSearchStats = (): ExaSearchStats => ({
  selected: 0,
  read: 0,
  results: 0,
  created: 0,
  seen: 0,
  errors: 0,
  stopped: null,
});

/** Count a unit; the reason to stop, or null. */
export function countExaSearchUnit(s: ExaSearchStats, u: ExaSearchUnit): string | null {
  if (u.outcome === "capped") return `autobrowse said wait: ${u.error}`;
  if (u.outcome === "spent") return `exa keys are spent: ${u.error}`;
  if (u.outcome === "error") {
    s.errors++;
    return null;
  }
  s.read++;
  s.results += u.results;
  s.created += u.created;
  s.seen += u.seen;
  return null;
}
