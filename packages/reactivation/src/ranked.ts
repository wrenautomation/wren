/**
 * The list the client works from: CRM people best score first, with why and
 * their brief. `crm top` prints it; the portal will show it.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import type { Reason } from "./score.js";
import { LATEST_CRM_ROW } from "./score.js";

export interface RankedContact {
  personId: number;
  name: string;
  firm: string;
  score: number;
  reasons: Reason[];
  /** Null until a brief with a kept sentence exists. */
  brief: string | null;
}

export async function rankedContacts(
  db: Queryable,
  opts: { limit?: number } = {},
): Promise<RankedContact[]> {
  const rows = await db.execute<{
    person_id: number;
    first_name: string | null;
    last_name: string | null;
    firm: string;
    score: number;
    reasons: Reason[];
    brief: string | null;
  }>(sql`
    with latest as (${LATEST_CRM_ROW})
    select s.person_id, p.first_name, p.last_name, coalesce(co.name, co.domain, '?') firm,
      s.score, s.reasons, b.text brief
    from contact_scores s
    join latest l on l.person_id = s.person_id
    join people p on p.id = s.person_id
    join companies co on co.id = l.company_id
    left join briefs b on b.person_id = s.person_id and b.state = 'written' and s.score > 0
    order by s.score desc, s.person_id
    limit ${opts.limit ?? 20}`);
  return rows.map((r) => ({
    personId: r.person_id,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "(no name)",
    firm: r.firm,
    score: r.score,
    reasons: r.reasons,
    brief: r.brief,
  }));
}

export function formatRanked(list: RankedContact[]): string[] {
  return list.flatMap((c) => [
    `${String(c.score).padStart(3)}  ${c.name}, ${c.firm}  (person ${c.personId})`,
    `     ${c.reasons.map((r) => `${r.reason} +${r.points}`).join("; ")}`,
    ...(c.brief ? [`     ${c.brief}`] : []),
  ]);
}
