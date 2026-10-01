/**
 * Import runner: LeadSource -> classified rows -> imports/companies/leads.
 * One batch is one transaction.
 *
 * Company identity: a row carrying a source_key matches or creates on that key
 * alone — a shared domain never folds two keyed firms together. The row's domain
 * attaches only if the company has none and no other company claims it; a claim on
 * another company's domain is a DOMAIN_CONFLICT row in import_errors, a keyed
 * match presenting a different unclaimed domain is DOMAIN_CHANGED. Never applied
 * automatically. Keyless rows keep domain as the dedupe surface.
 *
 * Re-encounters are kept: every match appends a sighting carrying the full fresh
 * row; scalar columns keep the first import's claim (blank-fill only).
 *
 * Suppression gates sending, not storage: a suppressed lead is stored as
 * status=suppressed, linked to the rule that matched; its company is still created.
 *
 * Row numbers are 1-based over data rows (spreadsheet row = reported row + 1).
 */
import type { Queryable } from "@wren/db";
import { and, eq, isNull, ne } from "drizzle-orm";
import { emailDomain } from "../emails.js";
import {
  type Company,
  companies,
  type ImportBatch,
  importErrors,
  imports,
  type Lead,
  leads,
  type Suppression,
  sightings,
  suppressions,
} from "../schema.js";
import {
  CANONICAL_FIELDS,
  type CompanyRow,
  canonicalize,
  classifyRow,
  IDENTITY_KEY,
  type LeadRow,
  type RawRow,
} from "./schema.js";
import type { LeadSource } from "./sources.js";

/** Fallback segment fields for rows that don't carry their own. */
export interface SegmentDefaults {
  persona: string | null;
  source: string | null;
  geo: string | null;
  country: string | null;
}
const NO_DEFAULTS: SegmentDefaults = { persona: null, source: null, geo: null, country: null };

const LEAD_FIELDS = [
  "email",
  "first_name",
  "last_name",
  "title",
  "country",
  "persona",
  "source",
  "geo",
  "social_url",
] as const;
const COMPANY_FIELDS = ["source_key", "domain", "name", "social_url", "country"] as const;

/** Persisted on `imports.stats`; keys are the legacy names so reports keep working. */
export interface ImportStats {
  rows: number;
  leads_created: number;
  leads_suppressed: number;
  duplicate_leads: number;
  companies_created: number;
  companies_seen: number;
  companies_suppressed: number;
  domain_conflicts: number;
  country_unrecognized: number;
  errors: number;
  /** How many parsed rows carried each field: what the SOURCE gave us, not what survived storage. */
  lead_fields: Record<(typeof LEAD_FIELDS)[number], number>;
  company_fields: Record<(typeof COMPANY_FIELDS)[number], number>;
  /** Headers that never canonicalized anywhere in the batch: a dialect miss made visible. */
  unmapped_headers: string[];
  /** Earlier batch of the same source type with byte-identical content. Recorded, never blocked. */
  replay_of?: number;
  /** Rows the source declined (a chain, a closed place), by reason: never stored, never silent. */
  declined?: Record<string, number>;
}

export interface ImportOptions {
  defaults?: Partial<SegmentDefaults>;
  columnMap?: Record<string, string>;
  /** The source format's niche, stamped on companies the import creates. */
  niche?: string | null;
  extraPlatformDomains?: Iterable<string>;
}

export interface ImportResult {
  batch: ImportBatch;
  stats: ImportStats;
}

const zeroed = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** Conflict reasons name parties by identifiers a human can look up. */
const label = (c: Company) => c.sourceKey ?? c.name ?? c.domain ?? "<unidentified>";

export async function findReplay(db: Queryable, batch: ImportBatch): Promise<number | null> {
  if (batch.contentHash == null) return null;
  const [row] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(
      and(
        eq(imports.sourceType, batch.sourceType),
        eq(imports.contentHash, batch.contentHash),
        ne(imports.id, batch.id),
      ),
    )
    .orderBy(imports.id)
    .limit(1);
  return row?.id ?? null;
}

export async function runImport(
  db: Queryable,
  source: LeadSource,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const defaults: SegmentDefaults = { ...NO_DEFAULTS, ...opts.defaults };
  const columnMap = opts.columnMap;
  const niche = opts.niche ?? null;
  const extra = [...(opts.extraPlatformDomains ?? [])];
  if (columnMap) {
    const unknown = [...new Set(Object.values(columnMap))]
      .filter((f) => !CANONICAL_FIELDS.has(f))
      .sort();
    // A bad map is an operator typo: fail before touching a single row.
    if (unknown.length)
      throw new Error(`column_map targets unknown field(s): ${JSON.stringify(unknown)}`);
  }

  const [batch] = (await db
    .insert(imports)
    .values({
      sourceType: source.sourceType,
      sourceRef: source.sourceRef,
      contentHash: source.contentHash ?? null,
      defaults, // persisted so a defaulted value is later distinguishable from an asserted one
      stats: {},
    })
    .returning()) as [ImportBatch];
  const replayOf = await findReplay(db, batch);

  // value -> rule, so a suppressed lead records which rule hit. Revoked rules excluded.
  const byEmail = new Map<string, Suppression>();
  const byDomainRule = new Map<string, Suppression>();
  for (const s of await db.select().from(suppressions).where(isNull(suppressions.revokedAt))) {
    (s.kind === "email" ? byEmail : byDomainRule).set(s.value.toLowerCase(), s);
  }
  // Whole-table preloads: fine at niche-database scale, one query each.
  const leadsByEmail = new Map<string, Lead>();
  for (const l of await db.select().from(leads)) leadsByEmail.set(l.email, l);
  const companiesByDomain = new Map<string, Company>();
  const companiesBySourceKey = new Map<string, Company>();
  for (const c of await db.select().from(companies)) {
    if (c.domain) companiesByDomain.set(c.domain, c);
    if (c.sourceKey) companiesBySourceKey.set(c.sourceKey, c);
  }

  const counts: ImportStats = {
    rows: 0,
    leads_created: 0,
    leads_suppressed: 0,
    duplicate_leads: 0,
    companies_created: 0,
    companies_seen: 0,
    companies_suppressed: 0,
    domain_conflicts: 0,
    country_unrecognized: 0,
    errors: 0,
    lead_fields: zeroed(LEAD_FIELDS),
    company_fields: zeroed(COMPANY_FIELDS),
    unmapped_headers: [],
  };
  const seenHeaders = new Set<string>();

  const bumpLead = (r: LeadRow) => {
    const v: Record<(typeof LEAD_FIELDS)[number], unknown> = {
      email: r.email,
      first_name: r.firstName,
      last_name: r.lastName,
      title: r.title,
      country: r.country,
      persona: r.persona,
      source: r.source,
      geo: r.geo,
      social_url: r.socialUrl,
    };
    for (const f of LEAD_FIELDS) if (v[f] != null) counts.lead_fields[f] += 1;
  };
  const bumpCompany = (r: CompanyRow) => {
    const v: Record<(typeof COMPANY_FIELDS)[number], unknown> = {
      source_key: r.sourceKey,
      domain: r.domain,
      name: r.name,
      social_url: r.socialUrl,
      country: r.country,
    };
    for (const f of COMPANY_FIELDS) if (v[f] != null) counts.company_fields[f] += 1;
  };

  async function getOrCreateCompany(
    rowNumber: number,
    domain: string | null,
    sourceKey: string | null,
    name: string | null,
    raw: RawRow,
    socialUrl: string | null = null,
    country: string | null = null,
  ): Promise<Company> {
    // With a source_key the key ALONE decides match-or-create; keyless rows dedupe on domain.
    let company = sourceKey
      ? companiesBySourceKey.get(sourceKey)
      : domain
        ? companiesByDomain.get(domain)
        : undefined;
    if (!company) {
      // ck_companies_identified needs domain or source_key at insert: an unclaimed domain
      // attaches on create; a claimed one goes through the conflict path below.
      const own = domain && !companiesByDomain.has(domain) ? domain : null;
      [company] = (await db
        .insert(companies)
        .values({
          domain: own,
          sourceKey,
          name,
          socialUrl,
          country,
          niche,
          importId: batch.id,
          raw,
        })
        .returning()) as [Company];
      counts.companies_created += 1;
    } else {
      // Fill blanks, never overwrite: the first import's claim stands.
      const patch: Partial<Company> = {};
      if (company.name == null && name) patch.name = name;
      if (company.socialUrl == null && socialUrl) patch.socialUrl = socialUrl;
      if (company.country == null && country) patch.country = country;
      if (company.niche == null && niche) patch.niche = niche;
      if (Object.keys(patch).length) {
        await db.update(companies).set(patch).where(eq(companies.id, company.id));
        Object.assign(company, patch);
      }
      counts.companies_seen += 1;
      // The fresh row is a re-encounter worth keeping.
      await db
        .insert(sightings)
        .values({ companyId: company.id, importId: batch.id, rowNumber, raw });
    }
    if (domain) {
      const claimant = companiesByDomain.get(domain);
      if (!claimant) {
        if (company.domain == null) {
          await db.update(companies).set({ domain }).where(eq(companies.id, company.id));
          company.domain = domain;
        } else if (company.domain !== domain) {
          await db.insert(importErrors).values({
            importId: batch.id,
            rowNumber,
            kind: "domain_changed",
            reason: `'${label(company)}' presented domain '${domain}', different from '${company.domain}' on file`,
            raw,
            companyId: company.id,
          });
        }
      } else if (claimant.id !== company.id) {
        await db.insert(importErrors).values({
          importId: batch.id,
          rowNumber,
          kind: "domain_conflict",
          reason: `domain '${domain}' is claimed by '${label(claimant)}'; claim by '${label(company)}' declined`,
          raw,
          companyId: claimant.id,
          claimantCompanyId: company.id,
        });
        counts.domain_conflicts += 1;
      }
    }
    if (company.domain) companiesByDomain.set(company.domain, company);
    if (company.sourceKey) companiesBySourceKey.set(company.sourceKey, company);
    return company;
  }

  let rowNumber = 0;
  for await (const raw of source.rows()) {
    rowNumber += 1;
    counts.rows += 1;
    for (const k of Object.keys(raw))
      if (k !== "_overflow" && k !== IDENTITY_KEY) seenHeaders.add(k);
    const parsed = classifyRow(raw, {
      ...(columnMap ? { columnMap } : {}),
      extraPlatformDomains: extra,
    });
    if (parsed.kind === "error") {
      counts.errors += 1;
      await db
        .insert(importErrors)
        .values({ importId: batch.id, rowNumber, kind: "rejected", reason: parsed.reason, raw });
      continue;
    }
    if (parsed.kind === "company") {
      bumpCompany(parsed);
      if (parsed.domain && byDomainRule.has(parsed.domain)) counts.companies_suppressed += 1;
      await getOrCreateCompany(
        rowNumber,
        parsed.domain,
        parsed.sourceKey,
        parsed.name,
        raw,
        parsed.socialUrl,
        parsed.country,
      );
      continue;
    }
    bumpLead(parsed);
    const existing = leadsByEmail.get(parsed.email);
    if (existing) {
      counts.duplicate_leads += 1;
      await db
        .insert(sightings)
        .values({ leadId: existing.id, importId: batch.id, rowNumber, raw });
      // A lead that arrived companyless still deserves the link once a later file supplies one.
      // No other lead scalar is blank-filled on a re-encounter: a NULL is not a claim.
      if (parsed.companyDomain || parsed.sourceKey) {
        const company = await getOrCreateCompany(
          rowNumber,
          parsed.companyDomain,
          parsed.sourceKey,
          parsed.companyName,
          raw,
          parsed.socialUrl,
          parsed.country,
        );
        if (existing.companyId == null) {
          await db.update(leads).set({ companyId: company.id }).where(eq(leads.id, existing.id));
          existing.companyId = company.id;
        }
      }
      continue;
    }
    // A batch default fills only true-absent country; present-but-unrecognized stays NULL and is counted.
    let country: string | null;
    if (parsed.countryRaw == null) country = parsed.country ?? defaults.country;
    else {
      country = parsed.country;
      if (country == null) counts.country_unrecognized += 1;
    }
    // A keyed row names its company even with no site (a freemail contact on a registry firm).
    // The company takes the lead's country: compliance and send times key on it.
    let company: Company | null = null;
    if (parsed.companyDomain || parsed.sourceKey) {
      company = await getOrCreateCompany(
        rowNumber,
        parsed.companyDomain,
        parsed.sourceKey,
        parsed.companyName,
        raw,
        parsed.socialUrl,
        country,
      );
    }
    // Match precedence mirrors specificity: exact address, mailbox domain, business domain.
    const matched =
      byEmail.get(parsed.email) ??
      byDomainRule.get(emailDomain(parsed.email)) ??
      (parsed.companyDomain ? byDomainRule.get(parsed.companyDomain) : undefined) ??
      null;
    const [lead] = (await db
      .insert(leads)
      .values({
        email: parsed.email,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        title: parsed.title,
        persona: parsed.persona ?? defaults.persona,
        source: parsed.source ?? defaults.source,
        geo: parsed.geo ?? defaults.geo,
        country,
        socialUrl: parsed.socialUrl, // a freemail lead keeps its pointer
        status: matched ? "suppressed" : "imported",
        suppressionId: matched?.id ?? null,
        raw,
        companyId: company?.id ?? null,
        importId: batch.id,
      })
      .returning()) as [Lead];
    leadsByEmail.set(parsed.email, lead); // same-batch duplicates must sight this lead
    counts[matched ? "leads_suppressed" : "leads_created"] += 1;
  }

  counts.unmapped_headers = [...seenHeaders]
    .filter((h) => Object.keys(canonicalize({ [h]: "x" }, columnMap)).length === 0)
    .sort();
  if (replayOf != null) counts.replay_of = replayOf;
  const declined = source.declined?.();
  if (declined && Object.keys(declined).length) counts.declined = declined;
  await db.update(imports).set({ stats: counts }).where(eq(imports.id, batch.id));
  return { batch: { ...batch, stats: counts }, stats: counts };
}
