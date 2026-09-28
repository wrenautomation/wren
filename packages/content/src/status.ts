/**
 * `wren status`: is the content week on track? One screen from live tables.
 * The week slipped when it is Thursday or later (UTC, Monday first) and
 * nothing was drafted since Monday.
 */
import type { Queryable } from "@wren/db";
import { and, count, eq, gte, isNotNull, min, sql } from "drizzle-orm";
import { contentDrafts, contentIdeas } from "./schema.js";

export const THURSDAY = 3; // Monday-based weekday, Monday is 0
const DAY_MS = 86_400_000;

export interface StatusReport {
  draftsByStatus: Readonly<Record<string, number>>;
  oldestDraftDays: number | null;
  openIdeas: number;
  draftedThisWeek: number;
  tokensThisMonth: { calls: number; input: number; output: number };
}

/** Date.getUTCDay() has Sunday = 0; shift so Monday = 0 and Sunday = 6. */
export function mondayBasedWeekday(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

export function startOfWeekUtc(today: Date): Date {
  return new Date(today.getTime() - mondayBasedWeekday(today) * DAY_MS);
}

/** Pure rule: Thursday or later with nothing drafted this week. `today` is UTC midnight. */
export function weekSlipped(today: Date, draftedThisWeek: number): boolean {
  return mondayBasedWeekday(today) >= THURSDAY && draftedThisWeek === 0;
}

/** Pure rendering so the screen is unit-tested without a database. */
export function formatStatusLines(r: StatusReport): string[] {
  const lines = Object.entries(r.draftsByStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => `drafts ${name.padEnd(10)} ${n}`);
  lines.push(
    r.oldestDraftDays === null
      ? "nothing waiting for review"
      : `oldest draft waiting: ${r.oldestDraftDays} day(s)`,
  );
  lines.push(`open ideas: ${r.openIdeas}`);
  lines.push(`drafted this week: ${r.draftedThisWeek}`);
  const t = r.tokensThisMonth;
  lines.push(`drafting this month: ${t.calls} calls, ${t.input} in, ${t.output} out`);
  return lines;
}

const usage = (key: string) =>
  sql<number>`coalesce(sum((${contentDrafts.llm}#>>'{call,usage,${sql.raw(key)}}')::int), 0)::int`;

/** UTC midnight of `now`. */
export function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Five aggregate queries; no rows are loaded. Weeks and months are UTC. */
export async function collectStatus(db: Queryable, now: Date): Promise<StatusReport> {
  const today = startOfDayUtc(now);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const [byStatus, [waiting], [ideas], [week], [tokens]] = await Promise.all([
    db
      .select({ status: contentDrafts.status, n: count() })
      .from(contentDrafts)
      .groupBy(contentDrafts.status),
    db
      .select({ oldest: min(contentDrafts.createdAt) })
      .from(contentDrafts)
      .where(eq(contentDrafts.status, "draft")),
    db.select({ n: count() }).from(contentIdeas).where(eq(contentIdeas.status, "open")),
    db
      .select({ n: count() })
      .from(contentDrafts)
      .where(gte(contentDrafts.createdAt, startOfWeekUtc(today))),
    db
      .select({ calls: count(), input: usage("input"), output: usage("output") })
      .from(contentDrafts)
      .where(and(gte(contentDrafts.createdAt, monthStart), isNotNull(contentDrafts.llm))),
  ]);
  const draftsByStatus: Record<string, number> = {};
  for (const row of byStatus) draftsByStatus[row.status] = row.n;
  const oldest = waiting?.oldest ?? null;
  return {
    draftsByStatus,
    oldestDraftDays:
      oldest === null ? null : Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / DAY_MS)),
    openIdeas: ideas?.n ?? 0,
    draftedThisWeek: week?.n ?? 0,
    tokensThisMonth: {
      calls: tokens?.calls ?? 0,
      input: tokens?.input ?? 0,
      output: tokens?.output ?? 0,
    },
  };
}
