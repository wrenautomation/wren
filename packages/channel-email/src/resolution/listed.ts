/**
 * Listed contacts: a lead an import named (SBA's point of contact, with their own
 * address) is a person at its firm, and that address is theirs. The people importer
 * makes the person (origin `registry`); the address becomes their candidate, born
 * linked to the lead. No guessing and no promotion: the lead's own verdict settles
 * the candidate (`runVerification`), so compose finds the person once the lead is
 * proven.
 *
 * Idempotent: a lead some candidate already names is skipped.
 */
import {
  companies,
  emailDomain,
  inPlay,
  isRoleLocalpart,
  type Lead,
  type LeadStatus,
  leads,
  type PersonItem,
  type PersonSource,
  personRow,
  runPeopleImport,
} from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { type CandidateState, contactCandidates } from "../schema.js";

/** The candidate state a lead's status already settles. */
export const settledBy = (status: LeadStatus): CandidateState | null =>
  status === "verified" ? "verified" : status === "undeliverable" ? "rejected" : null;

export interface ListedContactsStats {
  leads: number;
  people_created: number;
  people_seen: number;
  candidates: number;
  /** Candidates born settled: the lead already had its verdict. */
  settled: number;
  /** Named leads skipped: a role inbox (jobs@) is not the person's own address. */
  role_inboxes: number;
}

interface ListedRow {
  lead: Lead;
  sourceKey: string | null;
  domain: string | null;
  companyName: string | null;
}

const fullNameOf = (l: Lead) => [l.firstName, l.lastName].filter(Boolean).join(" ").trim();

class ListedContactSource implements PersonSource {
  readonly sourceType = "listed-contacts";
  readonly sourceRef: string;
  constructor(
    niche: string,
    private readonly rows_: readonly ListedRow[],
  ) {
    this.sourceRef = `leads:${niche}`;
  }
  *rows(): Iterable<PersonItem> {
    for (const { lead, sourceKey, domain, companyName } of this.rows_)
      yield personRow({
        companySourceKey: sourceKey,
        companyDomain: sourceKey ? null : domain,
        companyName,
        fullName: fullNameOf(lead),
        firstName: lead.firstName,
        lastName: lead.lastName,
        title: lead.title,
        origin: "registry",
        originRef: `lead:${lead.id}`,
        raw: { email: lead.email, lead_id: lead.id },
      });
  }
}

/** Make people of a niche's named leads at firms in play, each holding its lead's address. */
export async function runListedContacts(
  db: Queryable,
  niche: string,
): Promise<ListedContactsStats> {
  const found = await db
    .select({
      lead: leads,
      sourceKey: companies.sourceKey,
      domain: companies.domain,
      companyName: companies.name,
    })
    .from(leads)
    .innerJoin(companies, eq(companies.id, leads.companyId))
    .where(
      and(
        eq(companies.niche, niche),
        inPlay,
        isNotNull(leads.firstName),
        inArray(leads.status, ["imported", "verified"]),
        notExists(
          db
            .select({ one: sql`1` })
            .from(contactCandidates)
            .where(eq(contactCandidates.leadId, leads.id)),
        ),
      ),
    )
    .orderBy(asc(leads.id));
  const stats: ListedContactsStats = {
    leads: 0,
    people_created: 0,
    people_seen: 0,
    candidates: 0,
    settled: 0,
    role_inboxes: 0,
  };
  const named = found.filter((r) => {
    if (!fullNameOf(r.lead)) return false;
    if (isRoleLocalpart(r.lead.email)) {
      stats.role_inboxes += 1;
      return false;
    }
    return true;
  });
  stats.leads = named.length;
  if (named.length === 0) return stats;

  const byRef = new Map(named.map((r) => [`lead:${r.lead.id}`, r.lead]));
  const result = await runPeopleImport(db, new ListedContactSource(niche, named), {
    niche,
    onPerson: async ({ person, row }) => {
      const lead = byRef.get(row.originRef);
      if (!lead) return;
      const settled = settledBy(lead.status);
      const added = await db
        .insert(contactCandidates)
        .values({
          personId: person.id,
          email: lead.email,
          domain: emailDomain(lead.email),
          // The source printed this address beside the person: their own, not a guess.
          evidence: "scraped",
          rank: 0,
          state: settled ?? "candidate",
          sourceRef: row.originRef,
          leadId: lead.id,
        })
        .onConflictDoNothing()
        .returning({ id: contactCandidates.id });
      stats.candidates += added.length;
      await db.update(leads).set({ personId: person.id }).where(eq(leads.id, lead.id));
      if (settled && added.length) stats.settled += 1;
    },
  });
  stats.people_created = result.stats.people_created;
  stats.people_seen = result.stats.people_seen;
  return stats;
}
