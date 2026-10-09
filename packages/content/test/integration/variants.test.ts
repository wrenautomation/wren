/**
 * Title, thumbnail and hook swaps, TikTok answers made by hand, and YouTube follows in the
 * training record, against Postgres (designs/2026-10-07-content-analytics.md). Each variant's
 * window reads the post's days; the swap's own day counts for neither. Fixed dates, synthetic
 * rows only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { comments } from "@wren/outreach";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postAnalytics, readSources } from "../../src/analytics/records.js";
import {
  askSwap,
  keepFirstVariants,
  planSwap,
  SwapRefusal,
  skipSwaps,
  startSwap,
  variantWindows,
  waitingSwaps,
} from "../../src/analytics/variants.js";
import { contentDrafts, contentIdeas, postMetricDays, postVariants } from "../../src/schema.js";
import { approvalRecord } from "../../src/social/records.js";
import { keepPostComments } from "../../src/social/store.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const DAY = 86_400_000;
const PUBLISHED = new Date("2026-09-01T14:00:00Z");
const on = (n: number, hour = 14) =>
  new Date(Date.parse("2026-09-01T00:00:00Z") + n * DAY + hour * 3_600_000);
const dayOf = (n: number) => on(n, 0).toISOString().slice(0, 10);

async function published(platform: "youtube" | "tiktok" | "linkedin", id: string, extra = {}) {
  const [idea] = await pg.db
    .insert(contentIdeas)
    .values({ text: "synthetic idea", source: "cli" })
    .returning();
  const [d] = await pg.db
    .insert(contentDrafts)
    .values({
      ideaId: idea!.id,
      platform,
      title: platform === "youtube" ? "First title" : null,
      text: "First hook\n\nThe rest of the text.",
      status: "published",
      promptVersion: "t",
      publishedAt: PUBLISHED,
      publishedId: id,
      url: `https://example.com/${id}`,
      extra,
    })
    .returning();
  return d!;
}

describe("swaps", () => {
  it("keeps what went out, asks, waits, goes live, and reads each window's numbers", async () => {
    const d = await published("youtube", "yt-swap-1", { thumbnail: "media/thumb1.png" });
    expect(await keepFirstVariants(pg.db, d, PUBLISHED)).toBe(3);
    // A step that runs again keeps one of each.
    expect(await keepFirstVariants(pg.db, d, PUBLISHED)).toBe(0);

    // Refusals: the live one again, a long title, a hook over two lines, another platform.
    const ask = (field: "title" | "thumbnail" | "hook", value: string, at = on(6)) =>
      askSwap(pg.db, { draftId: d.id, field, value, by: "sam@example.com" }, at);
    await expect(ask("title", "First title")).rejects.toThrow(SwapRefusal);
    await expect(ask("title", "x".repeat(101))).rejects.toThrow(/100 characters/);
    await expect(ask("hook", "one\ntwo")).rejects.toThrow(/one line/);
    const li = await published("linkedin", "urn:li:share:9");
    await expect(
      askSwap(pg.db, { draftId: li.id, field: "title", value: "t", by: "x" }, on(6)),
    ).rejects.toThrow(/can't change/);

    // A newer ask replaces the one still waiting.
    const first = await ask("title", "Second title, first try");
    const swap = await ask("title", "Second title");
    const [old] = await pg.db.select().from(postVariants).where(eq(postVariants.id, first.id));
    expect(old?.state).toBe("rejected");
    expect((await waitingSwaps(pg.db)).map((w) => [w.id, w.value, w.live])).toEqual([
      [swap.id, "Second title", "First title"],
    ]);
    const rows = (await approvalRecord.rows?.(pg.db)) ?? [];
    expect(rows.find((r) => r.id === `swap:${swap.id}`)).toMatchObject({
      type: "swap",
      kind: "swap",
      platform: "youtube",
      body: "New title: Second title",
      post_title: "Now: First title",
    });

    expect(await planSwap(pg.db, swap.id)).toMatchObject({
      platform: "youtube",
      publishedId: "yt-swap-1",
      patch: { title: "Second title" },
    });
    await startSwap(pg.db, swap.id, "sam@example.com", on(6, 15));
    await expect(planSwap(pg.db, swap.id)).rejects.toThrow(/live/);

    // Days 0..9: views climb 100 a day to day 5, then 200 a day; impressions and CTR per day.
    const days = Array.from({ length: 10 }, (_, n) => n);
    const views = (n: number) => (n <= 5 ? 100 * (n + 1) : 600 + 200 * (n - 5));
    await pg.db.insert(postMetricDays).values(
      days.flatMap((n) => [
        {
          draftId: d.id,
          day: dayOf(n),
          metric: "views",
          key: "",
          value: views(n),
          fetchedAt: on(n),
        },
        {
          draftId: d.id,
          day: dayOf(n),
          metric: "impressions_day",
          key: "",
          value: 1000,
          fetchedAt: on(n),
        },
        {
          draftId: d.id,
          day: dayOf(n),
          metric: "ctr_day",
          key: "",
          value: n < 6 ? 4 : 6,
          fetchedAt: on(n),
        },
      ]),
    );
    const w = await variantWindows(pg.db, d.id, on(9));
    const title = w.filter((v) => v.field === "title");
    expect(
      title.map((v) => [v.value, v.state, v.from, v.to, v.days, v.views, v.viewsPerDay, v.ctr]),
    ).toEqual([
      ["First title", "ended", dayOf(0), dayOf(5), 6, 600, 100, 4],
      ["Second title, first try", "rejected", null, null, 0, null, null, null],
      // The swap's day (day 6) counts for neither: day 7 to 9 against day 6's total.
      ["Second title", "live", dayOf(7), dayOf(9), 3, 600, 200, 6],
    ]);
    expect(title[0]?.impressions).toBe(6000);
    expect(w.filter((v) => v.field === "thumbnail").map((v) => v.value)).toEqual([
      "media/thumb1.png",
    ]);

    // A swap out: the catalog's row goes live, and the post's page carries the windows.
    expect((await readSources(pg.db)).get("youtube|variants")?.state).toBe("live");
    const a = await postAnalytics(pg.db, d.id, on(9));
    expect(a?.variants.filter((v) => v.field === "title").map((v) => v.state)).toEqual([
      "ended",
      "rejected",
      "live",
    ]);
    expect(a?.cells.find((c) => c.label === "Title, thumbnail and hook variants")?.state).toBe(
      "live",
    );

    // His no: it never goes out.
    const hook = await ask("hook", "A new hook", on(8));
    expect(await skipSwaps(pg.db, [hook.id, hook.id], "sam@example.com", on(8))).toEqual([hook.id]);
    expect(await waitingSwaps(pg.db)).toEqual([]);
  });
});

describe("TikTok comments", () => {
  it("our reply made by hand answers their comment, so the reply rate counts it", async () => {
    const d = await published("tiktok", "7400000000000000001");
    const post = {
      platform: "tiktok" as const,
      id: "7400000000000000001",
      url: d.url,
      title: "First hook",
      publishedAt: PUBLISHED.toISOString(),
    };
    await keepPostComments(pg.db, post, [
      {
        id: "tc1",
        postId: post.id,
        author: "sam.example",
        text: "How long did it take?",
        at: on(1).toISOString(),
      },
      {
        id: "tc2",
        postId: post.id,
        author: "wren",
        text: "About a week.",
        at: on(1, 18).toISOString(),
        parentId: "tc1",
        mine: true,
      },
      {
        id: "tc3",
        postId: post.id,
        author: "lee.example",
        text: "Nice",
        at: on(2).toISOString(),
      },
    ]);
    const [c] = await pg.db
      .select()
      .from(comments)
      .where(and(eq(comments.platform, "tiktok"), eq(comments.ref, "tc1")));
    expect(c).toMatchObject({ state: "answered", answer: "About a week.", answerRef: "tc2" });
    expect(c?.answeredAt?.toISOString()).toBe(on(1, 18).toISOString());
    const a = await postAnalytics(pg.db, d.id, on(3));
    expect(a?.conversation).toMatchObject({ theirs: 2, answered: 1, replySecs: 4 * 3600 });
    expect((await readSources(pg.db)).get("tiktok|reply_rate")?.state).toBe("live");
  });
});

describe("training record", () => {
  it("a YouTube post's follows come from its insight days", async () => {
    const d = await published("youtube", "yt-follows-1");
    await pg.db.insert(postMetricDays).values([
      { draftId: d.id, day: dayOf(1), metric: "follows", key: "", value: 3, fetchedAt: on(1) },
      { draftId: d.id, day: dayOf(2), metric: "follows", key: "", value: 7, fetchedAt: on(2) },
    ]);
    const [o] = (await pg.db.execute(
      sql`select follows from draft_outcomes where item = ${`draft:${d.id}`}`,
    )) as unknown as Array<{ follows: number | null }>;
    expect(o?.follows).toBe(7);
  });
});
