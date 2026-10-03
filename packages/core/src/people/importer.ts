/**
 * People import runner: PersonSource -> imports/people/companies/sightings.
 * Same guarantees as the lead importer (provenance batch with content hash and
 * replay detection; rejected rows in import_errors with full content; re-encounters
 * append sightings and blank-fill, never overwrite).
 *
 * - Person identity mirrors company identity: a row with a source_key matches or
 *   creates on the key alone; keyless rows dedupe on (company, matched name). A
 *   keyless person later seen with a registry key gets the key blank-filled.
 * - A person row whose company is unknown CREATES the company (never-discard).
 * - is_compliance / is_testimonial only ever flip false -> true.
 */
import type { Queryable } from "@wren/db";
import { eq, inArray, or } from "drizzle-orm";
import { findReplay } from "../ingest/importer.js";
import {
  type Company,
  companies,
  type ImportBatch,
  importErrors,
  imports,
  type Person,
  people,
  sightings,
} from "../schema.js";
import { matchKey, type PersonItem, type PersonRow } from "./schema.js";
import type { PersonSource } from "./sources.js";

const PERSON_FIELDS = [
  "source_key",
  "first_name",
  "last_name",
  "title",
  "linkedin_url",
  "as_of",
] as const;

export interface PeopleImportStats {
  rows: number;
  people_created: number;
  people_seen: number;
  companies_created: number;
  compliance_flagged: number;
  company_domain_conflicts: number;
  errors: number;
  person_fields: Record<(typeof PERSON_FIELDS)[number], number>;
  replay_of?: number;
}

/** One person row landed: what the caller may hang its own facts on. */
export interface PersonLanded {
  person: Person;
  company: Company;
  row: PersonRow;
  /** 1-based, as in import_errors and sightings. */
  rowNumber: number;
  batch: ImportBatch;
  created: boolean;
}

export interface PeopleImportResult {
  batch: ImportBatch;
  stats: PeopleImportStats;
}

/** "Which company" as a stable map key: source_key when registry-keyed, domain otherwise. */
const companyRef = (c: Company) => (c.sourceKey ? `sk:${c.sourceKey}` : `dom:${c.domain ?? ""}`);
const nameRef = (company: Company, first: string | null, last: string | null, full: string) =>
  `${companyRef(company)} :: ${matchKey(first, last, full)}`;

export async function runPeopleImport(
  db: Queryable,
  source: PersonSource,
  opts: {
    niche?: string | null;
    /** Runs after each person row lands, inside the same queryable. */
    onPerson?: (landed: PersonLanded) => Promise<void>;
  } = {},
): Promise<PeopleImportResult> {
  const niche = opts.niche ?? null;
  const [batch] = (await db
    .insert(imports)
    .values({
      sourceType: source.sourceType,
      sourceRef: source.sourceRef,
      contentHash: source.contentHash ?? null,
      stats: {},
    })
    .returning()) as [ImportBatch];
  const replayOf = await findReplay(db, batch);

  // Only the companies these rows name, and their people: the whole table is too big to
  // hold in one Lambda (hundreds of thousands of firms with their raw rows).
  const items: PersonItem[] = [];
  for await (const item of source.rows()) items.push(item);
  const keys = new Set<string>();
  const domains = new Set<string>();
  for (const item of items) {
    if (item.kind === "error") continue;
    if (item.companySourceKey) keys.add(item.companySourceKey);
    if (item.companyDomain) domains.add(item.companyDomain);
  }
  const companiesBySourceKey = new Map<string, Company>();
  const companiesByDomain = new Map<string, Company>();
  const companiesById = new Map<number, Company>();
  for (const [keyChunk, domainChunk] of zipChunks([...keys], [...domains])) {
    const named = await db
      .select()
      .from(companies)
      .where(
        or(
          keyChunk.length ? inArray(companies.sourceKey, keyChunk) : undefined,
          domainChunk.length ? inArray(companies.domain, domainChunk) : undefined,
        ),
      );
    for (const c of named) {
      companiesById.set(c.id, c);
      if (c.sourceKey) companiesBySourceKey.set(c.sourceKey, c);
      if (c.domain) companiesByDomain.set(c.domain, c);
    }
  }
  const peopleBySourceKey = new Map<string, Person>();
  const peopleByName = new Map<string, Person>();
  for (const [ids] of zipChunks([...companiesById.keys()], [])) {
    for (const p of await db.select().from(people).where(inArray(people.companyId, ids))) {
      const company = companiesById.get(p.companyId) as Company;
      if (p.sourceKey) peopleBySourceKey.set(p.sourceKey, p);
      peopleByName.set(nameRef(company, p.firstName, p.lastName, p.fullName), p);
    }
  }

  const counts: PeopleImportStats = {
    rows: 0,
    people_created: 0,
    people_seen: 0,
    companies_created: 0,
    compliance_flagged: 0,
    company_domain_conflicts: 0,
    errors: 0,
    person_fields: {
      source_key: 0,
      first_name: 0,
      last_name: 0,
      title: 0,
      linkedin_url: 0,
      as_of: 0,
    },
  };

  async function resolveCompany(row: PersonRow, rowNumber: number): Promise<Company> {
    // The key ALONE decides for keyed rows; only keyless rows use domain as the match surface.
    let company = row.companySourceKey
      ? companiesBySourceKey.get(row.companySourceKey)
      : row.companyDomain
        ? companiesByDomain.get(row.companyDomain)
        : undefined;
    if (!company) {
      let domain = row.companyDomain;
      const claimant = domain ? companiesByDomain.get(domain) : undefined;
      if (claimant) {
        // Another firm owns this domain: record the claim, never steal it.
        counts.company_domain_conflicts += 1;
        await db.insert(importErrors).values({
          importId: batch.id,
          rowNumber,
          kind: "domain_conflict",
          reason: `domain '${domain}' is claimed by '${claimant.sourceKey ?? claimant.name ?? domain}'; claim by person row for '${row.companySourceKey}' declined`,
          raw: row.raw,
          companyId: claimant.id,
        });
        domain = null;
      }
      [company] = (await db
        .insert(companies)
        .values({
          sourceKey: row.companySourceKey,
          domain,
          name: row.companyName,
          niche,
          importId: batch.id,
          raw: row.raw,
        })
        .returning()) as [Company];
      counts.companies_created += 1;
      companiesById.set(company.id, company);
    } else {
      const patch: Partial<Company> = {};
      if (company.name == null && row.companyName) patch.name = row.companyName; // blank-fill, never overwrite
      if (company.niche == null && niche) patch.niche = niche;
      if (Object.keys(patch).length) {
        await db.update(companies).set(patch).where(eq(companies.id, company.id));
        Object.assign(company, patch);
      }
    }
    if (company.sourceKey) companiesBySourceKey.set(company.sourceKey, company);
    if (company.domain) companiesByDomain.set(company.domain, company);
    return company;
  }

  let rowNumber = 0;
  for (const item of items) {
    rowNumber += 1;
    counts.rows += 1;
    if (item.kind === "error") {
      counts.errors += 1;
      await db.insert(importErrors).values({
        importId: batch.id,
        rowNumber,
        kind: "rejected",
        reason: item.reason,
        raw: item.raw,
      });
      continue;
    }
    const row = item;
    const given: Record<(typeof PERSON_FIELDS)[number], unknown> = {
      source_key: row.sourceKey,
      first_name: row.firstName,
      last_name: row.lastName,
      title: row.title,
      linkedin_url: row.linkedinUrl,
      as_of: row.asOf,
    };
    for (const f of PERSON_FIELDS) if (given[f] != null) counts.person_fields[f] += 1;
    if (row.isCompliance) counts.compliance_flagged += 1;

    const company = await resolveCompany(row, rowNumber);
    const key = nameRef(company, row.firstName, row.lastName, row.fullName);
    let person =
      (row.sourceKey ? peopleBySourceKey.get(row.sourceKey) : undefined) ?? peopleByName.get(key);
    const created = !person;
    if (!person) {
      [person] = (await db
        .insert(people)
        .values({
          sourceKey: row.sourceKey,
          companyId: company.id,
          fullName: row.fullName,
          firstName: row.firstName,
          lastName: row.lastName,
          title: row.title,
          isCompliance: row.isCompliance,
          isTestimonial: row.isTestimonial,
          testimonialOrg: row.testimonialOrg,
          origin: row.origin,
          originRef: row.originRef,
          asOf: row.asOf,
          linkedinUrl: row.linkedinUrl,
          importId: batch.id,
          raw: row.raw,
        })
        .returning()) as [Person];
      counts.people_created += 1;
    } else {
      // Blank-fill only: a NULL is not a claim; the first claim stands.
      const patch: Partial<Person> = {};
      if (person.title == null && row.title) patch.title = row.title;
      if (person.firstName == null && row.firstName) patch.firstName = row.firstName;
      if (person.lastName == null && row.lastName) patch.lastName = row.lastName;
      if (person.linkedinUrl == null && row.linkedinUrl) patch.linkedinUrl = row.linkedinUrl;
      if (person.sourceKey == null && row.sourceKey) patch.sourceKey = row.sourceKey; // keyless identity converges
      if (row.isCompliance && !person.isCompliance) patch.isCompliance = true;
      // One page naming this person as a client is evidence; a later silent page is not. Never untag.
      if (row.isTestimonial && !person.isTestimonial) patch.isTestimonial = true;
      if (person.testimonialOrg == null && row.testimonialOrg)
        patch.testimonialOrg = row.testimonialOrg;
      if (Object.keys(patch).length) {
        await db.update(people).set(patch).where(eq(people.id, person.id));
        Object.assign(person, patch);
      }
      counts.people_seen += 1;
      await db
        .insert(sightings)
        .values({ personId: person.id, importId: batch.id, rowNumber, raw: row.raw });
    }
    if (person.sourceKey) peopleBySourceKey.set(person.sourceKey, person);
    peopleByName.set(key, person);
    await opts.onPerson?.({ person, company, row, rowNumber, batch, created });
  }

  if (replayOf != null) counts.replay_of = replayOf;
  await db.update(imports).set({ stats: counts }).where(eq(imports.id, batch.id));
  return { batch: { ...batch, stats: counts }, stats: counts };
}

/** Parallel slices of both lists, a few thousand values per query (Postgres caps bind parameters). */
function* zipChunks<A, B>(a: A[], b: B[], size = 5000): Generator<[A[], B[]]> {
  for (let i = 0; i < Math.max(a.length, b.length); i += size) {
    yield [a.slice(i, i + size), b.slice(i, i + size)];
  }
}
