/**
 * `wren status`: the one screen that says whether the week is on track.
 * Exit 1 when it is Thursday or later and nothing is drafted.
 */
import { llmCalls } from "@wren/core/schema";
import type { Db } from "@wren/db";
import { count, eq, gte, max, min, sql, sum } from "drizzle-orm";
import { notes, posts, researchRuns } from "./schema.js";

export const THURSDAY = 3; // Monday-based weekday, Monday is 0 (same rule as the Python version)
export const DRAFT_STATUS = "draft";
export const NOTE_STATUS_NEW = "new";

export interface StatusReport {
  postsByStatus: Readonly<Record<string, number>>;
  oldestDraftDays: number | null;
  unusedNotes: number;
  lastResearchRunAt: Date | null;
  spendThisMonthUsd: number;
}

export function draftCount(report: StatusReport): number {
  return report.postsByStatus[DRAFT_STATUS] ?? 0;
}

/** Pure rule: Thursday or later with zero drafts means the week slipped. `today` is UTC midnight. */
export function draftsOverdue(today: Date, drafts: number): boolean {
  return mondayBasedWeekday(today) >= THURSDAY && drafts === 0;
}

/** Date.getUTCDay() has Sunday = 0; shift so Monday = 0 and Sunday = 6. */
export function mondayBasedWeekday(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/** Pure rendering so the screen is unit-tested without a database. */
export function formatStatusLines(report: StatusReport): string[] {
  const lines = Object.entries(report.postsByStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => `posts ${name.padEnd(10)} ${n}`);
  lines.push(
    report.oldestDraftDays === null
      ? "no drafts"
      : `oldest draft: ${report.oldestDraftDays} day(s)`,
  );
  lines.push(`unused notes: ${report.unusedNotes}`);
  lines.push(`last research run: ${report.lastResearchRunAt?.toISOString() ?? "never"}`);
  lines.push(`spend this month: $${report.spendThisMonthUsd.toFixed(2)}`);
  return lines;
}

const MS_PER_DAY = 86_400_000;

/** Five aggregate queries; no rows are loaded. `today` is UTC midnight. */
export async function collectStatus(db: Db, today: Date): Promise<StatusReport> {
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const [byStatus, [draft], [unused], [research], [spend]] = await Promise.all([
    db.select({ status: posts.status, n: count() }).from(posts).groupBy(posts.status),
    db
      .select({ oldest: min(posts.createdAt) })
      .from(posts)
      .where(eq(posts.status, DRAFT_STATUS)),
    db.select({ n: count() }).from(notes).where(eq(notes.status, NOTE_STATUS_NEW)),
    db.select({ last: max(researchRuns.createdAt) }).from(researchRuns),
    db
      .select({ usd: sql<number>`coalesce(${sum(llmCalls.costUsd)}, 0)::float8` })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, monthStart)),
  ]);
  const postsByStatus: Record<string, number> = {};
  for (const row of byStatus) postsByStatus[row.status] = row.n;
  const oldest = draft?.oldest ?? null;
  const oldestDraftDays =
    oldest === null ? null : Math.floor((today.getTime() - oldest.getTime()) / MS_PER_DAY);
  return {
    postsByStatus,
    oldestDraftDays,
    unusedNotes: unused?.n ?? 0,
    lastResearchRunAt: research?.last ?? null,
    spendThisMonthUsd: Number(spend?.usd ?? 0),
  };
}
