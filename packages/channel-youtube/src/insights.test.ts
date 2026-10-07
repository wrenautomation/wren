import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_PATH,
  holdAt,
  isoSeconds,
  REACH_REPORT,
  reachRows,
  reportRows,
  youtubeContent,
} from "./content.js";

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

/** One reach report CSV row, as autobrowse answers it: every value a string. */
const row = (date: string, video_id: string, impressions: string, ctr: string) => ({
  date,
  channel_id: "UCsynthetic",
  video_id,
  video_thumbnail_impressions: impressions,
  video_thumbnail_impressions_ctr: ctr,
});

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
    // Impressions and CTR come from the reach report, not here.
    expect(got?.gaps).toEqual([]);
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

  it("the reach report: starts the job once, reads new reports oldest first, one row per video and day", async () => {
    const calls: string[] = [];
    let jobs: Array<{ id: string; reportTypeId: string }> = [];
    const csv: Record<string, Array<Record<string, string>>> = {
      r1: [
        row("20261004", "v1", "100", "5"),
        row("20261004", "v1", "300", "1"),
        row("20261004", "v2", "0", "0"),
      ],
      // A later report for the same day: YouTube's backfill, read instead of r1.
      r2: [row("20261004", "v1", "500", "2")],
      r3: [row("20261005", "v1", "50", "")],
    };
    const sites: SiteClient = {
      async call(_site, method, path, input = {}) {
        calls.push(`${method} ${path}`);
        if (path === "/v1/jobs" && method === "GET") return { jobs } as never;
        if (path === "/v1/jobs" && method === "POST") {
          expect(input).toEqual({ reportTypeId: REACH_REPORT, name: "wren reach" });
          jobs = [{ id: "j1", reportTypeId: REACH_REPORT }];
          return jobs[0] as never;
        }
        if (path === "/v1/jobs/j1/reports")
          return {
            reports: input.createdAfter
              ? []
              : [
                  {
                    id: "r3",
                    startTime: "2026-10-05T07:00:00Z",
                    createTime: "2026-10-07T02:00:00Z",
                  },
                  {
                    id: "r1",
                    startTime: "2026-10-04T07:00:00Z",
                    createTime: "2026-10-05T02:00:00Z",
                  },
                  {
                    id: "r2",
                    startTime: "2026-10-04T07:00:00Z",
                    createTime: "2026-10-06T02:00:00Z",
                  },
                ],
          } as never;
        const id = /reports\/(\w+)\/rows$/.exec(path)?.[1];
        if (id) return { rows: csv[id] } as never;
        throw new Error(`no fake for ${method} ${path}`);
      },
      async via() {
        return "api";
      },
    };
    const ch = youtubeContent(sites, { now: () => NOW });
    const got = await ch.reportDays?.({});
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith("/rows"))).toEqual([
      "GET /v1/jobs/j1/reports/r2/rows",
      "GET /v1/jobs/j1/reports/r3/rows",
    ]);
    expect(got?.rows).toEqual([
      {
        id: "v1",
        day: "2026-10-04",
        values: [
          { metric: "impressions_day", value: 500 },
          { metric: "ctr_day", value: 2 },
        ],
      },
      // No CTR in the cell: unknown, not zero.
      { id: "v1", day: "2026-10-05", values: [{ metric: "impressions_day", value: 50 }] },
    ]);
    expect(got?.gaps).toEqual([]);
    expect(got?.cursor).toBe("2026-10-07T02:00:00Z");
    // Next pass: nothing new, the job is not started again, the cursor stays.
    const next = await ch.reportDays?.({ after: got?.cursor ?? null });
    expect(next?.rows).toEqual([]);
    expect(next?.cursor).toBe("2026-10-07T02:00:00Z");
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
  });

  it("the reach report: a new job says waiting, no consent says needs scope", async () => {
    const waiting: SiteClient = {
      async call(_s, method, path) {
        if (path === "/v1/jobs") return (method === "GET" ? { jobs: [] } : { id: "j1" }) as never;
        return {} as never;
      },
      async via() {
        return "api";
      },
    };
    const got = await youtubeContent(waiting, { now: () => NOW }).reportDays?.({});
    expect(new Set(got?.gaps.map((g) => g.state))).toEqual(new Set(["waiting"]));
    expect(got?.gaps.map((g) => g.metric)).toEqual([
      "impressions",
      "ctr",
      "impressions_day",
      "ctr_day",
    ]);
    expect(got?.cursor).toBeNull();

    const refused: SiteClient = {
      async call(_s, method, path) {
        throw new SiteCallError(
          "youtube",
          method,
          path,
          403,
          "YouTube Reporting API has not been used",
        );
      },
      async via() {
        return "api";
      },
    };
    const no = await youtubeContent(refused, { now: () => NOW }).reportDays?.({ after: "x" });
    expect(no?.gaps.find((g) => g.metric === "impressions")).toMatchObject({
      state: "needs_scope",
      why: expect.stringContaining("has not been used"),
    });
    expect(no?.cursor).toBe("x");
  });

  it("helpers", () => {
    expect(
      reachRows([
        row("2026-10-04", "v1", "10", "10"),
        row("20261004", "v1", "30", ""),
        row("bogus", "v1", "1", "1"),
      ]),
    ).toEqual([{ id: "v1", day: "2026-10-04", impressions: 40, clicks: 1, rated: 10 }]);
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
