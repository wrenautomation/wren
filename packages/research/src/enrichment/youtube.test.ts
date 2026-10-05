import { describe, expect, it } from "vitest";
import {
  channelRef,
  countYouTubeUnit,
  emptyYouTubeStats,
  readChannel,
  readUploads,
  seconds,
  YouTubeError,
  type YouTubeGet,
  youtubeFindings,
} from "./youtube.js";

/** A Data API stand-in: answers by resource, records every call. */
function fakeApi(answers: Record<string, unknown | YouTubeError>) {
  const calls: { resource: string; query: Record<string, string> }[] = [];
  const get: YouTubeGet = async (resource, query) => {
    calls.push({ resource, query });
    const a = answers[resource];
    if (a instanceof YouTubeError) throw a;
    return a;
  };
  return { get, calls };
}

const CHANNEL = {
  items: [
    {
      id: "UCabcdefghijklmnopqrstuv",
      snippet: {
        title: "Example Staffing",
        customUrl: "@examplestaffing",
        description: "We hire.",
      },
      contentDetails: { relatedPlaylists: { uploads: "UUabcdefghijklmnopqrstuv" } },
      statistics: { subscriberCount: "120", videoCount: "14" },
    },
  ],
};

const item = (videoId: string, title: string, publishedAt: string) => ({
  snippet: { title, description: "", resourceId: { videoId } },
  contentDetails: { videoId, videoPublishedAt: publishedAt },
});

describe("channelRef", () => {
  it("handle, channel id and username links each have a lookup", () => {
    expect(channelRef("https://www.youtube.com/@examplestaffing")).toEqual({
      by: "forHandle",
      value: "@examplestaffing",
    });
    expect(channelRef("https://youtube.com/channel/UCabcdefghijklmnopqrstuv/videos")).toEqual({
      by: "id",
      value: "UCabcdefghijklmnopqrstuv",
    });
    expect(channelRef("https://m.youtube.com/user/examplestaffing")).toEqual({
      by: "forUsername",
      value: "examplestaffing",
    });
  });

  it("custom, video and foreign links have none", () => {
    expect(channelRef("https://www.youtube.com/c/ExampleStaffing")).toHaveProperty("missing");
    expect(channelRef("https://www.youtube.com/watch?v=abc")).toHaveProperty("missing");
    expect(channelRef("https://notyoutube.com/@x")).toHaveProperty("missing");
    expect(channelRef("not a url")).toHaveProperty("missing");
  });
});

describe("reads", () => {
  it("a channel by its link's lookup, counts as numbers", async () => {
    const api = fakeApi({ channels: CHANNEL });
    const c = await readChannel(api.get, { by: "forHandle", value: "@examplestaffing" });
    expect(api.calls[0]?.query.forHandle).toBe("@examplestaffing");
    expect(c).toMatchObject({ title: "Example Staffing", subscribers: 120, videos: 14 });
    expect(c?.uploads).toBe("UUabcdefghijklmnopqrstuv");
    expect(await readChannel(fakeApi({ channels: {} }).get, { by: "id", value: "x" })).toBeNull();
  });

  it("asks for every part, and keeps the channel's whole answer", async () => {
    const api = fakeApi({ channels: CHANNEL });
    const c = await readChannel(api.get, { by: "id", value: "UCabcdefghijklmnopqrstuv" });
    expect(api.calls[0]?.query.part?.split(",")).toEqual(
      expect.arrayContaining(["brandingSettings", "topicDetails", "status", "localizations"]),
    );
    expect(c?.raw).toBe(CHANNEL.items[0]);
  });

  it("uploads newest first, gone videos dropped, a 404 playlist is none", async () => {
    const api = fakeApi({
      playlistItems: {
        items: [
          item("old", "Hiring in 2025", "2025-01-02T00:00:00Z"),
          item("gone", "Private video", "2026-09-01T00:00:00Z"),
          item("new", "Placing nurses fast", "2026-09-20T00:00:00Z"),
        ],
      },
      videos: {},
    });
    expect((await readUploads(api.get, "UUx")).map((u) => u.videoId)).toEqual(["new", "old"]);
    const none = fakeApi({ playlistItems: new YouTubeError(404, "playlistNotFound", "gone") });
    expect(await readUploads(none.get, "UUx")).toEqual([]);
  });

  it("pages to the limit, then joins each video's details, text uncut", async () => {
    const long = "x".repeat(4000);
    const page = (from: number, n: number, next?: string) => ({
      items: Array.from({ length: n }, (_, k) =>
        item(`v${from + k}`, "Hi", "2026-09-20T00:00:00Z"),
      ),
      nextPageToken: next,
    });
    const calls: { resource: string; query: Record<string, string> }[] = [];
    const get: YouTubeGet = async (resource, query) => {
      calls.push({ resource, query });
      if (resource === "videos")
        return {
          items: query.id?.split(",").map((id) => ({
            id,
            snippet: { description: long, tags: ["nurses"] },
            statistics: { viewCount: "10", likeCount: "2", commentCount: "1" },
            contentDetails: { duration: "PT1M5S" },
          })),
        };
      const n = Number(query.maxResults);
      return query.pageToken ? page(50, n, "p3") : page(0, n, "p2");
    };
    const ups = await readUploads(get, "UUx", 60);
    expect(
      calls.map((c) => [c.resource, c.query.maxResults ?? c.query.id?.split(",").length]),
    ).toEqual([
      ["playlistItems", "50"],
      ["playlistItems", "10"],
      ["videos", 50],
      ["videos", 10],
    ]);
    expect(ups).toHaveLength(60);
    expect(ups[0]).toMatchObject({
      views: 10,
      likes: 2,
      comments: 1,
      seconds: 65,
      tags: ["nurses"],
    });
    expect(ups[0]?.raw).toMatchObject({ snippet: { description: long } });
  });

  it("durations as seconds", () => {
    expect([seconds("PT1H2M3S"), seconds("PT45S"), seconds("P1DT1S"), seconds("P0D")]).toEqual([
      3723, 45, 86401, 0,
    ]);
    expect([seconds(undefined), seconds("P"), seconds("soon")]).toEqual([null, null, null]);
  });
});

describe("findings", () => {
  it("a channel is one profile, each upload a post with its watch link", () => {
    const fs = youtubeFindings(7, "https://www.youtube.com/@examplestaffing", {
      channel: {
        id: "UCabcdefghijklmnopqrstuv",
        title: "Example Staffing",
        handle: null,
        about: "",
        country: null,
        subscribers: null,
        videos: 1,
        views: null,
        keywords: null,
        topics: [],
        publishedAt: null,
        uploads: "UUabcdefghijklmnopqrstuv",
        raw: { id: "UCabcdefghijklmnopqrstuv" },
      },
      uploads: [
        {
          videoId: "v1",
          title: "Hi",
          description: "",
          publishedAt: "2026-09-20T00:00:00Z",
          views: 3,
          likes: null,
          comments: null,
          seconds: 30,
          tags: [],
          live: false,
          raw: { id: "v1" },
        },
      ],
    });
    expect(fs.map((f) => f.value.raw)).toEqual([{ id: "UCabcdefghijklmnopqrstuv" }, { id: "v1" }]);
    expect(fs.map((f) => [f.kind, f.factKey, f.via])).toEqual([
      ["profile", "c7:profile:youtube:UCabcdefghijklmnopqrstuv", "youtube"],
      ["post", "c7:post:youtube:v1", "youtube"],
    ]);
    expect(fs[1]?.sourceUrl).toBe("https://www.youtube.com/watch?v=v1");
  });

  it("a link with no channel is a missing profile, so it isn't read again soon", () => {
    const [f] = youtubeFindings(7, "https://www.youtube.com/c/X", { missing: "custom" });
    expect(f).toMatchObject({ kind: "profile", value: { missing: "custom" } });
  });
});

describe("countYouTubeUnit", () => {
  const unit = (outcome: "read" | "missing" | "quota" | "error") => ({
    companyId: 1,
    outcome,
    uploads: outcome === "read" ? 3 : 0,
    error: outcome === "error" ? "HTTP 500" : null,
  });

  it("spent quota stops at once; errors stop after five in a row", () => {
    const stats = emptyYouTubeStats();
    const streak = { errors: 0 };
    expect(countYouTubeUnit(stats, unit("quota"), streak)).toMatch(/daily units/);
    expect(countYouTubeUnit(stats, unit("read"), streak)).toBeNull();
    for (let i = 0; i < 4; i++) expect(countYouTubeUnit(stats, unit("error"), streak)).toBeNull();
    expect(countYouTubeUnit(stats, unit("error"), streak)).toMatch(/5 errors in a row/);
    expect(stats).toMatchObject({ read: 1, uploads: 3, errors: 5 });
  });
});
