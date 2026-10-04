/**
 * Where an address came from, pinned on every draft.
 *
 * A message already pins template@version and every variant pick. This adds the other half
 * of "why did we mail this address": the lead, the candidate and its evidence tier, the
 * verification that cleared it, and the page the address (or the person) was read off.
 * Everything is an id that exists today; the record is plain JSON in
 * `messages.provenance.address` and the views read it with `->>`.
 */
import { leads, people } from "@wren/core";
import type { Queryable } from "@wren/db";
import { documents, enrichments } from "@wren/research/schema";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  contactCandidates,
  type Verification,
  type VerificationResult,
  verifications,
} from "../schema.js";
import { latestValidCheckedAt } from "../verification/service.js";

/** The evidence a role inbox carries: not a candidate tier, "the site printed it and the pick chose it". */
export const PICK_EVIDENCE = "pick";

const ENRICHMENT_PREFIX = "enrichment:";

/**
 * One address of record and the chain of ids behind it. Keys are snake_case because this is
 * the stored JSON shape (the views and the Python-era rows read it as such).
 */
export interface AddressRecord {
  readonly email: string;
  readonly evidence: string;
  readonly lead_id: number | null;
  readonly candidate_id: number | null;
  readonly pattern: string | null;
  readonly source_ref: string | null;
  readonly verification_id: number | null;
  readonly verification_result: string | null;
  /** ISO 8601, UTC, Python `datetime.isoformat()` shape (`+00:00`). */
  readonly verified_at: string | null;
  readonly verifier: string | null;
  readonly pick_enrichment_id: number | null;
  readonly pick_method: string | null;
  readonly extraction_enrichment_id: number | null;
  readonly document_id: number | null;
  readonly source_url: string | null;
}

const EMPTY: Omit<AddressRecord, "email" | "evidence"> = {
  lead_id: null,
  candidate_id: null,
  pattern: null,
  source_ref: null,
  verification_id: null,
  verification_result: null,
  verified_at: null,
  verifier: null,
  pick_enrichment_id: null,
  pick_method: null,
  extraction_enrichment_id: null,
  document_id: null,
  source_url: null,
};

export function addressRecord(
  fields: Pick<AddressRecord, "email" | "evidence"> & Partial<AddressRecord>,
): AddressRecord {
  return { ...EMPTY, ...fields };
}

const ID_LABELS: readonly (readonly [keyof AddressRecord, string])[] = [
  ["lead_id", "lead"],
  ["candidate_id", "candidate"],
  ["verification_id", "verification"],
  ["pick_enrichment_id", "pick"],
  ["extraction_enrichment_id", "extraction"],
  ["document_id", "document"],
];

/** The stored record read back as one line for a reviewer. */
export function describeAddress(
  address: Partial<Record<string, unknown>> | null | undefined,
  opts: { brief?: boolean } = {},
): string {
  if (!address || Object.keys(address).length === 0) return "";
  const parts = [String(address.evidence || "?"), String(address.verification_result || "none")];
  if (!opts.brief) {
    for (const [key, label] of ID_LABELS) {
      const value = address[key];
      if (value !== null && value !== undefined) parts.push(`${label} ${String(value)}`);
    }
  }
  return parts.join(" · ");
}

/** Python `datetime.isoformat()` for a UTC instant: microseconds when non-zero, `+00:00`. */
export function pyIsoUtc(date: Date): string {
  const [stamp = "", fraction = "000"] = date.toISOString().slice(0, -1).split(".");
  return Number(fraction) === 0 ? `${stamp}+00:00` : `${stamp}.${fraction}000+00:00`;
}

function verificationFields(v: Verification | null): Partial<AddressRecord> {
  if (v === null) return {};
  return {
    verification_id: v.id,
    verification_result: v.result,
    verified_at: v.checkedAt === null ? null : pyIsoUtc(v.checkedAt),
    verifier: v.verifier,
  };
}

/** The newest verdict on the lead — of one result when asked, else of any result. */
async function latestVerification(
  db: Queryable,
  leadId: number,
  result: VerificationResult | null,
): Promise<Verification | null> {
  const where =
    result === null
      ? eq(verifications.leadId, leadId)
      : and(eq(verifications.leadId, leadId), eq(verifications.result, result));
  const [row] = await db
    .select()
    .from(verifications)
    .where(where)
    .orderBy(desc(verifications.checkedAt), desc(verifications.id))
    .limit(1);
  return row ?? null;
}

function enrichmentId(ref: string | null | undefined): number | null {
  if (!ref?.startsWith(ENRICHMENT_PREFIX)) return null;
  const token = ref.slice(ENRICHMENT_PREFIX.length).trim().split(/\s+/, 1)[0] ?? "";
  return /^\d+$/.test(token) ? Number(token) : null;
}

/**
 * (extraction enrichment id, document id, url) for the page behind a candidate: the scrape
 * that printed the address when `source_ref` names one, else the extraction that found the
 * PERSON (people.origin_ref, same shape) for a pattern address.
 */
async function extractionPage(
  db: Queryable,
  sourceRef: string | null,
  personId: number,
): Promise<Pick<AddressRecord, "extraction_enrichment_id" | "document_id" | "source_url">> {
  let id = enrichmentId(sourceRef);
  if (id === null) {
    const [person] = await db
      .select({ originRef: people.originRef })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1);
    id = enrichmentId(person?.originRef);
  }
  if (id === null) return { extraction_enrichment_id: null, document_id: null, source_url: null };
  const [row] = await db
    .select({ id: enrichments.id, documentId: documents.id, url: documents.url })
    .from(enrichments)
    .innerJoin(documents, eq(documents.id, enrichments.documentId))
    .where(eq(enrichments.id, id))
    .limit(1);
  if (row === undefined)
    return { extraction_enrichment_id: id, document_id: null, source_url: null };
  return { extraction_enrichment_id: row.id, document_id: row.documentId, source_url: row.url };
}

export interface PersonAddress {
  readonly record: AddressRecord | null;
  readonly alternates: readonly AddressRecord[];
}

/**
 * The person's sendable address of record plus every OTHER address of theirs that passes
 * the same gate. The record is `leads.email` (a corrected lead wins over the candidate),
 * gated on a VERIFIED candidate promoted to a VERIFIED lead AND a VALID verification
 * younger than `horizonDays`. Only the first is ever written to; the rest ride along as
 * `address_alternates`.
 */
export async function personAddress(
  db: Queryable,
  personId: number,
  horizonDays: number,
): Promise<PersonAddress> {
  const rows = await db
    .select({ lead: leads, candidate: contactCandidates })
    .from(leads)
    .innerJoin(contactCandidates, eq(contactCandidates.leadId, leads.id))
    .where(and(eq(contactCandidates.personId, personId), sendable(horizonDays)))
    .orderBy(asc(contactCandidates.id));
  const records: AddressRecord[] = [];
  const seen = new Set<string>();
  for (const { lead, candidate } of rows) {
    if (seen.has(lead.email)) continue; // two candidates can point at one corrected lead
    seen.add(lead.email);
    const verification = await latestVerification(db, lead.id, "valid");
    const page = await extractionPage(db, candidate.sourceRef, personId);
    records.push(
      addressRecord({
        email: lead.email,
        evidence: candidate.evidence,
        lead_id: lead.id,
        candidate_id: candidate.id,
        pattern: candidate.pattern,
        source_ref: candidate.sourceRef,
        ...page,
        ...verificationFields(verification),
      }),
    );
  }
  const [record = null, ...alternates] = records;
  return { record, alternates };
}

/** The `personAddress` gate, as a filter on leads joined to their candidates. */
function sendable(horizonDays: number) {
  const horizon = new Date(Date.now() - horizonDays * 86_400_000);
  return and(
    eq(contactCandidates.state, "verified"),
    eq(leads.status, "verified"),
    gt(latestValidCheckedAt(), sql`${horizon.toISOString()}::timestamptz`),
    // Wrong person (lead_sheet's `verified`): the mailbox fits someone else, or they moved on.
    sql`NOT EXISTS (SELECT 1 FROM lead_checks lc WHERE lc.lead_id = ${leads.id}
      AND lc.kind IN ('mailbox_fits_name', 'works_there') AND lc.result = 'fail')`,
  );
}

/**
 * Which of these people have an address `personAddress` would return, in one
 * query: a pass over many people asks for the full record only where one exists.
 */
export async function peopleWithAddress(
  db: Queryable,
  personIds: readonly number[],
  horizonDays: number,
): Promise<Set<number>> {
  if (personIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ personId: contactCandidates.personId })
    .from(leads)
    .innerJoin(contactCandidates, eq(contactCandidates.leadId, leads.id))
    .where(and(inArray(contactCandidates.personId, [...personIds]), sendable(horizonDays)));
  return new Set(rows.map((r) => r.personId));
}

const NO_ADDRESS: PersonAddress = { record: null, alternates: [] };

/** `personAddress`, skipping the query for people `peopleWithAddress` ruled out. */
export const personAddressIn = (
  db: Queryable,
  addressable: ReadonlySet<number>,
  personId: number,
  horizonDays: number,
): Promise<PersonAddress> =>
  addressable.has(personId)
    ? personAddress(db, personId, horizonDays)
    : Promise.resolve(NO_ADDRESS);

export interface RoleInboxRef {
  readonly companyId: number;
  readonly leadId: number;
  readonly email: string;
  readonly pickEnrichmentId: number;
  readonly pickMethod: string | null;
}

/**
 * The provenance chain behind a role-inbox enrollment: the pick that chose the address,
 * the scan signal that first carried it, and the verification if one was ever bought.
 */
export async function roleInboxAddress(db: Queryable, ref: RoleInboxRef): Promise<AddressRecord> {
  const verification = await latestVerification(db, ref.leadId, null);
  const pages = (await db.execute(sql`
    SELECT e.document_id, COALESCE(s ->> 'page_url', d.url) AS source_url
    FROM enrichments e
    JOIN documents d ON d.id = e.document_id
    CROSS JOIN LATERAL jsonb_array_elements(e.output -> 'signals') AS s
    WHERE d.company_id = ${ref.companyId}
      AND e.kind = 'email_scan'
      AND lower(s ->> 'email') = ${ref.email.toLowerCase()}
    ORDER BY e.id
    LIMIT 1`)) as unknown as { document_id: number; source_url: string | null }[];
  const page = pages[0];
  return addressRecord({
    email: ref.email,
    evidence: PICK_EVIDENCE,
    lead_id: ref.leadId,
    pick_enrichment_id: ref.pickEnrichmentId,
    pick_method: ref.pickMethod,
    document_id: page?.document_id ?? null,
    source_url: page?.source_url ?? null,
    ...verificationFields(verification),
  });
}
