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
          status: {
            privacyStatus: "unlisted",
            publishAt: "2026-10-01T12:00:00.000Z",
            selfDeclaredMadeForKids: false,
          },
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
        expect(i).toEqual({ part: "statistics,contentDetails", id: "v1" });
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
              channelId: "UCours",
            },
            replies: {
              comments: [
                {
                  id: "c1.r1",
                  snippet: {
                    authorDisplayName: "Wren",
                    authorChannelId: { value: "UCours" },
                    textOriginal: "thanks!",
                    publishedAt: "2026-09-03T01:00:00Z",
                  },
                },
                {
                  id: "c1.r2",
                  snippet: {
                    authorDisplayName: "Ana",
                    textOriginal: "one more question",
                    publishedAt: "2026-09-03T02:00:00Z",
                  },
                },
              ],
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
      {
        id: "c1.r2",
        postId: "v1",
        author: "Ana",
        text: "one more question",
        at: "2026-09-03T02:00:00Z",
        parentId: "c1",
      },
      {
        id: "c1.r1",
        postId: "v1",
        author: "Wren",
        text: "thanks!",
        at: "2026-09-03T01:00:00Z",
        parentId: "c1",
        mine: true,
      },
      { id: "c1", postId: "v1", author: "Ana", text: "nice", at: "2026-09-03T00:00:00Z" },
    ]);
    await ch.reply?.("c1", "thanks");
  });

  it("sets the thumbnail after the upload; a refused one never fails the post", async () => {
    for (const refuse of [false, true]) {
      const { sites, calls } = fakeSites({
        "POST /upload/youtube/v3/videos": () => ({ id: "v2" }),
        "POST /upload/youtube/v3/thumbnails/set": () => {
          if (refuse) throw new Error("403 custom thumbnails need a verified channel");
          return {};
        },
      });
      const p = await youtubeContent(sites).publish({
        text: "d",
        media: { kind: "video", source: "/mac/long.mp4", title: "T" },
        extra: { thumbnail: "/mac/thumb1.png" },
      });
      expect(p.id).toBe("v2");
      expect(p.notes).toEqual(
        refuse ? ["Thumbnail not set: 403 custom thumbnails need a verified channel"] : undefined,
      );
      expect(calls[0]?.[2]).not.toHaveProperty("thumbnail");
      expect(calls[1]).toEqual([
        "POST",
        "/upload/youtube/v3/thumbnails/set",
        { videoId: "v2", file: "/mac/thumb1.png", contentType: "image/png" },
      ]);
    }
  });

  it("a swap sends the snippet back whole with the new title or hook, and sets a thumbnail", async () => {
    const { sites, calls } = fakeSites({
      "GET /youtube/v3/videos": () => ({
        items: [
          {
            snippet: {
              title: "Old title",
              description: "Old hook\n\nChapters:\n0:00 Start",
              categoryId: "28",
              tags: ["a"],
              defaultAudioLanguage: "en",
              channelTitle: "dropped",
            },
          },
        ],
      }),
      "PUT /youtube/v3/videos": () => ({}),
      "POST /upload/youtube/v3/thumbnails/set": () => ({}),
    });
    const ch = youtubeContent(sites);
    await ch.update?.("v1", { title: "New title" });
    await ch.update?.("v1", { hook: "New hook" });
    await ch.update?.("v1", { thumbnail: "/mac/thumb2.png" });
    expect(calls.filter((c) => c[0] === "PUT").map((c) => c[2])).toEqual([
      {
        id: "v1",
        snippet: {
          title: "New title",
          description: "Old hook\n\nChapters:\n0:00 Start",
          categoryId: "28",
          tags: ["a"],
          defaultAudioLanguage: "en",
        },
      },
      {
        id: "v1",
        snippet: {
          title: "Old title",
          description: "New hook\n\nChapters:\n0:00 Start",
          categoryId: "28",
          tags: ["a"],
          defaultAudioLanguage: "en",
        },
      },
    ]);
    expect(calls.at(-1)).toEqual([
      "POST",
      "/upload/youtube/v3/thumbnails/set",
      { videoId: "v1", file: "/mac/thumb2.png", contentType: "image/png" },
    ]);
  });

  it("sends every field of its shape: kids, AI label, languages, notify, subtitles, playlist", async () => {
    const { sites, calls } = fakeSites({
      "POST /upload/youtube/v3/videos": () => ({ id: "v3" }),
      "POST /upload/youtube/v3/captions": () => {
        throw new Error("400 bad caption file");
      },
      "POST /youtube/v3/playlistItems": () => ({ id: "pi1" }),
    });
    const p = await youtubeContent(sites).publish({
      text: "d",
      media: { kind: "video", source: "/v.mp4" },
      extra: {
        title: "T",
        kind: "short",
        thumbnail: "s3://b/media/t.jpg",
        madeForKids: true,
        syntheticMedia: true,
        notifySubscribers: false,
        defaultLanguage: "en",
        defaultAudioLanguage: "es",
        categoryId: "27",
        captions: "https://example.com/c.vtt",
        captionsLanguage: "es",
        playlistId: "PLabcdefghij",
      },
    });
    expect(calls.map(([, path]) => path)).toEqual([
      "/upload/youtube/v3/videos",
      // A Short takes no thumbnail; the subtitles failing is a note, the playlist still goes.
      "/upload/youtube/v3/captions",
      "/youtube/v3/playlistItems",
    ]);
    expect(calls[0]?.[2]).toMatchObject({
      snippet: { title: "T", categoryId: "27", defaultLanguage: "en", defaultAudioLanguage: "es" },
      status: {
        privacyStatus: "private",
        selfDeclaredMadeForKids: true,
        containsSyntheticMedia: true,
      },
      notifySubscribers: false,
    });
    expect(calls[1]?.[2]).toEqual({
      videoId: "v3",
      language: "es",
      name: "Spanish",
      file: "https://example.com/c.vtt",
    });
    expect(calls[2]?.[2]).toEqual({ playlistId: "PLabcdefghij", videoId: "v3" });
    expect(p.notes).toEqual(["Subtitles not set: 400 bad caption file"]);
  });

  it("refuses a field its shape won't take before any call", async () => {
    const { sites, calls } = fakeSites({});
    await expect(
      youtubeContent(sites).publish({
        text: "d",
        media: { kind: "video", source: "/v.mp4", title: "T" },
        extra: { privacyStatus: "friends" },
      }),
    ).rejects.toThrow("Who sees it");
    expect(calls).toEqual([]);
  });

  it("a community post goes through the browser route, its image made reachable", async () => {
    const { sites, calls } = fakeSites({
      "POST /studio/communityPosts": (i) => ({
        url: i?.image ? "https://www.youtube.com/post/UgkxTest1" : null,
      }),
    });
    const ch = youtubeContent(sites, {
      host: { host: async (s) => `https://files.test/${s.split("/").pop()}` },
    });
    const p = await ch.publish({
      text: "Words",
      extra: { kind: "community", image: "/mac/chart.png" },
    });
    expect(calls).toEqual([
      ["POST", "/studio/communityPosts", { text: "Words", image: "https://files.test/chart.png" }],
    ]);
    expect(p).toMatchObject({ id: "UgkxTest1", url: "https://www.youtube.com/post/UgkxTest1" });
    expect(p.notes).toBeUndefined();
    // The list didn't show it: posted all the same, never retried.
    const bare = await ch.publish({ text: "Words", extra: { kind: "community" } });
    expect(bare.id).toMatch(/^community-\d+$/);
    expect(bare.notes?.[0]).toMatch(/Posts tab/);
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

  it("activity reads recent public subscribers with no time; audience reads the subscriber count", async () => {
    const { sites } = fakeSites({
      "GET /youtube/v3/subscriptions": (i) => {
        expect(i).toEqual({ part: "subscriberSnippet", myRecentSubscribers: true, maxResults: 5 });
        return {
          items: [
            { id: "s1", subscriberSnippet: { title: "Test Channel", channelId: "UCtest1" } },
            { subscriberSnippet: { channelId: "UCtest2" } },
            { subscriberSnippet: {} },
          ],
        };
      },
      "GET /youtube/v3/channels": (i) => {
        expect(i).toEqual({ part: "statistics", mine: true });
        return { items: [{ statistics: { subscriberCount: "42" } }] };
      },
    });
    const ch = youtubeContent(sites, { now: () => new Date("2026-10-06T00:00:00Z") });
    const rows = await ch.activity?.({ limit: 5, since: "2026-10-01T00:00:00Z" });
    expect(rows).toEqual([
      {
        id: "s1",
        kind: "subscribe",
        actor: "Test Channel",
        actorUrl: "https://www.youtube.com/channel/UCtest1",
        text: "Test Channel subscribed",
        url: null,
        at: null,
        raw: { id: "s1", subscriberSnippet: { title: "Test Channel", channelId: "UCtest1" } },
      },
      expect.objectContaining({ id: "UCtest2", actor: null, text: "Someone subscribed" }),
    ]);
    expect(await ch.audience?.()).toEqual({
      followers: 42,
      asOf: "2026-10-06T00:00:00.000Z",
      raw: { items: [{ statistics: { subscriberCount: "42" } }] },
    });
  });
});

describe("youtube comments", () => {
  it("a video with comments off has none", async () => {
    const ch = youtubeContent(
      fakeSites({
        "GET /youtube/v3/commentThreads": () => {
          throw new Error(
            "403 The video identified by the videoId parameter has disabled comments.",
          );
        },
      }).sites,
    );
    expect(await ch.comments("v1")).toEqual([]);
  });

  it("any other failure still throws", async () => {
    const ch = youtubeContent(
      fakeSites({
        "GET /youtube/v3/commentThreads": () => {
          throw new Error("403 quotaExceeded");
        },
      }).sites,
    );
    await expect(ch.comments("v1")).rejects.toThrow("quotaExceeded");
  });
  describe("batch reads", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const videos = (i?: Record<string, unknown>) => ({
      items: String(i?.id)
        .split(",")
        .map((id) => ({
          id,
          statistics: {
            viewCount: "10",
            likeCount: "2",
            ...(id === "v1" ? {} : { commentCount: "4" }),
          },
          contentDetails: { duration: "PT1M30S" },
        })),
    });
    it("reads up to 50 videos a call: 120 posts take 3 reads, not 120", async () => {
      const { sites, calls } = fakeSites({ "GET /youtube/v3/videos": videos });
      const got = await youtubeContent(sites).metricsMany?.(ids.map((id) => ({ id })));
      expect(got).toHaveLength(120);
      expect(calls.map((c) => String(c[2]?.id).split(",").length)).toEqual([50, 50, 20]);
      expect(calls[0]?.[2]).toMatchObject({ part: "statistics,contentDetails" });
      // The length rides in `read`, as the single read does for `insights`.
      expect(got?.[0]).toMatchObject({ id: "v0", views: 10, reactions: 2, comments: 4 });
      expect(got?.[0]?.read).toEqual({ durationSecs: 90 });
    });
    it("leaves out a video the read didn't return", async () => {
      const { sites } = fakeSites({
        "GET /youtube/v3/videos": () => ({ items: [{ id: "a", statistics: { viewCount: "1" } }] }),
      });
      const got = await youtubeContent(sites).metricsMany?.([{ id: "a" }, { id: "gone" }]);
      expect(got?.map((m) => m.id)).toEqual(["a"]);
    });
    it("counts comments from the same read; comments off has no count", async () => {
      const { sites, calls } = fakeSites({ "GET /youtube/v3/videos": videos });
      const counts = await youtubeContent(sites).commentCounts?.(["v0", "v1", "v2"]);
      expect(counts).toEqual({ v0: 4, v2: 4 });
      expect(calls).toHaveLength(1);
    });
  });
});
