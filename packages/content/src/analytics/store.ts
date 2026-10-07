/**
 * Where insights land: a post's numbers per day (`post_metric_days`), an account's
 * (`account_metric_days`), and each metric's last state (`metric_sources`). The day is UTC; a
 * second look the same day replaces that day's value, never an earlier day's. A platform's
 * report rows (YouTube's reach report) land on the report's own day instead.
 */
import {
  type AccountInsights,
  type InsightGap,
  type Insights,
  METRICS as M,
  type Platform,
  type ReportDays,
} from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { accountMetricDays, contentDrafts, metricSources, postMetricDays } from "../schema.js";

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

/**
 * A platform's report days (YouTube's reach report), matched to our posts by published id: each
 * post's day rows (`impressions_day`, `ctr_day`) on the report's day, then its totals to each
 * held day (`impressions`, and `ctr` weighted by impressions). A later report for a day replaces
 * that day (YouTube's backfill); no look writes these names, and other days stay. Returns the
 * day rows written.
 */
export async function writeReportDays(
  db: Queryable,
  platform: Platform,
  r: ReportDays,
  now: Date,
): Promise<number> {
  const ids = [...new Set(r.rows.map((x) => x.id))];
  const drafts = ids.length
    ? await db
        .select({ id: contentDrafts.id, publishedId: contentDrafts.publishedId })
        .from(contentDrafts)
        .where(and(eq(contentDrafts.platform, platform), inArray(contentDrafts.publishedId, ids)))
    : [];
  const draftsOf = new Map<string, string[]>();
  for (const d of drafts)
    if (d.publishedId) draftsOf.set(d.publishedId, [...(draftsOf.get(d.publishedId) ?? []), d.id]);
  const byKey = new Map<string, typeof postMetricDays.$inferInsert>();
  for (const row of r.rows)
    for (const draftId of draftsOf.get(row.id) ?? [])
      for (const v of row.values) {
        const key = (v.key ?? "").slice(0, 200);
        byKey.set(`${draftId}|${row.day}|${v.metric}|${key}`, {
          draftId,
          day: row.day,
          metric: v.metric,
          key,
          value: v.value,
          fetchedAt: now,
        });
      }
  const rows = [...byKey.values()];
  if (rows.length) {
    await db
      .insert(postMetricDays)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          postMetricDays.draftId,
          postMetricDays.day,
          postMetricDays.metric,
          postMetricDays.key,
        ],
        set: { value: x("value"), fetchedAt: x("fetched_at") },
      });
    const touched = [...new Set(rows.map((x) => x.draftId))];
    await db.execute(sql`
      insert into post_metric_days (draft_id, day, metric, key, value, fetched_at)
      select t.draft_id, t.day, m.metric, '', m.value, ${now.toISOString()}::timestamptz
      from (
        select i.draft_id, i.day,
          sum(i.value) over w impressions,
          sum(i.value * coalesce(c.value, 0) / 100) over w clicks
        from post_metric_days i
        left join post_metric_days c on c.draft_id = i.draft_id and c.day = i.day
          and c.metric = ${M.ctrDay} and c.key = ''
        where i.metric = ${M.impressionsDay} and i.key = ''
          and i.draft_id in (${sql.join(
            touched.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
        window w as (partition by i.draft_id order by i.day)
      ) t
      cross join lateral (values (${M.impressions}::varchar, t.impressions),
        (${M.ctr}::varchar, case when t.impressions > 0 then t.clicks * 100 / t.impressions end)
      ) m(metric, value)
      where m.value is not null
      on conflict (draft_id, day, metric, key)
        do update set value = excluded.value, fetched_at = excluded.fetched_at`);
  }
  const live = rows.length
    ? [...new Set([...rows.map((x) => x.metric), M.impressions, M.ctr])]
    : [];
  await writeSources(db, platform, live, r.gaps, now);
  return rows.length;
}
