import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { xContent } from "./content.js";

const sitesOf = (tweet: Record<string, unknown>): SiteClient => ({
  async call() {
    return { data: { id: "t1", ...tweet } } as never;
  },
  async via() {
    return "api";
  },
});

describe("x insights", () => {
  it("bookmarks and the author's clicks on the API leg", async () => {
    const got = await xContent(
      sitesOf({
        public_metrics: {
          impression_count: 900,
          like_count: 9,
          bookmark_count: 3,
          retweet_count: 1,
        },
        non_public_metrics: { url_link_clicks: 7, user_profile_clicks: 2 },
      }),
    ).insights?.({ id: "t1" });
    const of = (m: string) => got?.values.find((v) => v.metric === m)?.value;
    expect(of("views")).toBe(900);
    expect(of("saves")).toBe(3);
    expect(of("link_clicks")).toBe(7);
    expect(of("profile_clicks")).toBe(2);
    expect(got?.gaps).toEqual([]);
  });

  it("the browser leg: clicks are a gap that says why", async () => {
    const got = await xContent(sitesOf({ public_metrics: { impression_count: 5 } })).insights?.({
      id: "t1",
    });
    expect(got?.gaps.map((g) => `${g.metric}:${g.state}`)).toEqual([
      "link_clicks:no_api",
      "profile_clicks:no_api",
    ]);
  });

  it("a video post asks for its media and reads plays and playback quartiles", async () => {
    const asked: Array<Record<string, unknown> | undefined> = [];
    const sites: SiteClient = {
      async call(_site, _method, _path, input) {
        asked.push(input);
        return {
          data: { id: "t1", public_metrics: { impression_count: 50 } },
          includes: {
            media: [
              {
                type: "video",
                public_metrics: { view_count: 40 },
                organic_metrics: {
                  view_count: 41,
                  playback_0_count: 40,
                  playback_25_count: 30,
                  playback_50_count: 20,
                  playback_75_count: 10,
                  playback_100_count: 5,
                },
              },
            ],
          },
        } as never;
      },
      async via() {
        return "api";
      },
    };
    const got = await xContent(sites).insights?.({ id: "t1", media: "video" });
    expect(asked[0]).toMatchObject({ expansions: "attachments.media_keys" });
    expect(String(asked[0]?.["media.fields"])).toContain("organic_metrics");
    expect(got?.values.find((v) => v.metric === "video_views")?.value).toBe(41);
    expect(got?.values.filter((v) => v.metric === "playback").map((v) => [v.key, v.value])).toEqual(
      [
        ["0", 40],
        ["25", 30],
        ["50", 20],
        ["75", 10],
        ["100", 5],
      ],
    );
    // The quartiles over the plays started: the curve and the finish rate.
    expect(
      got?.values.filter((v) => v.metric === "retention").map((v) => [v.key, v.value]),
    ).toEqual([
      ["0.00", 1],
      ["0.25", 0.75],
      ["0.50", 0.5],
      ["0.75", 0.25],
      ["1.00", 0.125],
    ]);
    expect(got?.values.find((v) => v.metric === "finish_rate")?.value).toBe(12.5);
    expect(got?.gaps.map((g) => g.metric)).toEqual(["link_clicks", "profile_clicks"]);
  });

  it("a video post with no plays in the answer is a gap; a text post never asks", async () => {
    const asked: Array<Record<string, unknown> | undefined> = [];
    const sites: SiteClient = {
      async call(_site, _method, _path, input) {
        asked.push(input);
        return { data: { id: "t1", public_metrics: { impression_count: 5 } } } as never;
      },
      async via() {
        return "browser";
      },
    };
    const video = await xContent(sites).insights?.({ id: "t1", media: "video" });
    expect(
      video?.gaps.filter((g) => g.metric === "video_views" || g.metric === "playback"),
    ).toEqual([
      expect.objectContaining({ metric: "video_views", state: "no_api" }),
      expect.objectContaining({ metric: "playback", state: "no_api" }),
    ]);
    expect(video?.gaps.map((g) => g.metric)).toContain("retention");
    await xContent(sites).insights?.({ id: "t1", media: "image" });
    expect(asked[1]).toEqual({});
  });
});

describe("x look", () => {
  it("a post without video is read once: insights takes the counts read's answer", async () => {
    let calls = 0;
    const sites: SiteClient = {
      async call() {
        calls++;
        return {
          data: {
            id: "t1",
            public_metrics: { impression_count: 900, like_count: 9 },
            non_public_metrics: { url_link_clicks: 7, user_profile_clicks: 2 },
          },
        } as never;
      },
      async via() {
        return "api";
      },
    };
    const ch = xContent(sites);
    const m = await ch.metrics("t1");
    const got = await ch.insights?.({ id: "t1", media: "image", read: m.read });
    expect(got?.values.find((v) => v.metric === "link_clicks")?.value).toBe(7);
    // Before: the counts and insights each read the post (2).
    expect(calls).toBe(1);
    // A video wants other fields: it asks again.
    await ch.insights?.({ id: "t1", media: "video", read: m.read });
    expect(calls).toBe(2);
  });
});

describe("x audience", () => {
  it("reads followers from users/me", async () => {
    const sites: SiteClient = {
      async call(_site, method, path, input) {
        expect([method, path]).toEqual(["GET", "/2/users/me"]);
        expect(String(input?.["user.fields"])).toContain("public_metrics");
        return {
          data: { id: "1", username: "wren", public_metrics: { followers_count: 12 } },
        } as never;
      },
      async via() {
        return "api";
      },
    };
    const a = await xContent(sites, { now: () => new Date("2026-10-09T00:00:00Z") }).audience?.();
    expect(a).toMatchObject({ followers: 12, asOf: "2026-10-09T00:00:00.000Z" });
  });
});
