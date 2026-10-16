/**
 * How often the machine and William agree, per kind, with what it cost: the numbers that say when
 * a kind could move to `gate`. Promotion stays his yes.
 *
 * His newest call on each subject counts once. It is matched to the newest answered decision made
 * before it, else the first one after (a backfilled call, asked about later: the state never holds
 * his call, so the answer is still blind to it). Agreement is on keep vs drop.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { keepSql } from "./calls.js";
import { decideModes } from "./decide.js";
import { DECISION_KINDS, type DecideMode, type DecisionKind, GATE_AT, KINDS } from "./kinds.js";

export interface KindStats {
  kind: DecisionKind;
  name: string;
  mode: DecideMode;
  /** Subjects he called. */
  calls: number;
  /** Of those, with a decision to compare. */
  judged: number;
  agreed: number;
  /** agreed / judged; null with none judged. */
  rate: number | null;
  /** Calls against a pick he was shown. */
  overrides: number;
  decisions: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  usdToday: number;
  /** Meets `GATE_AT`: a gate could be offered (and built). */
  gateReady: boolean;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

export async function decideStats(db: Queryable, now = new Date()): Promise<KindStats[]> {
  const modes = await decideModes(db);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const out: KindStats[] = [];
  for (const kind of DECISION_KINDS) {
    const keeps = keepSql(kind, sql`d.label`);
    const [c] = (await db.execute(sql`
      with last as (
        select distinct on (subject) subject, keep, at
        from decision_calls where kind = ${kind}
        order by subject, at desc, id desc
      ), matched as (
        select l.subject, l.keep, coalesce(b.label, a.label) as label
        from last l
        left join lateral (select x.label from decisions x where x.kind = ${kind}
          and x.subject = l.subject and x.label is not null and x.at <= l.at
          order by x.at desc, x.id desc limit 1) b on true
        left join lateral (select x.label from decisions x where x.kind = ${kind}
          and x.subject = l.subject and x.label is not null and x.at > l.at
          order by x.at, x.id limit 1) a on true
      )
      select count(*)::int as calls,
        count(*) filter (where d.label is not null)::int as judged,
        count(*) filter (where d.label is not null and ${keeps} = d.keep)::int as agreed,
        (select count(*) from decision_calls where kind = ${kind} and override)::int as overrides
      from matched d`)) as unknown as Row[];
    const [m] = (await db.execute(sql`
      select count(*)::int as decisions,
        count(*) filter (where label is null)::int as failed,
        coalesce(sum(input_tokens), 0)::bigint as input_tokens,
        coalesce(sum(output_tokens), 0)::bigint as output_tokens,
        coalesce(sum(cost_usd), 0)::float8 as usd,
        coalesce(sum(cost_usd) filter (where at >= ${day.toISOString()}::timestamptz), 0)::float8 as usd_today
      from decisions where kind = ${kind}`)) as unknown as Row[];
    const judged = num(c?.judged);
    const agreed = num(c?.agreed);
    const rate = judged ? agreed / judged : null;
    out.push({
      kind,
      name: KINDS[kind].name,
      mode: modes[kind],
      calls: num(c?.calls),
      judged,
      agreed,
      rate,
      overrides: num(c?.overrides),
      decisions: num(m?.decisions),
      failed: num(m?.failed),
      inputTokens: num(m?.input_tokens),
      outputTokens: num(m?.output_tokens),
      usd: num(m?.usd),
      usdToday: num(m?.usd_today),
      gateReady: rate !== null && judged >= GATE_AT.calls && rate >= GATE_AT.rate,
    });
  }
  return out;
}
