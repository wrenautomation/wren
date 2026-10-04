/**
 * Stores the cross-checks (`checks.ts`) per lead. Free and call-free, so a rerun
 * just recomputes: the profiles stage rechecks a firm's leads after each person,
 * and `wren enrich checks` backfills a niche.
 */
import type { Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { leadChecks } from "../schema.js";
import { type CompanyPage, checkLead, type LookupFinding, type NamedPerson } from "./checks.js";

export interface RecheckStats {
  companies: number;
  leads: number;
  /** Leads where the mailbox fits someone else or the person moved on. */
  wrong_person: number;
}

interface LeadRow {
  lead_id: number;
  email: string;
  company_id: number;
  person_id: number | null;
}
interface PersonRow {
  id: number;
  company_id: number;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
}
interface CompanyRow {
  id: number;
  domain: string | null;
  phone: string | null;
  lookup_state: string | null;
  page_id: number | null;
  page: Record<string, unknown> | null;
}
interface LookupRow {
  person_id: number;
  id: number;
  kind: string;
  confidence: number;
  value: Record<string, unknown>;
}

const rows = async <T>(db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as T[];

const idList = (ids: readonly number[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

/** Recompute every check for these firms' leads; stale kinds (a skip now) are removed. */
export async function recheckLeads(
  db: Queryable,
  companyIds: readonly number[],
): Promise<RecheckStats> {
  const stats: RecheckStats = { companies: 0, leads: 0, wrong_person: 0 };
  const ids = [...new Set(companyIds)];
  if (ids.length === 0) return stats;
  const leads = await rows<LeadRow>(
    db,
    sql`SELECT l.id AS lead_id, l.email, l.company_id, cand.person_id
      FROM leads l
      LEFT JOIN LATERAL (SELECT cc.person_id FROM contact_candidates cc
        WHERE cc.lead_id = l.id ORDER BY cc.id DESC LIMIT 1) cand ON true
      WHERE l.company_id IN (${idList(ids)})
      ORDER BY l.id`,
  );
  if (leads.length === 0) return stats;
  const people = await rows<PersonRow>(
    db,
    sql`SELECT id, company_id, full_name, first_name, last_name, title FROM people
      WHERE company_id IN (${idList(ids)})`,
  );
  const firms = await rows<CompanyRow>(
    db,
    sql`SELECT c.id, c.domain, NULLIF(c.raw ->> 'phone', '') AS phone, cl.state AS lookup_state,
        page.id AS page_id, page.value AS page
      FROM companies c
      LEFT JOIN company_lookups cl ON cl.company_id = c.id
      LEFT JOIN LATERAL (SELECT f.id, f.value FROM findings f
        WHERE f.company_id = c.id AND f.kind = 'profile'
        ORDER BY f.observed_at DESC, f.id DESC LIMIT 1) page ON true
      WHERE c.id IN (${idList(ids)})`,
  );
  const personIds = [
    ...new Set(leads.map((l) => l.person_id).filter((p): p is number => p !== null)),
  ];
  const lookups = personIds.length
    ? await rows<LookupRow>(
        db,
        sql`SELECT DISTINCT ON (f.person_id) f.person_id, f.id, f.kind, f.confidence, f.value
          FROM findings f
          WHERE f.person_id IN (${idList(personIds)}) AND f.kind IN ('still_there', 'job_change', 'left')
          ORDER BY f.person_id, f.observed_at DESC, f.id DESC`,
      )
    : [];

  const named = (p: PersonRow): NamedPerson & { title: string | null } => ({
    id: p.id,
    fullName: p.full_name,
    firstName: p.first_name,
    lastName: p.last_name,
    title: p.title,
  });
  const byId = new Map(people.map((p) => [p.id, p]));
  const atFirm = new Map<number, NamedPerson[]>();
  for (const p of people) atFirm.set(p.company_id, [...(atFirm.get(p.company_id) ?? []), named(p)]);
  const firmOf = new Map(firms.map((c) => [c.id, c]));
  const lookupOf = new Map(lookups.map((f) => [f.person_id, f]));

  const values: (typeof leadChecks.$inferInsert)[] = [];
  const kindsOf = new Map<number, string[]>();
  for (const l of leads) {
    const firm = firmOf.get(l.company_id);
    const person = l.person_id === null ? undefined : byId.get(l.person_id);
    const lookup = person ? lookupOf.get(person.id) : undefined;
    const page: CompanyPage | null =
      firm?.page_id != null && firm.page ? { id: firm.page_id, value: firm.page } : null;
    const outcomes = checkLead({
      email: l.email,
      firmDomain: firm?.domain ?? null,
      person: person ? named(person) : null,
      colleagues: atFirm.get(l.company_id) ?? [],
      lookup: lookup
        ? ({
            id: lookup.id,
            kind: lookup.kind,
            confidence: Number(lookup.confidence),
            value: lookup.value ?? {},
          } satisfies LookupFinding)
        : null,
      page,
      companyLookupState: firm?.lookup_state ?? null,
      importPhone: firm?.phone ?? null,
    });
    kindsOf.set(
      l.lead_id,
      outcomes.map((o) => o.kind),
    );
    if (
      outcomes.some(
        (o) => (o.kind === "mailbox_fits_name" || o.kind === "works_there") && o.result === "fail",
      )
    )
      stats.wrong_person += 1;
    for (const o of outcomes)
      values.push({ leadId: l.lead_id, kind: o.kind, result: o.result, evidence: o.evidence });
  }
  await db
    .insert(leadChecks)
    .values(values)
    .onConflictDoUpdate({
      target: [leadChecks.leadId, leadChecks.kind],
      set: {
        result: sql`excluded.result`,
        evidence: sql`excluded.evidence`,
        checkedAt: sql`now()`,
      },
    });
  // A role mailbox skips the name check: drop one left from before it read as a role.
  const skipped = [...kindsOf].filter(([, kinds]) => !kinds.includes("mailbox_fits_name"));
  if (skipped.length)
    await db.delete(leadChecks).where(
      and(
        inArray(
          leadChecks.leadId,
          skipped.map(([id]) => id),
        ),
        eq(leadChecks.kind, "mailbox_fits_name"),
      ),
    );
  stats.companies = new Set(leads.map((l) => l.company_id)).size;
  stats.leads = leads.length;
  return stats;
}

/** Every firm of a niche that has a lead, a chunk at a time, in id order. */
export async function recheckNiche(
  db: Queryable,
  niche: string,
  opts: { chunk?: number; onChunk?: (s: RecheckStats) => void } = {},
): Promise<RecheckStats> {
  const total: RecheckStats = { companies: 0, leads: 0, wrong_person: 0 };
  const chunk = opts.chunk ?? 500;
  let after = 0;
  for (;;) {
    const page = await rows<{ id: number }>(
      db,
      sql`SELECT c.id FROM companies c
        WHERE c.niche = ${niche} AND c.id > ${after}
          AND EXISTS (SELECT 1 FROM leads l WHERE l.company_id = c.id)
        ORDER BY c.id LIMIT ${chunk}`,
    );
    if (page.length === 0) return total;
    const s = await recheckLeads(
      db,
      page.map((r) => r.id),
    );
    opts.onChunk?.(s);
    total.companies += s.companies;
    total.leads += s.leads;
    total.wrong_person += s.wrong_person;
    after = (page.at(-1) as { id: number }).id;
  }
}
