import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { igMetricsFor, instagramContent } from "./content.js";

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
  it("a Reel: watch time in seconds and minutes, saves, interactions; app-only numbers are gaps", async () => {
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
    });
    const got = await instagramContent(sites, { now: () => NOW }).insights?.({ id: "m1" });
    const of = (m: string) => got?.values.find((v) => v.metric === m)?.value;
    expect(asked).toEqual([igMetricsFor(null).join(",")]);
    expect(of("reach")).toBe(200);
    expect(of("saves")).toBe(9);
    expect(of("avg_view_secs")).toBe(6.5);
    expect(of("watch_minutes")).toBe(30);
    expect(got?.gaps.map((g) => `${g.metric}:${g.state}`)).toEqual([
      "retention:no_api",
      "traffic_source:no_api",
      "skip_rate:no_api",
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
  });
});
