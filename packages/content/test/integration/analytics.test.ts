/**
 * Content analytics against Postgres (designs/2026-10-07-content-analytics.md): insights keep
 * one row per day and never overwrite an earlier day; a metric's state follows the platform's
 * last answer; a post's page reads its days, curve, site clicks and conversation; the
 * conversation, digest, cadence and metric records list. Synthetic rows only.
 */
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { comments, reachContacts, reachMessages } from "@wren/outreach";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { latestDigest, writeDigest } from "../../src/analytics/digest.js";
import {
  cadenceRecord,
  conversationRecord,
  digestRecord,
  metricRecord,
  postAnalytics,
} from "../../src/analytics/records.js";
import { writeAccountInsights, writeInsights, writeReportDays } from "../../src/analytics/store.js";
import { postRecord } from "../../src/records.js";
import { contentDrafts, contentIdeas, contentMetrics, postMetricDays } from "../../src/schema.js";
import { keepDay } from "../../src/social/store.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const HOUR = 3_600_000;
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * HOUR);
const iso = (d: Date) => d.toISOString();

async function publishedVideo(kind: "long" | "short", views: number, at = daysAgo(2)) {
  const [idea] = await pg.db
    .insert(contentIdeas)
    .values({
      text: "synthetic video idea",
      source: "cli",
      ref: kind === "long" ? "video:42" : `video:${views}~short`,
    })
    .returning();
  const [d] = await pg.db
    .insert(contentDrafts)
    .values({
      ideaId: idea!.id,
      platform: "youtube",
      text: `A synthetic ${kind} video\nbody`,
      status: "published",
      promptVersion: "t",
      publishedAt: at,
      publishedId: `yt-${kind}-${views}`,
      extra: kind === "short" ? { kind: "short" } : {},
    })
    .returning();
  await pg.db.insert(contentMetrics).values({
    draftId: d!.id,
    asOf: at,
    views,
    reactions: Math.round(views / 20),
    comments: 2,
    shares: 1,
    fetchedWith: "api",
    createdAt: at,
  });
  return { idea: idea!.id, draft: d!.id };
}

describe("insights store", () => {
  it("keeps a day per read, replaces only the same day, and flips a gap live", async () => {
    const { draft } = await publishedVideo("long", 400);
    const day1 = iso(daysAgo(2));
    await writeInsights(
      pg.db,
      draft,
      "youtube",
      {
        values: [{ metric: "views", value: 300 }],
        gaps: [{ metric: "avg_view_pct", state: "needs_scope", why: "insufficient scope" }],
        asOf: day1,
      },
      daysAgo(2),
    );
    // Same day again: replaced, not added.
    await writeInsights(
      pg.db,
      draft,
      "youtube",
      { values: [{ metric: "views", value: 320 }], gaps: [], asOf: day1 },
      daysAgo(2),
    );
    await writeInsights(
      pg.db,
      draft,
      "youtube",
      {
        values: [
          { metric: "views", value: 400 },
          { metric: "avg_view_pct", value: 41.5 },
          { metric: "retention", key: "0.5", value: 0.4 },
          { metric: "retention", key: "0.1", value: 0.9 },
          { metric: "traffic_source", key: "YT_SEARCH", value: 120 },
        ],
        gaps: [],
        asOf: iso(daysAgo(1)),
      },
      daysAgo(1),
    );
    const days = await pg.db
      .select()
      .from(postMetricDays)
      .where(sql`${postMetricDays.draftId} = ${draft} and ${postMetricDays.metric} = 'views'`)
      .orderBy(postMetricDays.day);
    expect(days.map((d) => d.value)).toEqual([320, 400]);
    const [src] = (await pg.db.execute(
      sql`select state, live_at from metric_sources where platform = 'youtube' and metric = 'avg_view_pct'`,
    )) as unknown as { state: string; live_at: Date | null }[];
    expect(src?.state).toBe("live");
    expect(src?.live_at).not.toBeNull();

    // Two clicks from its own /go/ link, a form and $1,500 won on first touch.
    await pg.db.execute(sql`insert into link_days (day, source, campaign, content, clicks, hops,
      forms_first, forms_last, calls_first, calls_last, won_first, won_last, revenue_first, revenue_last)
      values (${iso(daysAgo(1)).slice(0, 10)}, 'youtube', '42-why-crms-fail', '', 2, 0, 1, 0, 0, 0, 1, 0, 150000, 0)`);

    const a = await postAnalytics(pg.db, draft);
    expect(a?.surface).toBe("long");
    expect(a?.series.views?.map((p) => p.value)).toEqual([320, 400]);
    expect(a?.curve).toEqual([
      { at: 0.1, value: 0.9 },
      { at: 0.5, value: 0.4 },
    ]);
    expect(a?.sources).toEqual([{ key: "YT_SEARCH", value: 120 }]);
    expect(a?.site).toMatchObject({ clicks: 2, formsFirst: 1, wonFirst: 1, revenueFirst: 1500 });
    const cell = (label: string) => a?.cells.find((c) => c.label === label);
    expect(cell("Average view duration and % viewed")).toMatchObject({
      state: "live",
      latest: { avg_view_pct: 41.5 },
    });
    expect(cell("Impressions and CTR")?.says).toBe("Needs scope: YouTube reach report");
    expect(cell("Engaged views")).toBeUndefined();

    const posts = serveRecords([postRecord], pg.db);
    const top = await posts.list({ record: postRecord.id, view: "leaderboard", limit: 9 });
    expect(top.rows[0]).toMatchObject({
      format: "long",
      views: 400,
      clicks: 2,
      revenueFirst: { amount: 1500, currency: "USD" },
    });
    for (const v of postRecord.views)
      await posts.list({ record: postRecord.id, view: v.id, limit: 9 });
  });

  it("an account's days land per platform, with its gaps apart from the posts'", async () => {
    const n = await writeAccountInsights(
      pg.db,
      "instagram",
      {
        days: [
          { day: iso(daysAgo(2)).slice(0, 10), values: [{ metric: "reach", value: 50 }] },
          { day: iso(daysAgo(1)).slice(0, 10), values: [{ metric: "reach", value: 70 }] },
        ],
        gaps: [{ metric: "follows", state: "not_built", why: "later" }],
        asOf: iso(now),
      },
      now,
    );
    expect(n).toBe(2);
    const srcs = (await pg.db.execute(
      sql`select metric, state from metric_sources where platform = 'instagram' order by metric`,
    )) as unknown as { metric: string; state: string }[];
    expect(srcs).toEqual([
      { metric: "account.follows", state: "not_built" },
      { metric: "account.reach", state: "live" },
    ]);
  });
});

describe("conversation", () => {
  it("answered, time to reply and comment to DM per platform and in all", async () => {
    const [contact] = await pg.db
      .insert(reachContacts)
      .values({
        platform: "linkedin",
        handle: "sample-reader",
        url: "https://www.linkedin.com/in/sample-reader/",
        foundIn: "comments",
        name: "Sample Reader",
      })
      .returning();
    const c = (ref: string, at: Date, answered: Date | null, contactId: number | null = null) => ({
      platform: "linkedin" as const,
      channel: "content" as const,
      ref,
      post: "li-post",
      parent: "li-post",
      kind: "post_reply" as const,
      author: "Sample Reader",
      body: "How long did that take?",
      url: "https://linkedin.test/c",
      at,
      raw: {},
      state: answered ? ("answered" as const) : ("waiting" as const),
      answeredAt: answered,
      contactId,
    });
    const t = daysAgo(3);
    await pg.db
      .insert(comments)
      .values([
        c("li-c1", t, new Date(t.getTime() + HOUR), contact!.id),
        c("li-c2", t, new Date(t.getTime() + 3 * HOUR)),
        c("li-c3", t, null),
      ]);
    await pg.db.insert(reachMessages).values([
      {
        contactId: contact!.id,
        direction: "out",
        kind: "manual",
        body: "Thanks, here's how",
        state: "sent",
        sentAt: daysAgo(2),
      },
      {
        contactId: contact!.id,
        direction: "in",
        kind: "inbound",
        body: "Thanks!",
        state: "received",
      },
    ]);
    const api = serveRecords([conversationRecord], pg.db);
    for (const v of conversationRecord.views)
      await api.list({ record: conversationRecord.id, view: v.id, limit: 20 });
    const week = await api.list({ record: conversationRecord.id, view: "7d", limit: 20 });
    const li = week.rows.find((r) => r.platform === "linkedin");
    expect(li).toMatchObject({
      comments: 3,
      answered: { n: 2, of: 3 },
      dmed: { n: 1, of: 3 },
      dms: 1,
      dmsAnswered: { n: 1, of: 1 },
      booked: { n: 0, of: 1 },
    });
    expect(li?.replySecs).toBe(2 * 3600);
    expect(week.rows.find((r) => r.platform === "all")).toMatchObject({ comments: 3, dms: 1 });
  });
});

describe("X conversation and the rows that wait for a first number", () => {
  it("a commenter DMed later by X id counts; a linked handle's lead books; rows flip live", async () => {
    // A fresh server each time: one reads a rows-backed type once.
    const row = async (label: string) =>
      (
        await serveRecords([metricRecord], pg.db).list({
          record: metricRecord.id,
          view: "all",
          limit: 300,
        })
      ).rows.find((r) => r.platform === "x" && r.label === label);
    expect(await row("Comment to DM, DM to booking")).toMatchObject({ state: "waiting" });
    expect(await row("Followers")).toMatchObject({ state: "waiting" });

    const t = daysAgo(4);
    await pg.db.insert(comments).values({
      platform: "x",
      channel: "content",
      ref: "x-c1",
      post: "x-post",
      parent: "x-post",
      kind: "post_reply",
      author: "90001",
      body: "Does this work for a small shop?",
      url: "https://x.test/c",
      at: t,
      raw: {},
      state: "answered",
      answeredAt: new Date(t.getTime() + HOUR),
    });
    // A client's X DM thread with the same person: handle is the username, profile.id the X id.
    const [contact] = await pg.db
      .insert(reachContacts)
      .values({
        platform: "x",
        handle: "sample_shop",
        url: "https://x.com/sample_shop",
        foundIn: "dms",
        name: "Sample Shop",
        profile: { id: "90001" },
      })
      .returning();
    await pg.db.insert(reachMessages).values({
      contactId: contact!.id,
      direction: "out",
      kind: "manual",
      body: "Happy to show you",
      state: "sent",
      sentAt: daysAgo(3),
    });
    await pg.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const [lead] = (await tx.execute(sql`insert into leads (email, status, raw, import_id)
        values ('shop@example.com', 'imported', '{}', 1) returning id`)) as unknown as {
        id: number;
      }[];
      await tx.execute(sql`insert into social_handles (platform, handle, lead_id)
        values ('x', 'sample_shop', ${lead!.id})`);
      await tx.execute(sql`insert into call_bookings (uid, state, email, booked_at)
        values ('x-b1', 'booked', 'shop@example.com', ${iso(daysAgo(2))})`);
    });
    const week = await serveRecords([conversationRecord], pg.db).list({
      record: conversationRecord.id,
      view: "7d",
      limit: 20,
    });
    expect(week.rows.find((r) => r.platform === "x")).toMatchObject({
      comments: 1,
      dmed: { n: 1, of: 1 },
      dms: 1,
      booked: { n: 1, of: 1 },
    });
    expect(await row("Comment to DM, DM to booking")).toMatchObject({ state: "live" });

    await keepDay(pg.db, "x", iso(now).slice(0, 10), { followers: 40, asOf: iso(now), raw: {} });
    expect(await row("Followers")).toMatchObject({ state: "live" });
  });

  it("a long video's footer link names its post in the link days", async () => {
    const [idea] = await pg.db
      .insert(contentIdeas)
      .values({ text: "synthetic footer idea", source: "cli", ref: "video:4242" })
      .returning();
    const [d] = await pg.db
      .insert(contentDrafts)
      .values({
        ideaId: idea!.id,
        platform: "youtube",
        text: "A synthetic footer video",
        status: "published",
        promptVersion: "t",
        publishedAt: daysAgo(2),
        publishedId: "yt-footer",
      })
      .returning();
    const draft = d!.id;
    await pg.db.execute(sql`insert into link_days (day, source, campaign, content, clicks, hops,
      forms_first, forms_last, calls_first, calls_last, won_first, won_last, revenue_first, revenue_last)
      values (${iso(daysAgo(1)).slice(0, 10)}, 'youtube', '4242-sample-slug', '', 5, 0, 0, 0, 0, 0, 0, 0, 0, 0)`);
    const [r] = (await pg.db.execute(
      sql`select post, clicks from marketing_link_day_records where campaign = '4242-sample-slug'`,
    )) as unknown as { post: string | null; clicks: number }[];
    expect(r?.post).toMatch(new RegExp(`/youtube/${draft}$`));
    expect(r?.clicks).toBe(5);
  });
});

describe("digest, cadence and metric records", () => {
  it("Monday's digest lands per platform, the drafts read it, and the records list", async () => {
    await publishedVideo("short", 900, daysAgo(1));
    expect(await writeDigest(pg.db, now, iso(now).slice(0, 10))).toBe(true);
    const yt = await latestDigest(pg.db, "youtube");
    expect(yt.find((l) => l.kind === "top")?.text).toContain("A synthetic");

    const api = serveRecords([digestRecord, cadenceRecord, metricRecord], pg.db);
    const worked = await api.list({ record: digestRecord.id, view: "worked", limit: 20 });
    expect(worked.rows.length).toBeGreaterThan(0);
    expect(worked.rows.every((r) => r.platform === "all")).toBe(true);

    const cadence = await api.list({ record: cadenceRecord.id, view: "week", limit: 20 });
    expect(cadence.rows.find((r) => r.id === "youtube-short")).toMatchObject({
      done: 1,
      goal: 5,
      state: "behind",
    });

    const gaps = await api.list({ record: metricRecord.id, view: "scope", limit: 100 });
    expect(gaps.rows.some((r) => r.says === "Needs scope: YouTube Analytics")).toBe(true);
    // Average % viewed came back above: no longer a gap.
    const all = await api.list({ record: metricRecord.id, view: "all", limit: 200 });
    expect(all.rows.find((r) => r.label === "Average view duration and % viewed")).toMatchObject({
      state: "live",
    });
  });
});

describe("report days", () => {
  it("land on their own day, keep totals per day, take a backfill, and flip the row live", async () => {
    const { draft } = await publishedVideo("short", 777);
    const dayAgo = (n: number) => iso(daysAgo(n)).slice(0, 10);
    const [d3, d2, d1] = [dayAgo(3), dayAgo(2), dayAgo(1)];
    // A served set reads a record's rows once: a fresh one per look.
    const reachRow = async () =>
      (
        await serveRecords([metricRecord], pg.db).list({
          record: metricRecord.id,
          view: "all",
          limit: 200,
        })
      ).rows.find((r) => r.platform === "youtube" && r.label === "Impressions and CTR");
    const at = (metric: string) =>
      pg.db
        .select({ day: postMetricDays.day, value: postMetricDays.value })
        .from(postMetricDays)
        .where(sql`${postMetricDays.draftId} = ${draft} and ${postMetricDays.metric} = ${metric}`)
        .orderBy(postMetricDays.day);

    // The job just started: the row says it's on its way.
    await writeReportDays(
      pg.db,
      "youtube",
      {
        rows: [],
        gaps: ["impressions", "ctr"].map((metric) => ({ metric, state: "waiting", why: "soon" })),
        cursor: null,
        asOf: iso(now),
      },
      now,
    );
    expect(await reachRow()).toMatchObject({ state: "waiting", says: "Waiting: soon" });

    // A look the day before keeps its own numbers.
    await writeInsights(
      pg.db,
      draft,
      "youtube",
      { values: [{ metric: "watch_minutes", value: 12 }], gaps: [], asOf: iso(daysAgo(1)) },
      daysAgo(1),
    );
    const day = (d: string, impressions: number, ctr: number) => ({
      id: "yt-short-777",
      day: d,
      values: [
        { metric: "impressions_day", value: impressions },
        { metric: "ctr_day", value: ctr },
      ],
    });
    const n = await writeReportDays(
      pg.db,
      "youtube",
      {
        rows: [day(d3, 100, 5), day(d2, 300, 2), { ...day(d2, 9, 9), id: "not-ours" }],
        gaps: [],
        cursor: "c1",
        asOf: iso(now),
      },
      now,
    );
    expect(n).toBe(4);
    expect(await at("impressions")).toEqual([
      { day: d3, value: 100 },
      { day: d2, value: 400 },
    ]);
    // (5 + 6) clicks of 400.
    expect((await at("ctr")).map((r) => r.value)).toEqual([5, 2.75]);

    // YouTube's backfill for the first day: that day and the totals after it move, nothing else.
    await writeReportDays(
      pg.db,
      "youtube",
      { rows: [day(d3, 200, 5)], gaps: [], cursor: "c2", asOf: iso(now) },
      now,
    );
    expect((await at("impressions_day")).map((r) => r.value)).toEqual([200, 300]);
    expect((await at("impressions")).map((r) => r.value)).toEqual([200, 500]);
    expect((await at("ctr")).map((r) => r.value)).toEqual([5, 3.2]);
    expect(await at("watch_minutes")).toEqual([{ day: d1, value: 12 }]);

    expect(await reachRow()).toMatchObject({ state: "live", says: "Live" });
    const a = await postAnalytics(pg.db, draft);
    expect(a?.cells.find((c) => c.label === "Impressions and CTR")).toMatchObject({
      state: "live",
      latest: { impressions: 500, ctr: 3.2 },
    });
    expect(a?.series.impressions?.map((p) => p.value)).toEqual([200, 500]);
  });
});
