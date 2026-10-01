/**
 * The numbers: per sequence step (a reminder counts under its template, not
 * the contact's sequence), how many went out, arrived, got a reply,
 * said yes, opted out; each rate with its Wilson interval (core/stats), so a
 * 2-of-9 week never reads as "22% reply rate". Plus spend.
 */
import { formatRate, wilsonInterval } from "@wren/core/stats";
import type { Queryable } from "@wren/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { smsContacts, smsMessages } from "./schema.js";

export interface Rate {
  k: number;
  n: number;
  low: number;
  high: number;
  text: string;
}

export function rate(k: number, n: number): Rate {
  const { low, high } = wilsonInterval(Math.min(k, n), n);
  return { k, n, low, high, text: formatRate(Math.min(k, n), n) };
}

export interface StepRow {
  /** The contact's sequence, or a reminder's template key. */
  sequence: string | null;
  step: number | null;
  sent: number;
  delivered: number;
  failed: number;
  costUsd: number;
}

export interface SmsStats {
  since: string;
  steps: StepRow[];
  contacts: Record<string, number>;
  /** Contacts texted at least once in the window. */
  texted: number;
  delivery: Rate;
  reply: Rate;
  interested: Rate;
  optOut: Rate;
  costUsd: number;
  /** Spend per reply, when there is one. */
  costPerReplyUsd: number | null;
}

export async function smsStats(
  db: Queryable,
  opts: { since: Date; niche?: string | null },
): Promise<SmsStats> {
  const niche = opts.niche ? eq(smsContacts.niche, opts.niche) : undefined;
  const row = sql<
    string | null
  >`CASE WHEN ${smsMessages.kind} = 'reminder' THEN ${smsMessages.template} ELSE ${smsContacts.sequence} END`;
  const steps = await db
    .select({
      sequence: row,
      step: smsMessages.step,
      sent: sql<number>`count(*) FILTER (WHERE ${smsMessages.state} IN ('sent','delivered','failed','unknown'))::int`,
      delivered: sql<number>`count(*) FILTER (WHERE ${smsMessages.state} = 'delivered')::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${smsMessages.state} = 'failed')::int`,
      costUsd: sql<number>`coalesce(sum(${smsMessages.costUsd}), 0)::float8`,
    })
    .from(smsMessages)
    .innerJoin(smsContacts, eq(smsContacts.id, smsMessages.contactId))
    .where(and(eq(smsMessages.direction, "out"), gte(smsMessages.attemptedAt, opts.since), niche))
    .groupBy(row, smsMessages.step)
    .orderBy(row, smsMessages.step);
  const [who] = await db
    .select({
      texted: sql<number>`count(DISTINCT ${smsMessages.contactId}) FILTER (WHERE ${smsMessages.direction} = 'out' AND ${smsMessages.state} IN ('sent','delivered','failed','unknown'))::int`,
      replied: sql<number>`count(DISTINCT ${smsMessages.contactId}) FILTER (WHERE ${smsMessages.direction} = 'in')::int`,
      interested: sql<number>`count(DISTINCT ${smsMessages.contactId}) FILTER (WHERE ${smsMessages.direction} = 'in' AND ${smsMessages.disposition} = 'interested')::int`,
      optedOut: sql<number>`count(DISTINCT ${smsMessages.contactId}) FILTER (WHERE ${smsMessages.direction} = 'in' AND ${smsMessages.disposition} = 'opt_out')::int`,
    })
    .from(smsMessages)
    .innerJoin(smsContacts, eq(smsContacts.id, smsMessages.contactId))
    .where(
      and(
        gte(
          sql`coalesce(${smsMessages.attemptedAt}, ${smsMessages.receivedAt})`,
          opts.since.toISOString(),
        ),
        niche,
      ),
    );
  const states = await db
    .select({ state: smsContacts.state, n: sql<number>`count(*)::int` })
    .from(smsContacts)
    .where(niche)
    .groupBy(smsContacts.state);
  const texted = who?.texted ?? 0;
  const replied = who?.replied ?? 0;
  const delivered = steps.reduce((s, r) => s + r.delivered, 0);
  const failed = steps.reduce((s, r) => s + r.failed, 0);
  const costUsd = steps.reduce((s, r) => s + r.costUsd, 0);
  return {
    since: opts.since.toISOString(),
    steps,
    contacts: Object.fromEntries(states.map((s) => [s.state, s.n])),
    texted,
    delivery: rate(delivered, delivered + failed),
    reply: rate(replied, texted),
    interested: rate(who?.interested ?? 0, texted),
    optOut: rate(who?.optedOut ?? 0, texted),
    costUsd,
    costPerReplyUsd: replied > 0 ? costUsd / replied : null,
  };
}
