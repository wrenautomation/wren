/**
 * Live numbers for shipped samples (designs/2026-11-05-variants.md, Live data): each channel's
 * own tables, rolled into `outcomes` as totals to today per segment. Every ship writes `all`
 * plus its breakdowns, so `all` sums across ships without double counts.
 */

import { templateStats } from "@wren/core";
import { atomic, type Db } from "@wren/db";
import { siteEvents } from "@wren/sites/schema";
import { contentDrafts, postMetricDays } from "@wren/starling-inbound/schema";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { type Channel, outcomes, ships } from "./schema.js";

/** Post totals we keep: counts, then means weighted by views. */
export const POST_COUNTS = [
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "follows",
  "link_clicks",
] as const;
export const POST_MEANS = ["avg_view_pct", "hold_3s", "finish_rate", "skip_rate"] as const;
const SITE_EVENTS = ["view", "cta", "form", "book"] as const;

type Ship = typeof ships.$inferSelect;
interface Row {
  segment: string;
  metric: string;
  value: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A post: the latest total of each metric (rows hold totals to their day). */
async function post(db: Db, s: Ship): Promise<Row[]> {
  if (!UUID.test(s.target)) return [];
  const [draft] = await db
    .select({ platform: contentDrafts.platform })
    .from(contentDrafts)
    .where(eq(contentDrafts.id, s.target));
  if (!draft) return [];
  const names = [...POST_COUNTS, ...POST_MEANS];
  const rows = await db
    .selectDistinctOn([postMetricDays.metric], {
      metric: postMetricDays.metric,
      value: postMetricDays.value,
    })
    .from(postMetricDays)
    .where(
      and(
        eq(postMetricDays.draftId, s.target),
        eq(postMetricDays.key, ""),
        inArray(postMetricDays.metric, names),
      ),
    )
    .orderBy(postMetricDays.metric, sql`${postMetricDays.day} desc`);
  return rows.flatMap((r) => [
    { segment: "all", metric: r.metric, value: r.value },
    { segment: `platform:${draft.platform}`, metric: r.metric, value: r.value },
  ]);
}

/** A site page: distinct views per event name inside the ship's window, by channel, source, campaign. */
async function site(db: Db, s: Ship): Promise<Row[]> {
  if (!UUID.test(s.target)) return [];
  const window = and(
    eq(siteEvents.page, s.target),
    gte(siteEvents.at, s.startedAt),
    s.endedAt ? lt(siteEvents.at, s.endedAt) : undefined,
    inArray(siteEvents.name, [...SITE_EVENTS]),
  );
  const out: Row[] = [];
  const by = async (
    dim: string,
    col: typeof siteEvents.channel | typeof siteEvents.source | typeof siteEvents.campaign | null,
  ) => {
    const key = col ?? sql<string>`'all'`;
    const rows = await db
      .select({
        key: sql<string | null>`${key}`,
        name: siteEvents.name,
        n: sql<number>`count(distinct ${siteEvents.view})::int`,
      })
      .from(siteEvents)
      .where(window)
      .groupBy(...(col ? [col, siteEvents.name] : [siteEvents.name]));
    for (const r of rows)
      if (r.key != null)
        out.push({ segment: col ? `${dim}:${r.key}` : "all", metric: r.name, value: r.n });
  };
  await by("all", null);
  await by("channel", siteEvents.channel);
  await by("source", siteEvents.source);
  await by("campaign", siteEvents.campaign);
  return out;
}

/** An email template version (`<template>@<version>`): sends, replies, bookings by niche. */
async function email(db: Db, s: Ship): Promise<Row[]> {
  const at = s.target.lastIndexOf("@");
  if (at < 1) return [];
  const template = s.target.slice(0, at);
  const version = s.target.slice(at + 1);
  const rows = await db
    .select({
      niche: templateStats.system,
      sends: sql<number>`sum(${templateStats.sends})::int`,
      replies: sql<number>`sum(${templateStats.replies})::int`,
      booked: sql<number>`sum(${templateStats.booked})::int`,
    })
    .from(templateStats)
    .where(
      and(
        eq(templateStats.kind, "email"),
        eq(templateStats.template, template),
        eq(templateStats.version, version),
      ),
    )
    .groupBy(templateStats.system);
  const out: Row[] = [];
  const total = { sends: 0, replies: 0, booked: 0 };
  for (const r of rows) {
    for (const m of ["sends", "replies", "booked"] as const) {
      total[m] += r[m] ?? 0;
      if (r.niche) out.push({ segment: `niche:${r.niche}`, metric: m, value: r[m] ?? 0 });
    }
  }
  for (const m of ["sends", "replies", "booked"] as const)
    out.push({ segment: "all", metric: m, value: total[m] });
  return out;
}

const COLLECT: Record<Channel, (db: Db, s: Ship) => Promise<Row[]>> = { post, site, email };

/**
 * Collect every live ship (or one subject's), write today's totals. A ship ended over a day ago is
 * left as it last stood.
 */
export async function collect(db: Db, o: { ship?: number } = {}) {
  const day = today();
  const live = await db
    .select()
    .from(ships)
    .where(
      and(
        o.ship != null ? eq(ships.id, o.ship) : undefined,
        or(isNull(ships.endedAt), gte(ships.endedAt, sql`now() - interval '1 day'`)),
      ),
    );
  const done: { ship: number; rows: number }[] = [];
  for (const s of live) {
    const rows = await COLLECT[s.channel](db, s);
    if (rows.length)
      await atomic(db, (tx) =>
        tx
          .insert(outcomes)
          .values(rows.map((r) => ({ shipId: s.id, day, ...r })))
          .onConflictDoUpdate({
            target: [outcomes.shipId, outcomes.segment, outcomes.day, outcomes.metric],
            set: { value: sql`excluded.value`, fetchedAt: sql`now()` },
          }),
      );
    done.push({ ship: s.id, rows: rows.length });
  }
  return { day, ships: done };
}
