/**
 * The distill set: one `wren.decision/1` record per answered decision, with his newest call on the
 * same subject when he made one. A model of our own (Laya) trains on state → his label, and on
 * where Jev and he differ.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import type { DecisionKind } from "./kinds.js";

export const DECISION_SCHEMA = "wren.decision/1";

export interface DecisionRecord {
  schema: typeof DECISION_SCHEMA;
  id: number;
  kind: DecisionKind;
  subject: string;
  at: string;
  mode: string;
  backend: string;
  model: string;
  state: unknown;
  questions: unknown;
  answers: unknown;
  label: string;
  p: number | null;
  confidence: number | null;
  /** His newest call on the subject; null when he hasn't made one. */
  call: { label: string; keep: boolean; source: string; at: string } | null;
}

type Row = Record<string, unknown>;
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

export async function decisionRecords(
  db: Queryable,
  o: { kind?: DecisionKind; called?: boolean; since?: Date } = {},
): Promise<DecisionRecord[]> {
  const where = [sql`d.label is not null`];
  if (o.kind) where.push(sql`d.kind = ${o.kind}`);
  if (o.since) where.push(sql`d.at >= ${o.since.toISOString()}::timestamptz`);
  if (o.called) where.push(sql`c.label is not null`);
  const rows = (await db.execute(sql`
    select d.id, d.kind, d.subject, d.at, d.mode, d.backend, d.model, d.state, d.questions,
      d.answers, d.label, d.p, d.confidence,
      c.label as call_label, c.keep as call_keep, c.source as call_source, c.at as call_at
    from decisions d
    left join lateral (select x.label, x.keep, x.source, x.at from decision_calls x
      where x.kind = d.kind and x.subject = d.subject order by x.at desc, x.id desc limit 1) c on true
    where ${sql.join(where, sql` and `)}
    order by d.at, d.id`)) as unknown as Row[];
  return rows.map((r) => ({
    schema: DECISION_SCHEMA,
    id: Number(r.id),
    kind: r.kind as DecisionKind,
    subject: String(r.subject),
    at: iso(r.at),
    mode: String(r.mode),
    backend: String(r.backend),
    model: String(r.model),
    state: r.state,
    questions: r.questions,
    answers: r.answers,
    label: String(r.label),
    p: r.p == null ? null : Number(r.p),
    confidence: r.confidence == null ? null : Number(r.confidence),
    call:
      r.call_label == null
        ? null
        : {
            label: String(r.call_label),
            keep: Boolean(r.call_keep),
            source: String(r.call_source),
            at: iso(r.call_at),
          },
  }));
}
