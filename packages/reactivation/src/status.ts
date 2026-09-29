/**
 * Where a client's reactivation stands and what runs next: one screen, so
 * nobody has to remember the order of the stages. `crm run` does the next
 * stages that are due; this says which those are.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { type CrmHealth, crmHealth } from "./crm/health.js";
import { dueForLookup } from "./lookup.js";

/** The stages `crm run` walks, in order. */
export const CRM_STAGES = ["verify", "lookup"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export interface CrmStatus {
  health: CrmHealth;
  lookup: {
    matched: number;
    unresolved: number;
    capped: number;
    /** Never looked up, or parked by a cap that has lifted. */
    due: number;
    /** When the next parked person can go; null when none waits. */
    waitingUntil: string | null;
  };
  /** The stages `crm run` would do now, in order; empty when nothing is due. */
  due: CrmStage[];
  /** One line: what to do next. */
  next: string;
}

export async function crmStatus(db: Queryable, today = new Date()): Promise<CrmStatus> {
  const health = await crmHealth(db, today);
  const [l] = await db.execute<{
    matched: number;
    unresolved: number;
    capped: number;
    due: number;
    waiting_until: string | null;
  }>(sql`
    select
      count(*) filter (where l.state = 'matched')::int matched,
      count(*) filter (where l.state = 'unresolved')::int unresolved,
      count(*) filter (where l.state = 'capped')::int capped,
      count(*) filter (where ${dueForLookup(sql`c.person_id`)})::int due,
      min(l.retry_at) filter (where l.state = 'capped' and l.retry_at > now())::text waiting_until
    from (select distinct person_id from crm_contacts) c
    left join person_lookups l on l.person_id = c.person_id`);
  const lookup = {
    matched: l?.matched ?? 0,
    unresolved: l?.unresolved ?? 0,
    capped: l?.capped ?? 0,
    due: l?.due ?? 0,
    waitingUntil: l?.waiting_until ?? null,
  };
  const count: Record<CrmStage, number> = {
    verify: health.verification.unchecked,
    lookup: lookup.due,
  };
  const due = CRM_STAGES.filter((s) => count[s] > 0);
  const next =
    health.rows === 0
      ? "import the CRM export: `wren --client <id> crm import <file> --format <name>`"
      : due.length
        ? `\`wren --client <id> crm run\`: ${due
            .map((s) =>
              s === "verify"
                ? `verify ${health.verification.unchecked} addresses`
                : `look up ${lookup.due} people`,
            )
            .join(", then ")}`
        : lookup.waitingUntil
          ? `wait: ${lookup.capped} people are parked on a daily cap until ${lookup.waitingUntil}`
          : "nothing due: everyone is verified and looked up";
  return { health, lookup, due, next };
}

export function formatCrmStatus(s: CrmStatus): string[] {
  const l = s.lookup;
  return [
    ...formatHealthBrief(s.health),
    `looked up: matched ${l.matched}  unresolved ${l.unresolved}  parked ${l.capped}  due ${l.due}`,
    `next: ${s.next}`,
  ];
}

function formatHealthBrief(h: CrmHealth): string[] {
  const v = h.verification;
  return [
    `people ${h.people}  companies ${h.companies}  rows ${h.rows}`,
    `emails: valid ${v.valid}  invalid ${v.invalid}  risky ${v.risky}  catch-all ${v.catch_all}  unchecked ${v.unchecked}`,
    `send gate: ${h.gate.reason}`,
  ];
}
