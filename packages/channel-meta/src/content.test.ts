import type { MediaHost, SiteClient } from "@wren/core/content";
import { slidesKey } from "@wren/core/content/slides";
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
    let polls = 0;
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
      "GET /c1": (i) => {
        expect(i).toEqual({ fields: "status_code,status" });
        return { status_code: ++polls < 3 ? "IN_PROGRESS" : "FINISHED" };
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
      "GET /p1/insights": (i) =>
        (i as { metric?: string }).metric === "follows"
          ? { data: [{ name: "follows", values: [{ value: 2 }] }] }
          : {
              data: [
                { name: "reach", values: [{ value: 40 }] },
                { name: "likes", values: [{ value: 4 }] },
              ],
            },
      "GET /p1/comments": (i) => {
        expect(i).toMatchObject({
          fields:
            "id,text,username,timestamp,from{id},replies{id,text,username,timestamp,from{id}}",
        });
        return {
          data: [
            {
              id: "c9",
              text: "nice",
              username: "bob",
              timestamp: "2026-09-22T11:00:00+0000",
              replies: {
                data: [
                  {
                    id: "c10",
                    text: "and one more thing?",
                    username: "bob",
                    timestamp: "2026-09-22T12:00:00+0000",
                  },
                ],
              },
            },
          ],
        };
      },
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
    expect(slept).toEqual([10_000, 15_000, 20_000]);
    expect((await ch.list()).map((r) => r.url)).toEqual(["https://www.instagram.com/reel/x/"]);
    const before = calls.length;
    expect(await ch.metrics("p1")).toMatchObject({ views: 40, reactions: 4, comments: 0 });
    // One read: follows comes with the post's insights (a Reel refuses it either way).
    expect(calls.slice(before).map((c) => `${c[0]} ${c[1]}`)).toEqual(["GET /p1/insights"]);
    expect((await ch.comments("p1")).map((c) => [c.id, c.author, c.parentId])).toEqual([
      ["c10", "bob", "c9"],
      ["c9", "bob", undefined],
    ]);
    await ch.reply?.("c9", "ty");
    expect(calls.filter((c) => c[1] === "/me/accounts")).toHaveLength(1);
  });

  it("posts a carousel: a child per drawn slide, the parent, then publish", async () => {
    const slides = Array.from({ length: 5 }, (_, i) => ({ title: `Slide ${i + 1}`, lines: [] }));
    const images = slides.map((_, i) => `s3://media/media/s${i}.jpg`);
    const extra = {
      kind: "carousel",
      slides,
      rendered: { images, pdf: "s3://media/media/d.pdf", of: slidesKey(slides), at: "x" },
    };
    let n = 0;
    const { sites, calls } = fakeSites({
      "GET /me/accounts": pages,
      "POST /ig9/media": (i) => {
        if (i?.media_type === "CAROUSEL") {
          expect(i).toEqual({
            media_type: "CAROUSEL",
            children: ["k0", "k1", "k2", "k3", "k4"],
            caption: "five slides",
          });
          return { id: "parent" };
        }
        expect(i).toEqual({ image_url: `https://cdn.test/s${n}.jpg`, is_carousel_item: true });
        return { id: `k${n++}` };
      },
      "POST /ig9/media_publish": (i) => {
        expect(i).toEqual({ creation_id: "parent" });
        return { id: "p7" };
      },
    });
    const ch = instagramContent(sites, { host, now });
    const out = await ch.publish({ text: "five slides", extra });
    expect(out.id).toBe("p7");
    expect(calls.filter(([m, p]) => m === "POST" && p === "/ig9/media")).toHaveLength(6);
  });

  it("posts a story: a STORIES container, no caption, publish, its permalink read back", async () => {
    const slept: number[] = [];
    const { sites, calls } = fakeSites({
      "GET /me/accounts": pages,
      "POST /ig9/media": () => ({ id: "c3" }),
      "POST /ig9/media_publish": () => ({ id: "st1" }),
      "GET /st1": () => ({ permalink: "https://www.instagram.com/stories/wren/st1/" }),
      "GET /c3": () => ({ status_code: "FINISHED" }),
    });
    const ch = instagramContent(sites, { host, now, sleep: async (ms) => void slept.push(ms) });
    const photo = await ch.publish({
      text: "ignored",
      media: { kind: "image", source: "/mac/bts.jpg" },
      extra: { kind: "story" },
    });
    expect(calls[1]).toEqual([
      "POST",
      "/ig9/media",
      { image_url: "https://cdn.test/bts.jpg", media_type: "STORIES" },
    ]);
    expect(photo).toMatchObject({ id: "st1", url: "https://www.instagram.com/stories/wren/st1/" });
    expect(slept).toEqual([]);
    await ch.publish({
      text: "",
      media: { kind: "video", source: "/mac/clip.mp4" },
      extra: { kind: "story" },
    });
    expect(calls.filter(([, p]) => p === "/ig9/media").at(-1)?.[2]).toEqual({
      video_url: "https://cdn.test/clip.mp4",
      media_type: "STORIES",
    });
    expect(slept).toEqual([10_000]);
  });

  it("a video stuck in progress is read 12 times over 5 minutes, then fails unposted", async () => {
    const slept: number[] = [];
    const { sites, calls } = fakeSites({
      "GET /me/accounts": pages,
      "POST /ig9/media": () => ({ id: "c1" }),
      "GET /c1": () => ({ status_code: "IN_PROGRESS" }),
    });
    const ch = instagramContent(sites, { host, now, sleep: async (ms) => void slept.push(ms) });
    await expect(
      ch.publish({ text: "x", media: { kind: "video", source: "/mac/clip.mp4" } }),
    ).rejects.toThrow(/still processing after 5 minutes/);
    expect(calls.filter(([, p]) => p === "/c1")).toHaveLength(12);
    expect(slept.reduce((a, b) => a + b, 0)).toBe(300_000);
    expect(calls.some(([, p]) => p === "/ig9/media_publish")).toBe(false);
  });

  it("stops on a video Graph refused, never publishing it", async () => {
    const { sites, calls } = fakeSites({
      "GET /me/accounts": pages,
      "POST /ig9/media": () => ({ id: "c4" }),
      "GET /c4": () => ({ status_code: "ERROR", status: "Error: unsupported codec" }),
    });
    await expect(
      instagramContent(sites, { host, now, sleep: async () => {} }).publish({
        text: "a reel",
        media: { kind: "video", source: "/data/short.mp4" },
      }),
    ).rejects.toThrow(/refused \(Error: unsupported codec\)/);
    expect(calls.some(([, p]) => p === "/ig9/media_publish")).toBe(false);
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

  it("activity reads tags newest first from one IG user read, since filters; audience shares that read", async () => {
    const igUser = {
      followers_count: 120,
      tags: {
        data: [
          {
            id: "m1",
            caption: "Old tag\nmore",
            permalink: "https://www.instagram.com/p/m1/",
            timestamp: "2026-09-01T00:00:00+0000",
            username: "test_user_a",
          },
          {
            id: "m2",
            caption: "Fresh tag line\nsecond line",
            permalink: "https://www.instagram.com/p/m2/",
            timestamp: "2026-09-20T00:00:00+0000",
            username: "test_user_b",
          },
          { id: "m3" },
        ],
      },
    };
    const { sites, calls } = fakeSites({
      "GET /me/accounts": pages,
      "GET /ig9": (i) => {
        expect(i).toEqual({
          fields: "followers_count,tags.limit(25){id,caption,permalink,timestamp,username}",
        });
        return igUser;
      },
    });
    const ig = instagramContent(sites, { now });
    expect(await ig.activity?.({ since: "2026-09-10T00:00:00Z" })).toEqual([
      {
        id: "m2",
        kind: "mention",
        actor: "test_user_b",
        actorUrl: "https://www.instagram.com/test_user_b/",
        text: "Fresh tag line",
        url: "https://www.instagram.com/p/m2/",
        at: "2026-09-20T00:00:00+0000",
        raw: igUser.tags.data[1],
      },
      {
        id: "m3",
        kind: "mention",
        actor: null,
        actorUrl: null,
        text: "",
        url: null,
        at: null,
        raw: { id: "m3" },
      },
    ]);
    expect((await ig.activity?.({ limit: 1 }))?.map((a) => a.id)).toEqual(["m2"]);
    expect(await ig.audience?.()).toEqual({
      followers: 120,
      asOf: "2026-09-22T10:00:00.000Z",
      raw: igUser,
    });
    expect(calls.filter(([, p]) => p === "/me/accounts")).toHaveLength(1);
  });
});

describe("facebook content channel", () => {
  it("posts a story on the Page: a photo story or a video story, by hosted URL", async () => {
    const { sites, calls } = fakeSites({
      "GET /me/accounts": pages,
      "POST /111/photo_stories": () => ({ post_id: "s1", success: true }),
      "POST /111/video_stories": () => ({ post_id: "s2", success: true }),
    });
    const ch = facebookContent(sites, { now, host, pageId: "111" });
    const photo = await ch.publish({
      text: "",
      media: { kind: "image", source: "/mac/bts.jpg" },
      extra: { kind: "story" },
    });
    expect(calls.at(-1)).toEqual([
      "POST",
      "/111/photo_stories",
      { url: "https://cdn.test/bts.jpg" },
    ]);
    expect(photo.id).toBe("s1");
    await ch.publish({
      text: "",
      media: { kind: "video", source: "/mac/clip.mp4" },
      extra: { kind: "story" },
    });
    expect(calls.at(-1)).toEqual([
      "POST",
      "/111/video_stories",
      { file_url: "https://cdn.test/clip.mp4" },
    ]);
    await expect(ch.publish({ text: "x", extra: { kind: "story" } })).rejects.toThrow(
      /image or a video/,
    );
  });

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

describe("facebook Page comments", () => {
  it("reads none unless its token reads them; a connected Page reads and replies", async () => {
    const { sites, calls } = fakeSites({
      "GET /111_1/comments": () => ({
        data: [
          {
            id: "111_1_c1",
            message: "how much?",
            from: { id: "u9", name: "Sam Test" },
            created_time: "2026-09-22T11:00:00+0000",
          },
          {
            id: "111_1_c2",
            message: "Sent you a note",
            from: { id: "111", name: "Acme" },
            parent: { id: "111_1_c1" },
            created_time: "2026-09-22T11:05:00+0000",
          },
        ],
      }),
      "POST /111_1_c1/comments": (i) => {
        expect(i).toEqual({ pageId: "111", message: "dm us" });
        return { id: "r1" };
      },
    });
    expect(await facebookContent(sites, { now }).comments("111_1")).toEqual([]);
    expect(calls).toHaveLength(0);
    const ch = facebookContent(sites, { now, pageComments: true });
    expect(await ch.comments("111_1")).toEqual([
      {
        id: "111_1_c2",
        postId: "111_1",
        author: "Acme",
        text: "Sent you a note",
        at: "2026-09-22T11:05:00+0000",
        parentId: "111_1_c1",
        mine: true,
      },
      {
        id: "111_1_c1",
        postId: "111_1",
        author: "Sam Test",
        text: "how much?",
        at: "2026-09-22T11:00:00+0000",
      },
    ]);
    await ch.reply?.("111_1_c1", "dm us");
    expect(calls.map((c) => `${c[0]} ${c[1]}`)).toEqual([
      "GET /111_1/comments",
      "POST /111_1_c1/comments",
    ]);
  });
});

describe("a configured Page: /me/accounts is not read", () => {
  const accounts = (calls: Array<[string, string, unknown]>) =>
    calls.filter((c) => c[1] === "/me/accounts").length;
  const answers = {
    "GET /me/accounts": pages,
    "POST /ig9/media": () => ({ id: "c1" }),
    "POST /ig9/media_publish": () => ({ id: "p1" }),
    "GET /ig9/media": () => ({ data: [] }),
    "GET /ig9": () => ({ followers_count: 5 }),
    "POST /111/messages": () => ({ message_id: "m1" }),
    "POST /111/feed": () => ({ id: "111_1" }),
    "GET /111/posts": () => ({ data: [] }),
  };
  const passOver = async (ch: ReturnType<typeof instagramContent>) => {
    await ch.publish({ text: "x", media: { kind: "image", source: "https://i.test/a.png" } });
    await ch.list();
    await ch.activity?.();
    await ch.audience?.();
    await ch.accountInsights?.();
    await ch.privateReply?.("c9", "hi");
  };

  it("Instagram with the Page and account ids: no listing in a whole pass", async () => {
    const { sites, calls } = fakeSites(answers);
    await passOver(instagramContent(sites, { now, pageId: "111", igId: "ig9" }));
    expect(accounts(calls)).toBe(0);
    expect(calls.filter((c) => c[1] === "/ig9")).toHaveLength(3);
  });

  it("Instagram with the Page id alone lists once, then reuses it", async () => {
    const { sites, calls } = fakeSites(answers);
    await passOver(instagramContent(sites, { now, pageId: "111" }));
    expect(accounts(calls)).toBe(1);
  });

  it("Instagram with neither lists once", async () => {
    const { sites, calls } = fakeSites(answers);
    await passOver(instagramContent(sites, { now }));
    expect(accounts(calls)).toBe(1);
  });

  it("Facebook with the Page id: publish, list and a private reply never list Pages", async () => {
    const { sites, calls } = fakeSites(answers);
    const fb = facebookContent(sites, { now, pageId: "111" });
    await fb.publish({ text: "hello" });
    await fb.list();
    await fb.privateReply?.("c9", "hi");
    expect(accounts(calls)).toBe(0);
  });
});
