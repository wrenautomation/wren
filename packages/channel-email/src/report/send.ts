/**
 * One weekly pass: collect, render, store, mail. The row is written before
 * the send so a mail failure leaves the report readable in Postgres and the
 * next pass still has last week's numbers for its deltas.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "@wren/db";
import { and, desc, eq } from "drizzle-orm";
import { reports } from "../schema.js";
import type { Transport } from "../send/transport.js";
import { collectWeekly, renderWeekly, type WeeklyStats } from "./weekly.js";

export interface WeeklyReportDeps {
  db: Db;
  transport: Transport;
  /** null = store only (the CLI print, a dry run). */
  mail: { to: string; from: string } | null;
  /** The period end; the report covers the `days` before it. */
  now: Date;
  days?: number;
  runId?: string | null;
}

export interface WeeklyReportStats extends Record<string, unknown> {
  reportId: number;
  periodStart: string;
  periodEnd: string;
  sent: number;
  replies: number;
  mailedTo: string | null;
  body: string;
}

/** The latest stored week ending at or before `before`: the one this week's deltas are against. */
export async function previousWeekly(db: Db, before: Date): Promise<WeeklyStats | null> {
  const [row] = await db
    .select({ stats: reports.stats })
    .from(reports)
    .where(and(eq(reports.kind, "weekly")))
    .orderBy(desc(reports.periodEnd))
    .limit(1);
  if (!row) return null;
  const prev = row.stats as WeeklyStats;
  return new Date(prev.periodEnd) <= before ? prev : null;
}

export async function runWeeklyReport(deps: WeeklyReportDeps): Promise<WeeklyReportStats> {
  const stats = await collectWeekly(deps.db, { now: deps.now, days: deps.days });
  const previous = await previousWeekly(deps.db, new Date(stats.periodStart));
  const body = renderWeekly(stats, previous);
  const [row] = await deps.db
    .insert(reports)
    .values({
      kind: "weekly",
      periodStart: new Date(stats.periodStart),
      periodEnd: new Date(stats.periodEnd),
      stats,
      body,
      sentTo: null,
      runId: deps.runId ?? null,
    })
    .returning({ id: reports.id });
  if (!row) throw new Error("reports insert returned no row");

  let mailedTo: string | null = null;
  if (deps.mail) {
    const domain = deps.mail.from.slice(deps.mail.from.lastIndexOf("@") + 1);
    await deps.transport.send({
      fromAddress: deps.mail.from,
      fromName: "Wren",
      to: deps.mail.to,
      subject: `wren weekly: ${stats.headline.week.sent} sent, ${stats.headline.week.replies} replies`,
      replySubject: null,
      body,
      messageId: `<${randomUUID().replaceAll("-", "")}@${domain}>`,
    });
    mailedTo = deps.mail.to;
    await deps.db.update(reports).set({ sentTo: mailedTo }).where(eq(reports.id, row.id));
  }
  return {
    reportId: row.id,
    periodStart: stats.periodStart,
    periodEnd: stats.periodEnd,
    sent: stats.headline.week.sent,
    replies: stats.headline.week.replies,
    mailedTo,
    body,
  };
}
