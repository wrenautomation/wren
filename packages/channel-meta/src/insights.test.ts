import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import {
  facebookContent,
  fbCurveOf,
  igFollowersOf,
  igMetricsFor,
  instagramContent,
} from "./content.js";

const NOW = new Date("2026-10-07T12:00:00Z");

/** Graph's insights edge, answering the asked metrics from `have`; one it lacks refuses the call. */
function graph(have: Record<string, number>) {
  const asked: string[] = [];
  const sites: SiteClient = {
    async call(_site, method, path, input = {}) {
      if (path === "/me/accounts")
        return { data: [{ id: "p1", instagram_business_account: { id: "ig1" } }] } as never;
      if (path === "/ig1") {
        asked.push(String(input.fields));
        return {
          insights: {
            data: [
              { name: "reach", total_value: { value: 300 } },
              { name: "profile_views", total_value: { value: 12 } },
              { name: "website_clicks", total_value: { value: 4 } },
            ],
          },
        } as never;
      }
      if (path.endsWith("/insights")) {
        const metric = String(input.metric).split(",");
        asked.push(metric.join(","));
        const missing = metric.find((m) => !(m in have));
        if (missing)
          throw new SiteCallError("meta", method, path, 400, `metric ${missing} not supported`);
        return { data: metric.map((name) => ({ name, values: [{ value: have[name] }] })) } as never;
      }
      throw new Error(`no fake for ${method} ${path}`);
    },
    async via() {
      return "api";
    },
  };
  return { sites, asked };
}

describe("instagram insights", () => {
  it("a Reel: watch time in seconds and minutes, skip rate, saves, interactions; app-only numbers are gaps", async () => {
    const { sites, asked } = graph({
      reach: 200,
      views: 450,
      saved: 9,
      likes: 30,
      comments: 4,
      shares: 6,
      total_interactions: 49,
      ig_reels_avg_watch_time: 6500,
      ig_reels_video_view_total_time: 1_800_000,
      reels_skip_rate: 62.6,
    });
    const got = await instagramContent(sites, { now: () => NOW }).insights?.({ id: "m1" });
    const of = (m: string) => got?.values.find((v) => v.metric === m)?.value;
    expect(asked).toEqual([igMetricsFor(null).join(",")]);
    expect(of("reach")).toBe(200);
    expect(of("saves")).toBe(9);
    expect(of("avg_view_secs")).toBe(6.5);
    expect(of("watch_minutes")).toBe(30);
    expect(of("skip_rate")).toBe(62.6);
    expect(got?.gaps.map((g) => `${g.metric}:${g.state}`)).toEqual([
      "retention:no_api",
      "traffic_source:no_api",
    ]);
  });

  it("a metric the media refuses: each asked alone, the refused one kept as a gap", async () => {
    const { sites, asked } = graph({
      reach: 10,
      views: 20,
      saved: 1,
      likes: 2,
      comments: 0,
      shares: 0,
      total_interactions: 3,
      follows: 1,
    });
    const got = await instagramContent(sites, { now: () => NOW }).insights?.({
      id: "m2",
      kind: "carousel",
    });
    expect(asked).toHaveLength(1 + igMetricsFor("carousel").length);
    expect(got?.values.find((v) => v.metric === "follows")?.value).toBe(1);
    const gap = got?.gaps.find((g) => g.metric === "profile_visits");
    expect(gap?.state).toBe("error");
    expect(gap?.why).toContain("not supported");
  });

  it("the account's day: yesterday, whole", async () => {
    const { sites, asked } = graph({});
    const got = await instagramContent(sites, { now: () => NOW }).accountInsights?.();
    expect(asked[0]).toContain("period(day)");
    expect(got?.days).toEqual([
      {
        day: "2026-10-06",
        values: [
          { metric: "reach", value: 300 },
          { metric: "profile_visits", value: 12 },
          { metric: "link_clicks", value: 4 },
        ],
      },
    ]);
    // 12 followers: Meta answers no make-up, so it waits.
    expect(got?.gaps.filter((g) => g.state === "waiting").map((g) => g.metric)).toEqual([
      "viewer_age",
      "viewer_gender",
      "viewer_country",
    ]);
  });

  it("the followers' make-up as percents, keyed by bucket", () => {
    const d = (rows: [string, number][]) => ({
      total_value: {
        breakdowns: [{ results: rows.map(([k, value]) => ({ dimension_values: [k], value })) }],
      },
    });
    expect(
      igFollowersOf(
        "viewer_gender",
        d([
          ["F", 30],
          ["M", 90],
          ["U", 0],
        ]),
      ),
    ).toEqual([
      { metric: "viewer_gender", key: "female", value: 25 },
      { metric: "viewer_gender", key: "male", value: 75 },
    ]);
    expect(igFollowersOf("viewer_country", d([["CA", 7]]))).toEqual([
      { metric: "viewer_country", key: "CA", value: 100 },
    ]);
    expect(igFollowersOf("viewer_age", undefined)).toEqual([]);
  });
});

describe("facebook insights", () => {
  /** The Page, a Reel and its post, answering as Graph does (watch time in milliseconds). */
  function page(retention: Record<string, number>) {
    const asked: Array<[string, string]> = [];
    const sites: SiteClient = {
      async call(_site, _method, path, input = {}) {
        if (path === "/me/accounts") return { data: [{ id: "p1" }] } as never;
        asked.push([path, String(input.fields)]);
        if (path === "/v1")
          return {
            length: 30,
            post_id: "9",
            video_insights: {
              data: [
                { name: "post_video_avg_time_watched", values: [{ value: 12_000 }] },
                { name: "post_video_view_time", values: [{ value: 600_000 }] },
                { name: "post_video_followers", values: [{ value: 2 }] },
                { name: "post_video_retention_graph", values: [{ value: retention }] },
              ],
            },
          } as never;
        if (path === "/p1_9" || path === "/p1_5")
          return {
            insights: { data: [{ name: "post_total_media_view_unique", values: [{ value: 80 }] }] },
          } as never;
        if (path === "/p1")
          return {
            insights: {
              data: [
                { name: "page_media_view", values: [{ value: 7 }, { value: 40 }] },
                { name: "page_total_media_view_unique", values: [{ value: 25 }] },
                { name: "page_daily_follows_unique", values: [{ value: 1 }] },
              ],
            },
          } as never;
        throw new SiteCallError("meta", "GET", path, 400, "unsupported");
      },
      async via() {
        return "api";
      },
    };
    return { ch: facebookContent(sites, { now: () => NOW }), asked };
  }
  const by = (values: { metric: string; value: number; key?: string }[], metric: string) =>
    values.filter((v) => v.metric === metric).map((v) => [v.key ?? null, v.value]);

  it("a Reel: watch time, follows, the curve over the video, its post's reach", async () => {
    const { ch } = page({ "0": 1, "1": 0.8, "2": 0.5, "3": 0.4, "4": 0.2 });
    const i = await ch.insights?.({ id: "v1", kind: "video", media: "video" });
    expect(i?.gaps).toEqual([]);
    const v = i?.values ?? [];
    expect(by(v, "avg_view_secs")).toEqual([[null, 12]]);
    expect(by(v, "watch_minutes")).toEqual([[null, 10]]);
    expect(by(v, "follows")).toEqual([[null, 2]]);
    expect(by(v, "duration_secs")).toEqual([[null, 30]]);
    expect(by(v, "avg_view_pct")).toEqual([[null, 40]]);
    expect(by(v, "retention")).toEqual([
      ["0.00", 1],
      ["0.25", 0.8],
      ["0.50", 0.5],
      ["0.75", 0.4],
      ["1.00", 0.2],
    ]);
    // 3 s of 30 is 0.1 in: the nearest point is the start.
    expect(by(v, "hold_3s")).toEqual([[null, 1]]);
    expect(by(v, "hold_30s")).toEqual([[null, 0.2]]);
    expect(by(v, "reach")).toEqual([[null, 80]]);
  });

  it("a curve in percents reads as shares; an empty one writes no curve", async () => {
    expect(fbCurveOf({ "0": 100, "2": 50 })).toEqual([
      { ratio: 0, watch: 1 },
      { ratio: 1, watch: 0.5 },
    ]);
    const { ch } = page({});
    const v = (await ch.insights?.({ id: "v1", kind: "video", media: "video" }))?.values ?? [];
    expect(by(v, "retention")).toEqual([]);
    expect(by(v, "hold_3s")).toEqual([]);
  });

  it("a post reads its reach; a story reads nothing", async () => {
    const { ch, asked } = page({});
    const post = await ch.insights?.({ id: "p1_5", kind: null, media: "image" });
    expect(post?.values).toEqual([{ metric: "reach", value: 80 }]);
    const story = await ch.insights?.({ id: "s1", kind: "story", media: "image" });
    expect(story?.values).toEqual([]);
    expect(asked.map(([p]) => p)).toEqual(["/p1_5"]);
  });

  it("the Page's day: yesterday, whole, the day's last value", async () => {
    const { ch, asked } = page({});
    const a = await ch.accountInsights?.();
    expect(a?.days).toEqual([
      {
        day: "2026-10-06",
        values: [
          { metric: "views", value: 40 },
          { metric: "reach", value: 25 },
          { metric: "follows", value: 1 },
        ],
      },
    ]);
    expect(asked[0]?.[1]).toContain(".period(day).since(1791244800).until(1791331200)");
  });
});
