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
  it("publishes a hosted video by URL over autobrowse, lists, reads counts", async () => {
    const { sites, calls } = fakeSites({
      "POST /v2/post/publish/video/init/": (i) => {
        expect(i).toEqual({
          post_info: {
            title: "a short",
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_comment: true,
            disable_duet: true,
            disable_stitch: true,
            brand_organic_toggle: false,
            brand_content_toggle: false,
          },
          source_info: { source: "PULL_FROM_URL", video_url: "https://cdn.test/short.mp4" },
        });
        return { data: { publish_id: "pub1" } };
      },
      "POST /v2/post/publish/status/fetch/": (i) => {
        expect(i).toEqual({ publish_id: "pub1", wait: 120 });
        return { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7400000001] } };
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
    // Public and done: the video's own id, so its comments and counts read.
    expect(out).toMatchObject({ id: "7400000001", url: "https://m.tiktok.com/v/7400000001.html" });
    expect((await ch.list()).map((r) => r.url)).toEqual(["https://www.tiktok.com/@w/video/v1"]);
    expect(await ch.metrics("v1")).toMatchObject({
      views: 9,
      reactions: 3,
      comments: 1,
      shares: 2,
    });
    expect(calls).toHaveLength(4);
  });

  it("reads a video's comments off its page: ours marked, replies keep their parent", async () => {
    const { sites, calls } = fakeSites({
      "GET /web/videos/7400000000000000001/comments": () => ({
        videoId: "7400000000000000001",
        url: "https://www.tiktok.com/@w/video/7400000000000000001",
        comments: [
          {
            id: "c2",
            text: "Thanks!",
            at: "2026-09-22T11:00:00.000Z",
            author: "wren",
            authorName: "Wren",
            authorId: "1",
            parentId: "c1",
            creator: true,
            likes: 0,
          },
          {
            id: "c1",
            text: "How long did it take?",
            at: "",
            author: "sam.example",
            authorName: "Sam",
            authorId: "2",
            parentId: null,
            creator: false,
            likes: 3,
          },
        ],
      }),
    });
    const ch = tiktokContent(sites, { now: () => new Date("2026-09-22T12:00:00Z") });
    const rows = await ch.comments("7400000000000000001");
    expect(calls[0]).toEqual(["GET", "/web/videos/7400000000000000001/comments", { max: 50 }]);
    expect(rows.map((r) => [r.id, r.author, r.parentId ?? null, r.mine ?? false, r.at])).toEqual([
      ["c1", "sam.example", null, false, "2026-09-22T12:00:00.000Z"],
      ["c2", "wren", "c1", true, "2026-09-22T11:00:00.000Z"],
    ]);
    // A publish id isn't a video's: nothing to read.
    expect(await ch.comments("v_pub_url~v2.1")).toEqual([]);
    expect(calls).toHaveLength(1);
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
