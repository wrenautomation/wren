// A connected TikTok's numbers on Account → Social, against a fake SiteClient. Synthetic ids.
import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { TIKTOK_RECENT, tiktokNumbers, videoLine } from "./tiktok-numbers.js";

const NOW = new Date("2026-10-15T12:00:00Z");
type Asked = { method: string; path: string; input?: Record<string, unknown>; account?: string };

const fake = (answer: (path: string) => unknown) => {
  const asked: Asked[] = [];
  const sites: SiteClient = {
    call: async <T>(
      _site: string,
      method: string,
      path: string,
      input?: Record<string, unknown>,
      account?: string,
    ): Promise<T> => {
      asked.push({ method, path, ...(input ? { input } : {}), ...(account ? { account } : {}) });
      const out = answer(path);
      if (out instanceof Error) throw out;
      return out as T;
    },
    via: async () => "api",
  };
  return { sites, asked };
};

const ALL = "user.info.basic,user.info.stats,video.list,video.publish";
const STATS = { data: { user: { follower_count: 1200, likes_count: 34000, video_count: 9 } } };
const video = (i: number) => ({
  id: `v${i}`,
  title: `Video ${i}`,
  view_count: 100 * i,
  like_count: i,
  comment_count: 0,
  share_url: `https://www.tiktok.com/@acme/video/${i}`,
  cover_image_url: `https://p16.tiktokcdn.example/${i}.jpeg`,
  create_time: 1_760_000_000 + i,
});

describe("tiktokNumbers", () => {
  it("reads stats and the newest videos on the connection's own login", async () => {
    const { sites, asked } = fake((p) =>
      p === "/v2/user/info/" ? STATS : { data: { videos: [1, 2, 3, 4, 5, 6, 7].map(video) } },
    );
    const n = await tiktokNumbers(sites, { id: 7, scopes: ALL }, { now: NOW });
    expect(n).toMatchObject({ followers: 1200, likes: 34000, videos: 9, gaps: [] });
    expect(n.recent).toHaveLength(TIKTOK_RECENT);
    expect(n.recent[0]).toMatchObject({
      id: "v1",
      views: 100,
      url: expect.stringContaining("tiktok.com"),
    });
    expect(asked.map((a) => a.account)).toEqual(["social:7", "social:7"]);
    expect(asked.find((a) => a.path === "/v2/video/list/")?.method).toBe("POST");
  });

  it("asks nothing a scope doesn't cover, and says which to grant", async () => {
    const { sites, asked } = fake(() => STATS);
    const n = await tiktokNumbers(
      sites,
      { id: 7, scopes: "user.info.basic video.publish" },
      { now: NOW },
    );
    expect(asked).toHaveLength(0);
    expect(n.gaps).toEqual([
      "Followers need user.info.stats. Connect TikTok again to grant it.",
      "Videos need video.list. Connect TikTok again to grant it.",
    ]);
  });

  it("a refusal or a slow answer is a gap; the other part still shows", async () => {
    const refused = fake((p) =>
      p === "/v2/user/info/" ? new Error("scope_not_authorized") : { data: { videos: [video(1)] } },
    );
    const n = await tiktokNumbers(refused.sites, { id: 7, scopes: ALL }, { now: NOW });
    expect(n.followers).toBeNull();
    expect(n.recent).toHaveLength(1);
    expect(n.gaps).toEqual(["Followers: scope_not_authorized"]);

    const slow: SiteClient = {
      call: () => new Promise(() => {}),
      via: async () => "api",
    };
    const t = await tiktokNumbers(slow, { id: 7, scopes: ALL }, { now: NOW, ms: 5 });
    expect(t.gaps).toEqual(["Followers: TikTok took too long", "Videos: TikTok took too long"]);
  });
});

describe("videoLine", () => {
  it("keeps https links only and dates from seconds", () => {
    const v = videoLine({ ...video(1), share_url: "http://x.example/1", cover_image_url: 3 });
    expect(v).toMatchObject({ url: null, cover: null, views: 100 });
    expect(v.postedAt).toBe(new Date((1_760_000_000 + 1) * 1000).toISOString());
  });
});
