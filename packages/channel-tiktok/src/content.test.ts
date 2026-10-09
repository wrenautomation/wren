import type { MediaHost, SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { tiktokContent } from "./content.js";

function fakeSites(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(site, method, path, input) {
      expect(site).toBe("tiktok");
      calls.push([method, path, input]);
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
const host: MediaHost = { host: async () => "https://cdn.test/short.mp4" };

describe("tiktok content channel", () => {
  it("publishes a hosted video by URL, lists, reads counts", async () => {
    const { sites, calls } = fakeSites({
      "POST /v2/post/publish/video/init/": (i) => {
        expect(i).toEqual({
          post_info: { title: "a short", privacy_level: "PUBLIC_TO_EVERYONE" },
          source_info: { source: "PULL_FROM_URL", video_url: "https://cdn.test/short.mp4" },
        });
        return { data: { publish_id: "pub1" } };
      },
      "POST /v2/video/list/": () => ({
        data: {
          videos: [
            {
              id: "v1",
              title: "a short",
              create_time: 1_790_000_000,
              share_url: "https://www.tiktok.com/@w/video/v1",
            },
          ],
        },
      }),
      "POST /v2/video/query/": () => ({
        data: {
          videos: [{ id: "v1", view_count: 9, like_count: 3, comment_count: 1, share_count: 2 }],
        },
      }),
    });
    const ch = tiktokContent(sites, { host, now: () => new Date("2026-09-22T10:00:00Z") });
    const out = await ch.publish({
      text: "a short",
      media: { kind: "video", source: "/data/short.mp4" },
      extra: { privacy: "PUBLIC_TO_EVERYONE" },
    });
    expect(out.id).toBe("pub1");
    expect((await ch.list()).map((r) => r.url)).toEqual(["https://www.tiktok.com/@w/video/v1"]);
    expect(await ch.metrics("v1")).toMatchObject({
      views: 9,
      reactions: 3,
      comments: 1,
      shares: 2,
    });
    expect(await ch.comments("v1")).toEqual([]);
    expect(calls).toHaveLength(3);
  });

  it("refuses anything but a video", async () => {
    const { sites } = fakeSites({});
    await expect(tiktokContent(sites).publish({ text: "x" })).rejects.toThrow(/a video/);
  });

  it("audience reads the follower count from user/info", async () => {
    const { sites, calls } = fakeSites({
      "GET /v2/user/info/": () => ({ data: { user: { open_id: "o", follower_count: 31 } } }),
    });
    const a = await tiktokContent(sites, {
      now: () => new Date("2026-10-09T00:00:00Z"),
    }).audience?.();
    expect(a).toMatchObject({ followers: 31, asOf: "2026-10-09T00:00:00.000Z" });
    expect(String(calls[0]?.[2]?.fields)).toContain("follower_count");
  });

  it("audience without the stats scope fails rather than writing a zero", async () => {
    const { sites } = fakeSites({
      "GET /v2/user/info/": () => ({ data: { user: { open_id: "o" } } }),
    });
    await expect(tiktokContent(sites).audience?.()).rejects.toThrow(/user.info.stats/);
  });
});
