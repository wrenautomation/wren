import type { MediaHost, SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { threadsContent } from "./threads.js";

function fakeSites(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(site, method, path, input) {
      expect(site).toBe("threads");
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
const host: MediaHost = { host: async (p) => `https://cdn.test/${p.split("/").pop()}` };
const now = () => new Date("2026-10-13T10:00:00Z");
const link = { "GET /posts/t2": () => ({ permalink: "https://www.threads.com/@wren/post/abc" }) };

describe("threads content channel", () => {
  it("posts words as TEXT with its link card and reply control, then reads the permalink", async () => {
    const { sites, calls } = fakeSites({
      "POST /me/threads": () => ({ id: "c1" }),
      "POST /me/threads_publish": () => ({ id: "t2" }),
      ...link,
    });
    const ch = threadsContent(sites, { now, host, sleep: async () => {} });
    const out = await ch.publish({
      text: "one point",
      extra: { linkCard: "https://wrenautomation.com/go/th", replyControl: "accounts_you_follow" },
    });
    expect(out).toMatchObject({ id: "t2", url: "https://www.threads.com/@wren/post/abc" });
    expect(calls[0]?.[2]).toEqual({
      text: "one point",
      media_type: "TEXT",
      link_attachment: "https://wrenautomation.com/go/th",
      reply_control: "accounts_you_follow",
    });
    expect(calls[1]?.[2]).toEqual({ creation_id: "c1" });
  });

  it("hosts a video, waits for FINISHED, publishes; a refused video stops before publish", async () => {
    const states = ["IN_PROGRESS", "FINISHED"];
    const slept: number[] = [];
    const { sites, calls } = fakeSites({
      "POST /me/threads": () => ({ id: "c1" }),
      "GET /containers/c1": () => ({ status: states.shift() }),
      "POST /me/threads_publish": () => ({ id: "t2" }),
      ...link,
    });
    const ch = threadsContent(sites, { now, host, sleep: async (ms) => void slept.push(ms) });
    await ch.publish({ text: "a clip", media: { kind: "video", source: "s3://b/clip.mp4" } });
    expect(calls[0]?.[2]).toMatchObject({
      media_type: "VIDEO",
      video_url: "https://cdn.test/clip.mp4",
    });
    expect(slept).toEqual([10_000, 10_000]);

    const bad = fakeSites({
      "POST /me/threads": () => ({ id: "c1" }),
      "GET /containers/c1": () => ({ status: "ERROR", error_message: "bad codec" }),
    });
    await expect(
      threadsContent(bad.sites, { host, sleep: async () => {} }).publish({
        text: "x",
        media: { kind: "video", source: "s3://b/clip.mp4" },
      }),
    ).rejects.toThrow("bad codec");
    expect(bad.calls.map((c) => c[1])).not.toContain("/me/threads_publish");
  });

  it("reads insights, replies as comments, and answers one as a reply post", async () => {
    const { sites, calls } = fakeSites({
      "GET /t2/insights": () => ({
        data: [
          { name: "views", values: [{ value: 90 }] },
          { name: "likes", values: [{ value: 7 }] },
          { name: "replies", values: [{ value: 2 }] },
          { name: "reposts", values: [{ value: 1 }] },
          { name: "quotes", values: [{ value: 1 }] },
        ],
      }),
      "GET /t2/replies": () => ({
        data: [{ id: "r1", text: "nice", username: "ana", timestamp: "2026-10-13T11:00:00Z" }],
      }),
      "POST /me/threads": () => ({ id: "c3" }),
      "POST /me/threads_publish": () => ({ id: "t4" }),
    });
    const ch = threadsContent(sites, { now });
    expect(await ch.metrics("t2")).toMatchObject({
      views: 90,
      reactions: 7,
      comments: 2,
      shares: 2,
    });
    expect((await ch.comments("t2")).map((c) => [c.author, c.text])).toEqual([["ana", "nice"]]);
    await ch.reply?.("r1", "thanks");
    expect(calls.at(-2)?.[2]).toEqual({ media_type: "TEXT", text: "thanks", reply_to_id: "r1" });
  });
});
