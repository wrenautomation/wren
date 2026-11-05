/**
 * Wren's vireo collectors: post, site, email. Each reads its own tables and writes totals to
 * today per segment; vireo stores, ranks and shows them.
 */
import { templateStats } from "@wren/core";
import type { Db } from "@wren/db";
import { siteEvents } from "@wren/sites/schema";
import { contentDrafts, postMetricDays } from "@wren/starling-inbound/schema";
import type { Collector, OutcomeRow, Ship } from "@wrenautomation/vireo";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A post: the latest total of each metric, plus `engaged` (likes + comments + shares + saves). */
const post = (db: Db): Collector => ({
  channel: "post",
  target: "content draft id",
  rates: [
    { name: "engaged", wins: "engaged", of: "views" },
    { name: "likes", wins: "likes", of: "views" },
    { name: "comments", wins: "comments", of: "views" },
    { name: "shares", wins: "shares", of: "views" },
    { name: "follows", wins: "follows", of: "views" },
    { name: "clicks", wins: "link_clicks", of: "views" },
  ],
  means: { metrics: POST_MEANS, weight: "views" },
  async read(s: Ship): Promise<OutcomeRow[]> {
    if (!UUID.test(s.target)) return [];
    const [draft] = await db
      .select({ platform: contentDrafts.platform })
      .from(contentDrafts)
      .where(eq(contentDrafts.id, s.target));
    if (!draft) return [];
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
          inArray(postMetricDays.metric, [...POST_COUNTS, ...POST_MEANS]),
        ),
      )
      .orderBy(postMetricDays.metric, sql`${postMetricDays.day} desc`);
    const v = Object.fromEntries(rows.map((r) => [r.metric, r.value]));
    const engaged = ["likes", "comments", "shares", "saves"].reduce((t, k) => t + (v[k] ?? 0), 0);
    const all = [...rows, ...(rows.length ? [{ metric: "engaged", value: engaged }] : [])];
    return all.flatMap((r) => [
      { segment: "all", metric: r.metric, value: r.value },
      { segment: `platform:${draft.platform}`, metric: r.metric, value: r.value },
    ]);
  },
});

/** A site page: distinct views per event inside the ship's window, by channel, source, campaign. */
const site = (db: Db): Collector => ({
  channel: "site",
  target: "site page id",
  rates: [
    { name: "forms", wins: "form", of: "view" },
    { name: "books", wins: "book", of: "view" },
    { name: "clicks", wins: "cta", of: "view" },
  ],
  async read(s) {
    if (!UUID.test(s.target)) return [];
    const window = and(
      eq(siteEvents.page, s.target),
      gte(siteEvents.at, s.startedAt),
      s.endedAt ? lt(siteEvents.at, s.endedAt) : undefined,
      inArray(siteEvents.name, [...SITE_EVENTS]),
    );
    const out: OutcomeRow[] = [];
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
  },
});

/** An email template version (`<template>@<version>`): sends, replies, bookings by niche. */
const email = (db: Db): Collector => ({
  channel: "email",
  target: "template@version",
  rates: [
    { name: "replies", wins: "replies", of: "sends" },
    { name: "booked", wins: "booked", of: "sends" },
  ],
  async read(s) {
    const at = s.target.lastIndexOf("@");
    if (at < 1) return [];
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
          eq(templateStats.template, s.target.slice(0, at)),
          eq(templateStats.version, s.target.slice(at + 1)),
        ),
      )
      .groupBy(templateStats.system);
    const out: OutcomeRow[] = [];
    const total = { sends: 0, replies: 0, booked: 0 };
    for (const r of rows)
      for (const m of ["sends", "replies", "booked"] as const) {
        total[m] += r[m] ?? 0;
        if (r.niche) out.push({ segment: `niche:${r.niche}`, metric: m, value: r[m] ?? 0 });
      }
    for (const m of ["sends", "replies", "booked"] as const)
      out.push({ segment: "all", metric: m, value: total[m] });
    return out;
  },
});

export const collectors = (db: Db): Collector[] => [post(db), site(db), email(db)];
