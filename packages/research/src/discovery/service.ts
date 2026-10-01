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
  inPlay,
  resolve,
  sightings,
} from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, count, eq, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import { type DiscoveryKind, type DiscoveryOutcome, discoveryAttempts } from "../schema.js";
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
  /** Days a miss keeps a company out of the queue (default 30). */
  retryAfterDays?: number;
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

/** A miss keeps its company out of the queue this long before it is guessed again. */
export const DEFAULT_RETRY_AFTER_DAYS = 30;

/** "No attempt of this kind in the window" as a WHERE fragment on `companies`. */
const notAttempted = (kind: DiscoveryKind, retryAfterDays: number) => {
  const since = sql`now() - make_interval(days => ${retryAfterDays})`;
  return notExists(
    sql`(SELECT 1 FROM ${discoveryAttempts} a
         WHERE a.company_id = ${companies.id} AND a.kind = ${kind} AND a.attempted_at > ${since})`,
  );
};

async function recordAttempt(
  db: Queryable,
  companyId: number,
  kind: DiscoveryKind,
  outcome: DiscoveryOutcome,
  importId: number,
): Promise<void> {
  await db.insert(discoveryAttempts).values({ companyId, kind, outcome, importId });
}

/** The batch a run writes its evidence under. */
export async function openDiscoveryBatch(
  db: Queryable,
  sourceType: string,
  opts: { limit?: number; niche?: string | null },
): Promise<ImportBatch> {
  const [batch] = (await db
    .insert(imports)
    .values({
      sourceType,
      sourceRef: `run limit=${opts.limit ?? null} niche=${opts.niche ?? null}`,
      stats: {},
    })
    .returning()) as [ImportBatch];
  return batch;
}

export async function closeDiscoveryBatch(
  db: Queryable,
  batchId: number,
  stats: object,
): Promise<void> {
  await db.update(imports).set({ stats }).where(eq(imports.id, batchId));
}

/** Companies with no domain, oldest first; `niche` scopes, null sees every niche. */
export async function selectDiscoveryTargets(
  db: Queryable,
  opts: { limit?: number; niche?: string | null; retryAfterDays?: number },
): Promise<Company[]> {
  const niche = opts.niche ?? null;
  const fresh = notAttempted("discover", opts.retryAfterDays ?? DEFAULT_RETRY_AFTER_DAYS);
  const where =
    niche === null
      ? and(isNull(companies.domain), inPlay, fresh)
      : and(isNull(companies.domain), eq(companies.niche, niche), inPlay, fresh);
  const q = db.select().from(companies).where(where).orderBy(asc(companies.id));
  return opts.limit === undefined ? q : q.limit(opts.limit);
}

/** NULL-niche companies a niche-scoped discovery cannot see. */
export async function countDiscoveryNicheNullSkipped(db: Queryable): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(companies)
    .where(and(isNull(companies.domain), isNull(companies.niche)));
  return r?.n ?? 0;
}

export function emptyDiscoveryStats(): DiscoveryStats {
  return {
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
}

export function addDiscoveryStats(total: DiscoveryStats, unit: DiscoveryStats): DiscoveryStats {
  const sum: DiscoveryStats = { ...total };
  for (const k of Object.keys(unit) as (keyof DiscoveryStats)[]) {
    if (k === "niche_null_skipped") continue;
    sum[k] = (total[k] ?? 0) + (unit[k] ?? 0);
  }
  return sum;
}

export interface DiscoveryUnitOptions {
  batchId: number;
  rowNumber: number;
  genericWords?: ReadonlySet<string>;
  resolves?: Resolves;
  fetchHomepage: HomepageFetcher;
}

/** Is this domain already some company's? Asked per candidate, so a unit needs no preload. */
async function claimed(db: Queryable, domain: string): Promise<boolean> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.domain, domain))
    .limit(1);
  return row !== undefined;
}

/**
 * One company: guess, prune by DNS, gate the homepage, attach the first proven
 * domain with its evidence. Self-contained so a caller can journal it as one
 * unit; re-running it after a crash is safe (a company with a domain is no
 * longer a target, and a claimed domain is never taken twice).
 */
export async function discoverCompany(
  db: Queryable,
  company: Company,
  opts: DiscoveryUnitOptions,
): Promise<DiscoveryStats> {
  const generic = opts.genericWords ?? new Set<string>();
  const resolves = opts.resolves ?? dohResolves;
  const counts = emptyDiscoveryStats();
  counts.companies_scanned = 1;
  const done = async (outcome: DiscoveryOutcome) => {
    await recordAttempt(db, company.id, "discover", outcome, opts.batchId);
    return counts;
  };
  if (!company.name) {
    counts.no_name = 1;
    return done("no_name");
  }
  let reached = false;
  for (const candidate of domainCandidates(company.name, { genericWords: generic })) {
    if (await claimed(db, candidate)) {
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
    reached = true;
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
    counts.domains_attached += 1;
    await db.insert(sightings).values({
      companyId: company.id,
      importId: opts.batchId,
      rowNumber: opts.rowNumber,
      raw: { discovered_domain: candidate, evidence },
    });
    return done("attached"); // one proven domain per company; stop guessing
  }
  // Pages that answered but did not speak for the firm outrank guesses that never resolved.
  return done(
    reached ? "gate_rejected" : counts.candidates_tried > 0 ? "unreachable" : "no_candidate",
  );
}

/** The whole run in one call: batch, targets, one unit per company, batch stats. */
export async function runDomainDiscovery(
  db: Queryable,
  opts: DiscoveryOptions,
): Promise<{ batch: ImportBatch; stats: DiscoveryStats }> {
  const niche = opts.niche ?? null;
  const batch = await openDiscoveryBatch(db, DISCOVERY_SOURCE_TYPE, { ...opts, niche });
  const rows = await selectDiscoveryTargets(db, { ...opts, niche });
  let counts = emptyDiscoveryStats();
  if (niche !== null) counts.niche_null_skipped = await countDiscoveryNicheNullSkipped(db);
  let rowNumber = 0;
  for (const company of rows) {
    rowNumber += 1;
    counts = addDiscoveryStats(
      counts,
      await discoverCompany(db, company, { ...opts, batchId: batch.id, rowNumber }),
    );
  }
  await closeDiscoveryBatch(db, batch.id, counts);
  return { batch: { ...batch, stats: counts }, stats: counts };
}

export interface DomainVerificationOptions {
  genericWords?: ReadonlySet<string>;
  limit?: number;
  retryAfterDays?: number;
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

/** Companies whose domain was asserted but never proven. */
export async function selectVerificationTargets(
  db: Queryable,
  opts: { limit?: number; niche?: string | null; retryAfterDays?: number },
): Promise<Company[]> {
  const niche = opts.niche ?? null;
  const base = and(
    isNotNull(companies.domain),
    isNull(companies.domainVerifiedAt),
    inPlay,
    notAttempted("verify", opts.retryAfterDays ?? DEFAULT_RETRY_AFTER_DAYS),
  );
  const where = niche === null ? base : and(base, eq(companies.niche, niche));
  const q = db.select().from(companies).where(where).orderBy(asc(companies.id));
  return opts.limit === undefined ? q : q.limit(opts.limit);
}

export async function countVerificationNicheNullSkipped(db: Queryable): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(companies)
    .where(
      and(isNotNull(companies.domain), isNull(companies.domainVerifiedAt), isNull(companies.niche)),
    );
  return r?.n ?? 0;
}

export function emptyVerificationStats(): DomainVerificationStats {
  return {
    companies_scanned: 0,
    fetch_misses: 0,
    gate_rejections: 0,
    domains_verified: 0,
    unverified_preview: [],
  };
}

export function addVerificationStats(
  total: DomainVerificationStats,
  unit: DomainVerificationStats,
): DomainVerificationStats {
  return {
    ...total,
    companies_scanned: total.companies_scanned + unit.companies_scanned,
    fetch_misses: total.fetch_misses + unit.fetch_misses,
    gate_rejections: total.gate_rejections + unit.gate_rejections,
    domains_verified: total.domains_verified + unit.domains_verified,
    unverified_preview: [...total.unverified_preview, ...unit.unverified_preview].slice(0, 20),
  };
}

/** One company: gate the homepage of the domain it already has; a pass stamps it. */
export async function verifyCompanyDomain(
  db: Queryable,
  company: Company,
  opts: DiscoveryUnitOptions,
): Promise<DomainVerificationStats> {
  const generic = opts.genericWords ?? new Set<string>();
  const counts = emptyVerificationStats();
  counts.companies_scanned = 1;
  const done = async (outcome: DiscoveryOutcome) => {
    await recordAttempt(db, company.id, "verify", outcome, opts.batchId);
    return counts;
  };
  const domain = company.domain as string;
  const page = await opts.fetchHomepage(domain);
  if (page === null) {
    counts.fetch_misses = 1;
    counts.unverified_preview.push(`${domain}: unreachable`);
    return done("unreachable");
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
    counts.gate_rejections = 1;
    counts.unverified_preview.push(`${domain}: page does not speak for the firm`);
    return done("gate_rejected");
  }
  await db
    .update(companies)
    .set({ domainVerifiedAt: sql`now()` })
    .where(eq(companies.id, company.id));
  counts.domains_verified = 1;
  await db.insert(sightings).values({
    companyId: company.id,
    importId: opts.batchId,
    rowNumber: opts.rowNumber,
    raw: { verified_domain: domain, evidence },
  });
  return done("verified");
}

export async function runDomainVerification(
  db: Queryable,
  opts: DomainVerificationOptions,
): Promise<{ batch: ImportBatch; stats: DomainVerificationStats }> {
  const niche = opts.niche ?? null;
  const batch = await openDiscoveryBatch(db, VERIFICATION_SOURCE_TYPE, { ...opts, niche });
  const rows = await selectVerificationTargets(db, { ...opts, niche });
  let counts = emptyVerificationStats();
  if (niche !== null) counts.niche_null_skipped = await countVerificationNicheNullSkipped(db);
  let rowNumber = 0;
  for (const company of rows) {
    rowNumber += 1;
    counts = addVerificationStats(
      counts,
      await verifyCompanyDomain(db, company, { ...opts, batchId: batch.id, rowNumber }),
    );
  }
  await closeDiscoveryBatch(db, batch.id, counts);
  return { batch: { ...batch, stats: counts }, stats: counts };
}
