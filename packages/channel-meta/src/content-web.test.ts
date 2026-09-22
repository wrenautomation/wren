import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { instagramWebContent } from "./content-web.js";

function fakeSites(answer: unknown) {
  const calls: Array<{ site: string; method: string; path: string; input?: unknown }> = [];
  const sites: SiteClient = {
    call: async (site, method, path, input) => {
      calls.push({ site, method, path, input });
      return answer as never;
    },
    via: async () => "browser",
  };
  return { sites, calls };
}

const NOW = () => new Date("2026-09-22T18:00:00.000Z");

describe("instagram through the browser", () => {
  it("posts the local file with its caption and reads the post id off the link", async () => {
    const { sites, calls } = fakeSites({ url: "https://www.instagram.com/p/ABC123/" });
    const out = await instagramWebContent(sites, { now: NOW }).publish({
      text: "hello",
      media: { kind: "image", source: "/tmp/a.png" },
    });
    expect(calls).toEqual([
      {
        site: "instagram",
        method: "POST",
        path: "/web/posts",
        input: { file: "/tmp/a.png", caption: "hello" },
      },
    ]);
    expect(out).toEqual({
      id: "ABC123",
      url: "https://www.instagram.com/p/ABC123/",
      publishedAt: "2026-09-22T18:00:00.000Z",
      fetchedWith: "browser",
    });
  });

  it("refuses a post with no media, before calling anything", async () => {
    const { sites, calls } = fakeSites({});
    await expect(instagramWebContent(sites).publish({ text: "hi" })).rejects.toThrow(
      /image or a video/,
    );
    expect(calls).toEqual([]);
  });

  it("says plainly that reading back wants the API", async () => {
    const { sites } = fakeSites({});
    const c = instagramWebContent(sites);
    await expect(c.list()).rejects.toThrow(/needs the API/);
    await expect(c.metrics("x")).rejects.toThrow(/needs the API/);
    await expect(c.comments("x")).rejects.toThrow(/needs the API/);
  });
});
