import type { MediaHost, SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { facebookContent, instagramContent } from "./content.js";

function fakeSites(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(site, method, path, input) {
      expect(site).toBe("meta");
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
const pages = () => ({
  data: [{ id: "111", name: "Wren", instagram_business_account: { id: "ig9" } }],
});
const host: MediaHost = { host: async (p) => `https://cdn.test/${p.split("/").pop()}` };
const now = () => new Date("2026-09-22T10:00:00Z");

describe("instagram content channel", () => {
  it("hosts a local video, makes a Reel container, waits, publishes; lists and reads", async () => {
    const slept: number[] = [];
    const { sites, calls } = fakeSites({
      "GET /me/accounts": pages,
      "POST /ig9/media": (i) => {
        expect(i).toEqual({
          video_url: "https://cdn.test/short.mp4",
          media_type: "REELS",
          caption: "a reel",
        });
        return { id: "c1" };
      },
      "POST /ig9/media_publish": (i) => {
        expect(i).toEqual({ creation_id: "c1" });
        return { id: "p1" };
      },
      "GET /ig9/media": () => ({
        data: [
          {
            id: "p1",
            caption: "a reel",
            permalink: "https://www.instagram.com/reel/x/",
            timestamp: "2026-09-22T10:00:00+0000",
          },
        ],
      }),
      "GET /p1/insights": () => ({
        data: [
          { name: "reach", values: [{ value: 40 }] },
          { name: "likes", values: [{ value: 4 }] },
        ],
      }),
      "GET /p1/comments": () => ({
        data: [{ id: "c9", text: "nice", username: "bob", timestamp: "2026-09-22T11:00:00+0000" }],
      }),
      "POST /c9/replies": (i) => {
        expect(i).toEqual({ message: "ty" });
        return { id: "r1" };
      },
    });
    const ch = instagramContent(sites, { now, host, sleep: async (ms) => void slept.push(ms) });
    const out = await ch.publish({
      text: "a reel",
      media: { kind: "video", source: "/data/short.mp4" },
    });
    expect(out).toMatchObject({
      id: "p1",
      url: "https://www.instagram.com/p/p1/",
      fetchedWith: "api",
    });
    expect(slept).toEqual([15_000]);
    expect((await ch.list()).map((r) => r.url)).toEqual(["https://www.instagram.com/reel/x/"]);
    expect(await ch.metrics("p1")).toMatchObject({ views: 40, reactions: 4, comments: 0 });
    expect((await ch.comments("p1")).map((c) => c.author)).toEqual(["bob"]);
    await ch.reply?.("c9", "ty");
    expect(calls.filter((c) => c[1] === "/me/accounts")).toHaveLength(1);
  });

  it("refuses a local file with no host, and a Page without an Instagram account", async () => {
    const { sites } = fakeSites({ "GET /me/accounts": () => ({ data: [{ id: "111" }] }) });
    await expect(
      instagramContent(sites, { now }).publish({
        text: "x",
        media: { kind: "image", source: "/a.png" },
      }),
    ).rejects.toThrow(/no Instagram professional account/);
    const { sites: withIg } = fakeSites({ "GET /me/accounts": pages });
    await expect(
      instagramContent(withIg, { now }).publish({
        text: "x",
        media: { kind: "image", source: "/a.png" },
      }),
    ).rejects.toThrow(/public URL/);
  });
});

describe("facebook content channel", () => {
  it("posts text to the feed (scheduled when asked), a hosted photo, a video; lists and reads", async () => {
    const { sites, calls } = fakeSites({
      "GET /me/accounts": pages,
      "POST /111/feed": () => ({ id: "111_1" }),
      "POST /111/photos": () => ({ id: "ph", post_id: "111_2" }),
      "POST /111/videos": () => ({ id: "111_3" }),
      "GET /111/posts": () => ({
        data: [{ id: "111_1", message: "hello", created_time: "2026-09-22T10:00:00+0000" }],
      }),
      "GET /111_1": () => ({
        shares: { count: 2 },
        likes: { summary: { total_count: 7 } },
        comments: { summary: { total_count: 1 } },
        insights: { data: [{ name: "post_impressions", values: [{ value: 300 }] }] },
      }),
    });
    const ch = facebookContent(sites, { now, host, pageId: "111" });
    await ch.publish({
      text: "hello",
      scheduledFor: "2026-10-01T12:00:00Z",
      extra: { link: "https://w.dev" },
    });
    expect(calls.at(-1)).toEqual([
      "POST",
      "/111/feed",
      {
        message: "hello",
        link: "https://w.dev",
        published: false,
        scheduled_publish_time: 1790856000,
      },
    ]);
    const photo = await ch.publish({
      text: "pic",
      media: { kind: "image", source: "/data/a.png" },
    });
    expect(photo.id).toBe("111_2");
    expect(calls.at(-1)).toEqual([
      "POST",
      "/111/photos",
      { url: "https://cdn.test/a.png", message: "pic" },
    ]);
    await ch.publish({
      text: "clip",
      media: { kind: "video", source: "https://v.test/c.mp4", title: "T" },
    });
    expect(calls.at(-1)).toEqual([
      "POST",
      "/111/videos",
      { file_url: "https://v.test/c.mp4", description: "clip", title: "T" },
    ]);
    expect((await ch.list()).map((r) => r.preview)).toEqual(["hello"]);
    expect(await ch.metrics("111_1")).toMatchObject({
      views: 300,
      reactions: 7,
      comments: 1,
      shares: 2,
    });
  });
});
