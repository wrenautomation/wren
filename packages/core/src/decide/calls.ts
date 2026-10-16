/**
 * William's calls beside the machine's (designs/2026-10-16-decide.md): his label, kept or not, and
 * whether he went against a pick he was shown. Only the schema and the kinds: draft steps and
 * Learn marks write these from anywhere without pulling in settings or Restate.
 */
import type { Queryable } from "@wren/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { decisionCalls } from "../decide-schema.js";
import { type DecisionKind, KINDS, keepOf } from "./kinds.js";

/** SQL true when a decision row's label keeps the thing. */
export const keepSql = (kind: DecisionKind, label: ReturnType<typeof sql>) => {
  const keeps = Object.entries(KINDS[kind].labels)
    .filter(([, l]) => l.keep)
    .map(([k]) => k);
  return sql`(${label} in (${sql.join(
    keeps.map((k) => sql`${k}`),
    sql`, `,
  )}))`;
};

export interface CallInput {
  kind: DecisionKind;
  subject: string;
  /** His call in the kind's labels. */
  label: string;
  /** Where: `sent`, `rejected`, `star`, `archive`, `backfill:draft`. */
  source: string;
  by?: string | null;
  /** Unique: a replay or a second backfill adds nothing. */
  ref?: string | null;
  /** History's own time; left out, now. */
  at?: Date;
}

/**
 * Keep his call, linked to the newest answered decision before it. One statement, so a draft step
 * that writes it inside its own transaction adds one more insert and nothing else.
 */
export async function recordCall(db: Queryable, c: CallInput): Promise<void> {
  const keep = keepOf(c.kind, c.label);
  const at = c.at ? sql`${c.at.toISOString()}::timestamptz` : sql`clock_timestamp()`;
  await db.execute(sql`
    insert into decision_calls (kind, subject, label, keep, source, by, decision_id, agreed, override, ref, at)
    select ${c.kind}, ${c.subject}, ${c.label}, ${keep}, ${c.source}, ${c.by ?? null},
      d.id,
      case when d.id is null then null else ${keepSql(c.kind, sql`d.label`)} = ${keep} end,
      coalesce(d.mode in ('recommend', 'gate') and ${keepSql(c.kind, sql`d.label`)} <> ${keep}, false),
      ${c.ref ?? null}, ${at}
    from (select 1) one
    left join lateral (
      select x.id, x.label, x.mode from decisions x
      where x.kind = ${c.kind} and x.subject = ${c.subject} and x.label is not null and x.at <= ${at}
      order by x.at desc, x.id desc limit 1
    ) d on true
    on conflict (ref) do nothing`);
}

/** His newest call on a subject. */
export async function newestCall(db: Queryable, kind: DecisionKind, subject: string) {
  const [r] = await db
    .select()
    .from(decisionCalls)
    .where(and(eq(decisionCalls.kind, kind), eq(decisionCalls.subject, subject)))
    .orderBy(desc(decisionCalls.at), desc(decisionCalls.id))
    .limit(1);
  return r ?? null;
}
