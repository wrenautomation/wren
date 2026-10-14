import type { MediaHost, SiteClient } from "@wren/core/content";
import { ShapeError } from "@wren/core/content/shapes";
import { describe, expect, it } from "vitest";
import { tiktokContent } from "./content.js";

function fakeSites(answer: (input?: Record<string, unknown>) => unknown) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(site, method, path, input) {
      expect(site).toBe("tiktok");
      calls.push([method, path, input]);
      if (`${method} ${path}` !== "POST /web/posts") throw new Error(`no fake for ${path}`);
      return answer(input) as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, calls };
}
const host: MediaHost = { host: async (s) => `https://signed.test/${s.split("/").pop()}` };
const video = { kind: "video" as const, source: "s3://media-bucket/media/short.mp4" };
const now = () => new Date("2026-10-14T12:00:00Z");

describe("tiktok content channel, posting through the web", () => {
  it("posts the stored file through Studio with the picked fields; the id is the video's", async () => {
    const { sites, calls } = fakeSites(() => ({
      id: "7400000000000000009",
      url: "https://www.tiktok.com/@acme/video/7400000000000000009",
      profile: "https://www.tiktok.com/@acme",
    }));
    const out = await tiktokContent(sites, { host, now, postVia: "web" }).publish({
      text: "a short",
      media: video,
      extra: {
        privacy: "PUBLIC_TO_EVERYONE",
        allowComment: true,
        allowDuet: true,
        allowStitch: true,
      },
    });
    expect(calls).toEqual([
      [
        "POST",
        "/web/posts",
        {
          file: "https://signed.test/short.mp4",
          caption: "a short",
          privacy: "everyone",
          comments: true,
          reuse: true,
          aiGenerated: false,
        },
      ],
    ]);
    expect(out).toEqual({
      id: "7400000000000000009",
      url: "https://www.tiktok.com/@acme/video/7400000000000000009",
      publishedAt: "2026-10-14T12:00:00.000Z",
      fetchedWith: "browser",
    });
  });

  it("maps who can see it; interactions stay off unless picked", async () => {
    const { sites, calls } = fakeSites(() => ({ id: "7400000000000000010" }));
    await tiktokContent(sites, { host, now, postVia: "web" }).publish({
      text: "x",
      media: video,
      extra: { privacy: "SELF_ONLY", aiGenerated: true },
    });
    expect(calls[0]?.[2]).toMatchObject({
      privacy: "only-me",
      comments: false,
      reuse: false,
      aiGenerated: true,
    });
  });

  it("a post the profile has not listed yet is still published, with the note", async () => {
    const { sites } = fakeSites(() => ({
      id: null,
      url: null,
      profile: "https://www.tiktok.com/@acme",
      note: "posted, but the profile does not list it yet",
    }));
    const out = await tiktokContent(sites, { host, now, postVia: "web" }).publish({
      text: "x",
      media: video,
      extra: { privacy: "PUBLIC_TO_EVERYONE" },
    });
    expect(out).toMatchObject({
      url: "https://www.tiktok.com/@acme",
      fetchedWith: "browser",
      notes: ["posted, but the profile does not list it yet"],
    });
  });

  it("refuses what Studio can't set rather than dropping it", async () => {
    const { sites, calls } = fakeSites(() => ({ id: "1" }));
    const ch = tiktokContent(sites, { host, now, postVia: "web" });
    for (const extra of [
      { privacy: "FOLLOWER_OF_CREATOR" },
      { privacy: "PUBLIC_TO_EVERYONE", disclose: true, yourBrand: true },
      { privacy: "PUBLIC_TO_EVERYONE", coverMs: 1000 },
      { privacy: "PUBLIC_TO_EVERYONE", allowDuet: true },
    ])
      await expect(ch.publish({ text: "x", media: video, extra })).rejects.toBeInstanceOf(
        ShapeError,
      );
    await expect(ch.publish({ text: "x", media: video })).rejects.toThrow(/who can see it/);
    expect(calls).toHaveLength(0);
  });

  it("a client's connected account keeps the API whatever postVia says", async () => {
    const { sites } = fakeSites(() => ({ id: "1" }));
    await expect(
      tiktokContent(sites, { host, now, postVia: "web", direct: true }).publish({
        text: "x",
        media: video,
        extra: { privacy: "PUBLIC_TO_EVERYONE" },
      }),
    ).rejects.toThrow(/no fake for/);
  });
});
