import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { youtubeContent } from "./content.js";

function fakeSites(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(site, method, path, input) {
      expect(site).toBe("youtube");
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

describe("youtube content channel", () => {
  it("uploads a video as the post, lists the uploads playlist once resolved, reads statistics and comments", async () => {
    const { sites, calls } = fakeSites({
      "POST /upload/youtube/v3/videos": (i) => {
        expect(i).toEqual({
          snippet: { title: "My video", description: "desc", tags: ["a"] },
          status: { privacyStatus: "unlisted", publishAt: "2026-10-01T12:00:00.000Z" },
          file: "/data/out.mp4",
        });
        return { id: "v1", snippet: { publishedAt: "2026-09-21T00:00:00Z" } };
      },
      "GET /youtube/v3/channels": () => ({
        items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }],
      }),
      "GET /youtube/v3/playlistItems": (i) => {
        expect(i).toMatchObject({ playlistId: "UU1", maxResults: 2 });
        return {
          items: [
            {
              snippet: {
                title: "old",
                publishedAt: "2026-09-01T00:00:00Z",
                resourceId: { videoId: "v0" },
              },
            },
            {
              snippet: {
                title: "new",
                publishedAt: "2026-09-02T00:00:00Z",
                resourceId: { videoId: "v1" },
              },
            },
          ],
        };
      },
      "GET /youtube/v3/videos": (i) => {
        expect(i).toEqual({ part: "statistics", id: "v1" });
        return {
          items: [{ id: "v1", statistics: { viewCount: "12", likeCount: "3", commentCount: "1" } }],
        };
      },
      "GET /youtube/v3/commentThreads": () => ({
        items: [
          {
            id: "t1",
            snippet: {
              topLevelComment: {
                id: "c1",
                snippet: {
                  authorDisplayName: "Ana",
                  textOriginal: "nice",
                  publishedAt: "2026-09-03T00:00:00Z",
                },
              },
            },
          },
        ],
      }),
      "POST /youtube/v3/comments": (i) => {
        expect(i).toEqual({ snippet: { parentId: "c1", textOriginal: "thanks" } });
        return {};
      },
    });
    const ch = youtubeContent(sites);
    const p = await ch.publish({
      text: "desc",
      media: { kind: "video", source: "/data/out.mp4", title: "My video" },
      scheduledFor: "2026-10-01T12:00:00.000Z",
      extra: { tags: ["a"], privacyStatus: "unlisted" },
    });
    expect(p).toEqual({
      id: "v1",
      url: "https://www.youtube.com/watch?v=v1",
      publishedAt: "2026-10-01T12:00:00.000Z",
      fetchedWith: "api",
    });
    expect((await ch.list({ limit: 2 })).map((r) => r.id)).toEqual(["v1", "v0"]);
    await ch.list({ limit: 2 });
    expect(calls.filter(([, p]) => p === "/youtube/v3/channels")).toHaveLength(1);
    expect(await ch.metrics("v1")).toMatchObject({ views: 12, reactions: 3, comments: 1 });
    expect(await ch.comments("v1")).toEqual([
      { id: "c1", postId: "v1", author: "Ana", text: "nice", at: "2026-09-03T00:00:00Z" },
    ]);
    await ch.reply?.("c1", "thanks");
  });

  it("a post without a video or a title is refused before any call", async () => {
    const { sites, calls } = fakeSites({});
    const ch = youtubeContent(sites);
    await expect(ch.publish({ text: "x" })).rejects.toThrow(/a video/);
    await expect(
      ch.publish({ text: "x", media: { kind: "video", source: "a.mp4" } }),
    ).rejects.toThrow(/title/);
    expect(calls).toEqual([]);
  });
});
