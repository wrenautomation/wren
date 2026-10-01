/**
 * The email side of a dossier: each person's addresses with their newest
 * verdict, and the company's own inboxes (leads no person owns, such as
 * info@). Facts in the research dossier's shape, merged by `withFacts`.
 */
import { leads } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import type { Fact, MoreFacts } from "@wren/research/dossier";
import { desc, inArray } from "drizzle-orm";
import { contactCandidates, verifications } from "./schema.js";

const pageOrNull = (ref: string): string | null => (/^https?:\/\//.test(ref) ? ref : null);

export async function emailFacts(
  db: Queryable,
  companyIds: readonly number[],
  personIds: readonly number[],
): Promise<MoreFacts> {
  const byCompany = new Map<number, Fact[]>();
  const byPerson = new Map<number, Fact[]>();
  const add = (map: Map<number, Fact[]>, id: number, fact: Fact) => {
    const list = map.get(id);
    if (list) list.push(fact);
    else map.set(id, [fact]);
  };

  const candidates = personIds.length
    ? await db
        .select()
        .from(contactCandidates)
        .where(inArray(contactCandidates.personId, [...personIds]))
    : [];
  const verdicts = candidates.length
    ? await db
        .selectDistinctOn([verifications.contactCandidateId])
        .from(verifications)
        .where(
          inArray(
            verifications.contactCandidateId,
            candidates.map((c) => c.id),
          ),
        )
        .orderBy(verifications.contactCandidateId, desc(verifications.checkedAt))
    : [];
  const verdictOf = new Map(verdicts.map((v) => [v.contactCandidateId, v]));
  for (const c of candidates) {
    const v = verdictOf.get(c.id);
    add(byPerson, c.personId, {
      what: "email",
      value: {
        address: c.email,
        state: c.state,
        evidence: c.evidence,
        rank: c.rank,
        verdict: v?.result ?? null,
      },
      confidence: null,
      source: pageOrNull(c.sourceRef),
      via: v?.verifier ?? c.evidence,
      seenAt: v?.checkedAt ?? c.createdAt,
    });
  }

  const owned = new Set(candidates.flatMap((c) => (c.leadId === null ? [] : [c.leadId])));
  const inboxes = companyIds.length
    ? await db
        .select()
        .from(leads)
        .where(inArray(leads.companyId, [...companyIds]))
    : [];
  for (const l of inboxes) {
    if (l.companyId === null || owned.has(l.id)) continue;
    add(byCompany, l.companyId, {
      what: "email",
      value: { address: l.email, status: l.status, persona: l.persona },
      confidence: null,
      source: null,
      via: l.source ?? "import",
      seenAt: l.createdAt,
    });
  }
  return { byCompany, byPerson };
}
