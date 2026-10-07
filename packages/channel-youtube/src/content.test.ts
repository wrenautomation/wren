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
