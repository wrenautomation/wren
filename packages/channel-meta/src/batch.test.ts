import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { facebookContent, igMetricsFor, instagramContent } from "./content.js";

const now = () => new Date("2026-10-15T12:00:00Z");

/** A Graph that answers by path; every call is kept. */
function graph(answers: Record<string, (input: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const sites: SiteClient = {
    async call(_site, method, path, input = {}) {
      calls.push([`${method} ${path}`, input]);
      const a = answers[`${method} ${path}`];
      if (!a) throw new Error(`no fake for ${method} ${path}`);
      return a(input) as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, calls };
}

const insightsOf = (have: Record<string, number>) => (input: Record<string, unknown>) => {
  const metric = String(input.metric).split(",");
  const missing = metric.find((m) => !(m in have));
  if (missing) throw new SiteCallError("meta", "GET", "/insights", 400, `metric ${missing} no`);
  return { data: metric.map((name) => ({ name, values: [{ value: have[name] }] })) };
};
const FEED = {
  reach: 100,
  views: 150,
  saved: 3,
  likes: 20,
  comments: 5,
  shares: 2,
  total_interactions: 30,
  follows: 1,
  profile_visits: 7,
};

describe("instagram batch reads", () => {
  it("reads each post's whole metric list once; insights reuses it instead of asking again", async () => {
    const { sites, calls } = graph({
      "GET /m1/insights": insightsOf(FEED),
      "GET /m2/insights": insightsOf(FEED),
    });
    const ch = instagramContent(sites, { now, pageId: "p1", igId: "ig1" });
    const got = await ch.metricsMany?.([
      { id: "m1", kind: "carousel" },
      { id: "m2", kind: "image" },
    ]);
    expect(calls.map((c) => c[0])).toEqual(["GET /m1/insights", "GET /m2/insights"]);
    expect(calls[0]?.[1]).toEqual({ metric: igMetricsFor("carousel").join(",") });
    expect(got?.[0]).toMatchObject({ id: "m1", views: 100, reactions: 20, comments: 5, shares: 2 });
    // The look's second step: no further call, and the deeper numbers are all there.
    const m1 = got?.[0];
    const deep = await ch.insights?.({
      id: "m1",
      kind: "carousel",
      published: null,
      media: "image",
      read: m1?.read,
    });
    expect(calls).toHaveLength(2);
    expect(deep?.values.find((v) => v.metric === "saves")?.value).toBe(3);
    expect(deep?.values.find((v) => v.metric === "follows")?.value).toBe(1);
  });

  it("without the kept answer, insights asks as before", async () => {
    const { sites, calls } = graph({ "GET /m1/insights": insightsOf(FEED) });
    const ch = instagramContent(sites, { now, pageId: "p1", igId: "ig1" });
    await ch.insights?.({ id: "m1", kind: "carousel", published: null, media: "image" });
    expect(calls).toHaveLength(1);
  });

  it("an answer kept for a different kind of post is not reused", async () => {
    const { sites, calls } = graph({ "GET /m1/insights": insightsOf(FEED) });
    const ch = instagramContent(sites, { now, pageId: "p1", igId: "ig1" });
    const got = await ch.metricsMany?.([{ id: "m1", kind: "carousel" }]);
    await ch.insights?.({
      id: "m1",
      kind: "reel",
      published: null,
      media: "video",
      read: got?.[0]?.read,
    });
    expect(calls.length).toBeGreaterThan(1);
  });

  it("a post whose list is refused is left out, and the others still answer", async () => {
    const { sites } = graph({
      "GET /m1/insights": insightsOf({ reach: 1 }),
      "GET /m2/insights": insightsOf(FEED),
    });
    const got = await instagramContent(sites, { now, pageId: "p1", igId: "ig1" }).metricsMany?.([
      { id: "m1", kind: "carousel" },
      { id: "m2", kind: "carousel" },
    ]);
    expect(got?.map((m) => m.id)).toEqual(["m2"]);
  });

  it("counts every post's comments from one media listing", async () => {
    const { sites, calls } = graph({
      "GET /ig1/media": () => ({
        data: [
          { id: "m1", comments_count: 4 },
          { id: "m2", comments_count: 0 },
          { id: "m3", comments_count: 9 },
        ],
      }),
    });
    const counts = await instagramContent(sites, {
      now,
      pageId: "p1",
      igId: "ig1",
    }).commentCounts?.(["m1", "m2", "gone"]);
    expect(counts).toEqual({ m1: 4, m2: 0 });
    expect(calls).toEqual([["GET /ig1/media", { fields: "id,comments_count", limit: 100 }]]);
  });
});

describe("facebook batch reads", () => {
  const listing = {
    data: [
      {
        id: "p1_1",
        shares: { count: 2 },
        likes: { summary: { total_count: 8 } },
        comments: { summary: { total_count: 3 } },
        insights: { data: [{ name: "post_impressions", values: [{ value: 500 }] }] },
      },
      {
        id: "p1_2",
        likes: { summary: { total_count: 1 } },
        comments: { summary: { total_count: 0 } },
      },
      { id: "p1_3" },
    ],
  };

  it("reads the Page's posts with a look's fields in one listing", async () => {
    const { sites, calls } = graph({ "GET /p1/posts": () => listing });
    const got = await facebookContent(sites, { now, pageId: "p1" }).metricsMany?.([
      { id: "p1_1" },
      { id: "p1_2" },
      { id: "video-id" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      fields:
        "id,shares,likes.summary(true),comments.summary(true),insights.metric(post_impressions)",
      limit: 100,
    });
    // The video's own id isn't in the listing: left out for the single read.
    expect(got?.map((m) => [m.id, m.views, m.reactions, m.comments, m.shares])).toEqual([
      ["p1_1", 500, 8, 3, 2],
      ["p1_2", 0, 1, 0, 0],
    ]);
  });

  it("counts comments from the listing when the Page's token reads them", async () => {
    const { sites, calls } = graph({ "GET /p1/posts": () => listing });
    const counts = await facebookContent(sites, {
      now,
      pageId: "p1",
      pageComments: true,
    }).commentCounts?.(["p1_1", "p1_2", "p1_3"]);
    expect(counts).toEqual({ p1_1: 3, p1_2: 0 });
    expect(calls).toHaveLength(1);
  });

  it("makes no call to count comments the token can't read: there are none to find", async () => {
    const { sites, calls } = graph({});
    const counts = await facebookContent(sites, { now, pageId: "p1" }).commentCounts?.([
      "p1_1",
      "p1_2",
    ]);
    expect(counts).toEqual({ p1_1: 0, p1_2: 0 });
    expect(calls).toHaveLength(0);
  });
});
