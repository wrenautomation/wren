import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { studioRead, type TikTokVideoAnalytics, tiktokInsights } from "./insights.js";

const PUBLISHED = "2026-10-01T09:00:00Z";
const day = (n: number) => new Date(Date.parse(PUBLISHED) + n * 86_400_000 + 3_600_000);

/** A synthetic Studio read: a 60 s video with 1000 views. */
const full = (): TikTokVideoAnalytics => ({
  durationSecs: 60,
  views: 1000,
  uniqueViewers: 800,
  totalPlaySecs: 12_000,
  avgWatchSecs: 12,
  finishRate: 0.08,
  newFollowers: 5,
  retention: [
    { key: "0", value: 1 },
    { key: "3", value: 0.55 },
    { key: "30", value: 0.2 },
    { key: "60", value: 0.05 },
  ],
  sources: [
    { key: "For You", value: 0.9 },
    { key: "Search", value: 0.1 },
  ],
  searchTerms: [{ key: "crm automation", value: 0.04 }],
  age: [
    { key: "18-24", value: 0.25 },
    { key: "25-34", value: 0.75 },
  ],
  gender: [
    { key: "male_vv", value: 0.6 },
    { key: "female_vv", value: 0.4 },
  ],
  location: [{ key: "CA", value: 1 }],
  followerShare: 0.1,
  nonFollowerShare: 0.9,
  newViewerShare: 0.7,
  returnViewerShare: 0.3,
});

function sitesWith(answer: TikTokVideoAnalytics | number): { sites: SiteClient; paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    sites: {
      async call(_site, method, path) {
        paths.push(path);
        if (typeof answer === "number")
          throw new SiteCallError("tiktok", method, path, answer, "refused");
        return answer as never;
      },
      async via() {
        return "browser";
      },
    },
  };
}

describe("tiktok studio insights", () => {
  it("maps the page: retention by share of the video, shares as percents, sources as views", () => {
    const { values, gaps } = studioRead(full());
    const of = (metric: string, key?: string) =>
      values.find((v) => v.metric === metric && (key === undefined || v.key === key))?.value;
    expect(gaps).toEqual([]);
    expect(of("duration_secs")).toBe(60);
    expect(of("reach")).toBe(800);
    expect(of("watch_minutes")).toBe(200);
    expect(of("avg_view_secs")).toBe(12);
    expect(of("avg_view_pct")).toBe(20);
    expect(of("finish_rate")).toBe(8);
    expect(of("follows")).toBe(5);
    expect(of("retention", "0.50")).toBe(0.2);
    expect(of("retention", "1.00")).toBe(0.05);
    expect(of("hold_3s")).toBe(0.55);
    expect(of("hold_30s")).toBe(0.2);
    expect(of("traffic_source", "For You")).toBe(900);
    expect(of("search_term", "crm automation")).toBe(40);
    expect(of("viewer_age", "25-34")).toBe(75);
    expect(of("viewer_gender", "male")).toBe(60);
    expect(of("viewer_country", "CA")).toBe(100);
    expect(of("viewer_follower", "follower")).toBe(10);
    expect(of("viewer_follower", "other")).toBe(90);
    expect(of("viewer_return", "returning")).toBe(30);
  });

  it("a field TikTok held back (under 100 views) is waiting, not zero", () => {
    const { values, gaps } = studioRead({
      ...full(),
      views: 0,
      retention: null,
      location: null,
      followerShare: null,
      nonFollowerShare: null,
    });
    const waiting = gaps.filter((g) => g.state === "waiting").map((g) => g.metric);
    expect(waiting).toEqual(
      expect.arrayContaining(["retention", "hold_3s", "viewer_country", "viewer_follower"]),
    );
    expect(values.some((v) => v.metric === "retention")).toBe(false);
  });

  it("reads Studio on browser days only; saves stay the Business API's", async () => {
    const { sites, paths } = sitesWith(full());
    const q = { id: "7699661911381658886", published: PUBLISHED };
    const on1 = await tiktokInsights(sites, q, day(1));
    expect(paths).toEqual(["/web/videos/7699661911381658886/analytics"]);
    expect(on1.values.some((v) => v.metric === "hold_3s")).toBe(true);
    expect(on1.gaps.map((g) => [g.metric, g.state])).toEqual([
      ["saves", "needs_william"],
      ["profile_visits", "needs_william"],
    ]);
    const on2 = await tiktokInsights(sites, q, day(2));
    expect(on2.values).toEqual([]);
    expect(paths).toHaveLength(1);
    // A publish id (private, processing) has no Studio page.
    await tiktokInsights(sites, { id: "v_pub_url~abc", published: PUBLISHED }, day(1));
    expect(paths).toHaveLength(1);
  });

  it("over the box's cap reads nothing; a page that needs a person is a gap", async () => {
    const q = { id: "1", published: PUBLISHED };
    const capped = await tiktokInsights(sitesWith(429).sites, q, day(3));
    expect(capped.gaps.some((g) => g.metric === "retention")).toBe(false);
    const human = await tiktokInsights(sitesWith(460).sites, q, day(3));
    expect(human.gaps.find((g) => g.metric === "retention")?.state).toBe("error");
    const unbuilt = await tiktokInsights(sitesWith(404).sites, q, day(3));
    expect(unbuilt.gaps.find((g) => g.metric === "viewer_age")?.state).toBe("not_built");
  });
});
