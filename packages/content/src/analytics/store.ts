/**
 * Where insights land: a post's numbers per day (`post_metric_days`), an account's
 * (`account_metric_days`), and each metric's last state (`metric_sources`). The day is UTC; a
 * second look the same day replaces that day's value, never an earlier day's.
 */
import type { AccountInsights, InsightGap, Insights, Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { accountMetricDays, metricSources, postMetricDays } from "../schema.js";

const dayOf = (iso: string) => iso.slice(0, 10);
const x = (c: string) => sql.raw(`excluded.${c}`);

/** One row per (metric, key): a platform that answers a key twice keeps the last. */
function uniq<T extends { metric: string; key?: string | undefined }>(rows: readonly T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(`${r.metric}|${r.key ?? ""}`, r);
  return [...m.values()];
}

/** Each metric that came back is live; each gap keeps its state and the platform's words. */
async function writeSources(
  db: Queryable,
  platform: Platform,
  live: readonly string[],
  gaps: readonly InsightGap[],
  at: Date,
): Promise<void> {
  const rows = new Map<string, typeof metricSources.$inferInsert>();
  for (const g of gaps)
    rows.set(g.metric, { platform, metric: g.metric, state: g.state, why: g.why, checkedAt: at });
  // A number that came back wins over a gap for the same name (X's clicks on one leg, not another).
  for (const m of live)
    rows.set(m, { platform, metric: m, state: "live", why: null, checkedAt: at, liveAt: at });
  if (!rows.size) return;
  await db
    .insert(metricSources)
    .values([...rows.values()])
    .onConflictDoUpdate({
      target: [metricSources.platform, metricSources.metric],
      set: {
        state: x("state"),
        why: x("why"),
        checkedAt: x("checked_at"),
        liveAt: sql`coalesce(excluded.live_at, ${metricSources.liveAt})`,
      },
    });
}

/** A post's insights for the day they were read. Returns the rows written. */
export async function writeInsights(
  db: Queryable,
  draftId: string,
  platform: Platform,
  i: Insights,
  now: Date,
): Promise<number> {
  const day = dayOf(i.asOf || now.toISOString());
  const values = uniq(i.values);
  if (values.length)
    await db
      .insert(postMetricDays)
      .values(
        values.map((v) => ({
          draftId,
          day,
          metric: v.metric,
          key: (v.key ?? "").slice(0, 200),
          value: v.value,
          fetchedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          postMetricDays.draftId,
          postMetricDays.day,
          postMetricDays.metric,
          postMetricDays.key,
        ],
        set: { value: x("value"), fetchedAt: x("fetched_at") },
      });
  await writeSources(db, platform, [...new Set(values.map((v) => v.metric))], i.gaps, now);
  return values.length;
}

/** An account's days. Returns the rows written. */
export async function writeAccountInsights(
  db: Queryable,
  platform: Platform,
  a: AccountInsights,
  now: Date,
): Promise<number> {
  const rows = a.days.flatMap((d) =>
    uniq(d.values).map((v) => ({
      platform,
      day: d.day,
      metric: v.metric,
      key: (v.key ?? "").slice(0, 200),
      value: v.value,
      fetchedAt: now,
    })),
  );
  if (rows.length)
    await db
      .insert(accountMetricDays)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          accountMetricDays.platform,
          accountMetricDays.day,
          accountMetricDays.metric,
          accountMetricDays.key,
        ],
        set: { value: x("value"), fetchedAt: x("fetched_at") },
      });
  // An account's gaps share the table with its posts': prefixed so neither hides the other.
  await writeSources(
    db,
    platform,
    [...new Set(rows.map((r) => `account.${r.metric}`))],
    a.gaps.map((g) => ({ ...g, metric: `account.${g.metric}` })),
    now,
  );
  return rows.length;
}
