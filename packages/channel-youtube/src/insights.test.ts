import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { ANALYTICS_PATH, holdAt, isoSeconds, reportRows, youtubeContent } from "./content.js";

const NOW = new Date("2026-10-07T12:00:00Z");

/** A fake `sites` where the analytics route answers `analytics(input)`, or refuses with `refuse`. */
function sitesWith(o: {
  analytics?: (input: Record<string, unknown>) => unknown;
  refuse?: number;
}): { sites: SiteClient; asked: Array<Record<string, unknown>> } {
  const asked: Array<Record<string, unknown>> = [];
  return {
    asked,
    sites: {
      async call(_site, method, path, input = {}) {
        if (path === "/youtube/v3/videos")
          return { items: [{ contentDetails: { duration: "PT2M" } }] } as never;
        if (method === "GET" && path === ANALYTICS_PATH) {
          asked.push(input);
          if (o.refuse)
            throw new SiteCallError("youtube", method, path, o.refuse, "insufficient scope");
          return o.analytics?.(input) as never;
        }
        throw new Error(`no fake for ${method} ${path}`);
      },
      async via() {
        return "api";
      },
    },
  };
}

const table = (names: string[], rows: unknown[][]) => ({
  columnHeaders: names.map((name) => ({ name })),
  rows,
});

describe("youtube insights", () => {
  it("reads totals, the curve, sources and search terms, each kept under our names", async () => {
    const { sites, asked } = sitesWith({
      analytics: (i) => {
        if (i.dimensions === "elapsedVideoTimeRatio")
          return table(
            ["elapsedVideoTimeRatio", "audienceWatchRatio", "relativeRetentionPerformance"],
            [
              [0.01, 1, 0.5],
              [0.25, 0.6, 0.55],
              [0.5, 0.4, 0.5],
            ],
          );
        if (i.dimensions === "insightTrafficSourceType")
          return table(
            ["insightTrafficSourceType", "views"],
            [
              ["YT_SEARCH", 40],
              ["SUGGESTED", 10],
            ],
          );
        if (i.dimensions === "insightTrafficSourceDetail")
          return table(["insightTrafficSourceDetail", "views"], [["crm automation", 12]]);
        return table(String(i.metrics).split(","), [[75, 42, 35.5, 3, 1, 1, 0]]);
      },
    });
    const ch = youtubeContent(sites, { now: () => NOW });
    const got = await ch.insights?.({ id: "v1", published: "2026-10-01T09:00:00Z", kind: "video" });
    const of = (metric: string, key?: string) =>
      got?.values.find((v) => v.metric === metric && (key === undefined || v.key === key))?.value;
    expect(asked[0]).toMatchObject({
      ids: "channel==MINE",
      startDate: "2026-10-01",
      endDate: "2026-10-07",
      filters: "video==v1",
    });
    expect(of("duration_secs")).toBe(120);
    expect(of("watch_minutes")).toBe(75);
    expect(of("views")).toBeUndefined();
    expect(of("avg_view_pct")).toBe(35.5);
    expect(of("follows")).toBe(3);
    expect(of("unfollows")).toBe(1);
    expect(of("retention", "0.25")).toBe(0.6);
    // 30 s of a 2 min video is 0.25 of it.
    expect(of("hold_30s")).toBe(0.6);
    expect(of("traffic_source", "YT_SEARCH")).toBe(40);
    expect(of("search_term", "crm automation")).toBe(12);
    expect(asked.at(-1)?.filters).toBe("video==v1;insightTrafficSourceType==YT_SEARCH");
    expect(got?.gaps.map((g) => [g.metric, g.state])).toEqual([
      ["impressions", "not_built"],
      ["ctr", "not_built"],
    ]);
  });

  it("no scope: every analytics number is a gap with YouTube's words, asked once", async () => {
    const { sites, asked } = sitesWith({ refuse: 403 });
    const ch = youtubeContent(sites, { now: () => NOW });
    const got = await ch.insights?.({ id: "v1", published: null, kind: "short" });
    expect(asked).toHaveLength(1);
    expect(got?.values).toEqual([{ metric: "duration_secs", value: 120 }]);
    const states = new Map(got?.gaps.map((g) => [g.metric, g.state]));
    expect(states.get("avg_view_pct")).toBe("needs_scope");
    expect(states.has("views")).toBe(false);
    expect(states.get("retention")).toBe("needs_scope");
    expect(states.get("search_term")).toBe("needs_scope");
    expect(states.get("skip_rate")).toBe("no_api");
    expect(got?.gaps.find((g) => g.metric === "retention")?.why).toContain("insufficient scope");
  });

  it("no route on the box: not built, not a throw", async () => {
    const { sites } = sitesWith({ refuse: 404 });
    const got = await youtubeContent(sites, { now: () => NOW }).insights?.({ id: "v1" });
    expect(got?.gaps.find((g) => g.metric === "watch_minutes")?.state).toBe("not_built");
  });

  it("a timeout throws, so the step retries", async () => {
    const sites: SiteClient = {
      async call() {
        throw new SiteCallError("youtube", "GET", ANALYTICS_PATH, 504, "timeout");
      },
      async via() {
        return "api";
      },
    };
    await expect(youtubeContent(sites).insights?.({ id: "v1" })).rejects.toThrow("timeout");
  });

  it("the channel's days", async () => {
    const { sites } = sitesWith({
      analytics: () =>
        table(
          ["day", "views", "estimatedMinutesWatched", "subscribersGained", "subscribersLost"],
          [
            ["2026-10-05", 10, 20, 2, 0],
            ["2026-10-06", 30, 50, 1, 1],
          ],
        ),
    });
    const got = await youtubeContent(sites, { now: () => NOW }).accountInsights?.();
    expect(got?.days).toEqual([
      {
        day: "2026-10-05",
        values: [
          { metric: "views", value: 10 },
          { metric: "watch_minutes", value: 20 },
          { metric: "follows", value: 2 },
          { metric: "unfollows", value: 0 },
        ],
      },
      {
        day: "2026-10-06",
        values: [
          { metric: "views", value: 30 },
          { metric: "watch_minutes", value: 50 },
          { metric: "follows", value: 1 },
          { metric: "unfollows", value: 1 },
        ],
      },
    ]);
  });

  it("helpers", () => {
    expect(isoSeconds("PT1M5S")).toBe(65);
    expect(isoSeconds("PT45S")).toBe(45);
    expect(isoSeconds("P1DT1H")).toBe(90000);
    expect(isoSeconds("bogus")).toBeNull();
    expect(reportRows({ columnHeaders: [{ name: "a" }], rows: [[1], [2]] })).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
    expect(holdAt([], 0.5)).toBeNull();
    expect(holdAt([{ ratio: 0.5, watch: 0.3 }], 2)).toBeNull();
  });
});
