import { SiteCallError, type SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { xContent } from "./content.js";

function fakeSites(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(site, method, path, input) {
      expect(site).toBe("x");
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

describe("x content channel", () => {
  const now = () => new Date("2026-09-22T10:00:00Z");
  it("uploads media then posts, lists own posts, reads metrics, replies", async () => {
    const { sites, calls } = fakeSites({
      "GET /2/users/me": () => ({ data: { id: "u1", username: "wren" } }),
      "POST /2/media/upload": (i) => {
        expect(i).toEqual({ file: "/data/short.mp4" });
        return { data: { id: "m1" } };
      },
      "POST /2/tweets": (i) => ({ data: { id: i?.reply ? "r1" : "t1" } }),
      "GET /2/users/u1/tweets": () => ({
        data: [
          { id: "t0", text: "old", created_at: "2026-09-01T00:00:00Z" },
          { id: "t1", text: "new", created_at: "2026-09-02T00:00:00Z" },
        ],
      }),
      "GET /2/tweets/t1": () => ({
        data: {
          id: "t1",
          public_metrics: {
            impression_count: 100,
            like_count: 5,
            reply_count: 2,
            retweet_count: 1,
            quote_count: 1,
          },
        },
      }),
    });
    const ch = xContent(sites, { now });
    const out = await ch.publish({
      text: "hi",
      media: { kind: "video", source: "/data/short.mp4" },
    });
    expect(out).toEqual({
      id: "t1",
      url: "https://x.com/wren/status/t1",
      publishedAt: "2026-09-22T10:00:00.000Z",
      fetchedWith: "api",
    });
    expect(calls[1]).toEqual(["POST", "/2/tweets", { text: "hi", media: { media_ids: ["m1"] } }]);
    const rows = await ch.list({ limit: 1 });
    expect(rows.map((r) => r.id)).toEqual(["t1"]);
    expect(calls.filter((c) => c[1] === "/2/users/me")).toHaveLength(1); // who am I: once
    expect(await ch.metrics("t1")).toMatchObject({
      views: 100,
      reactions: 5,
      comments: 2,
      shares: 2,
    });
    await ch.reply?.("t1", "thanks");
    expect(calls.at(-1)).toEqual([
      "POST",
      "/2/tweets",
      { text: "thanks", reply: { in_reply_to_tweet_id: "t1" } },
    ]);
  });

  it("posts the file and the field's images in order, or a poll; refuses both before uploading", async () => {
    let n = 0;
    const { sites, calls } = fakeSites({
      "GET /2/users/me": () => ({ data: { id: "u1", username: "wren" } }),
      "POST /2/media/upload": () => ({ data: { id: `m${++n}` } }),
      "POST /2/tweets": () => ({ data: { id: "t9" } }),
    });
    const ch = xContent(sites, { now });
    await ch.publish({
      text: "three",
      media: { kind: "image", source: "/data/a.jpg" },
      extra: { images: ["/data/b.jpg", "/data/c.png"] },
    });
    await ch.publish({ text: "pick", extra: { poll: ["Yes", "No"], pollMinutes: 60 } });
    const tweets = calls.filter(([m, p]) => m === "POST" && p === "/2/tweets").map((c) => c[2]);
    expect(tweets[0]).toEqual({ text: "three", media: { media_ids: ["m1", "m2", "m3"] } });
    expect(tweets[1]).toEqual({
      text: "pick",
      poll: { options: ["Yes", "No"], duration_minutes: 60 },
    });

    const before = calls.length;
    await expect(
      ch.publish({
        text: "x",
        media: { kind: "image", source: "/data/a.jpg" },
        extra: { poll: ["Yes", "No"] },
      }),
    ).rejects.toThrow(/poll or a file/);
    await expect(
      ch.publish({ text: "x", extra: { poll: ["Yes", "No"], images: ["/data/b.jpg"] } }),
    ).rejects.toThrow(/poll or images/);
    await expect(
      ch.publish({
        text: "x",
        media: { kind: "image", source: "/data/a.jpg" },
        extra: { images: ["/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg"] },
      }),
    ).rejects.toThrow(/up to 4/);
    expect(calls.length).toBe(before);
  });

  it("posts a long single post whole, in one call", async () => {
    const { sites, calls } = fakeSites({
      "GET /2/users/me": () => ({ data: { id: "u1", username: "wren" } }),
      "POST /2/tweets": () => ({ data: { id: "t1" } }),
    });
    const text = `${"a".repeat(1500)}\n\n---\n\n${"b".repeat(1500)}`;
    await xContent(sites, { now }).publish({ text });
    const posts = calls.filter(([m, p]) => m === "POST" && p === "/2/tweets");
    expect(posts).toEqual([["POST", "/2/tweets", { text }]]);
  });

  it("answers no comments when search is a tier the account lacks", async () => {
    const sites: SiteClient = {
      async call(_s, _m, path) {
        throw new SiteCallError("x", "GET", path, 402, "upgrade");
      },
      async via() {
        return "api";
      },
    };
    expect(await xContent(sites).comments("t1")).toEqual([]);
  });
});
