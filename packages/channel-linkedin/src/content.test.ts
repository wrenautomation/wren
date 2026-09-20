import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { linkedinContent } from "./content.js";

function fakeSites(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(site, method, path, input) {
      expect(site).toBe("linkedin");
      calls.push([method, path, input]);
      const key = `${method} ${decodeURIComponent(path.split("?")[0] ?? "")}`;
      const a = answers[key];
      if (!a) throw new Error(`no fake for ${key}`);
      return a(input) as never;
    },
    async via(_site, method, path) {
      return method === "GET" && path.startsWith("/rest/socialActions") ? "browser" : "api";
    },
  };
  return { sites, calls };
}

describe("linkedin content channel", () => {
  it("publishes as the member (author from userinfo once), lists, counts, comments, replies", async () => {
    const { sites, calls } = fakeSites({
      "GET /v2/userinfo": () => ({ sub: "abc" }),
      "POST /rest/posts": (i) => {
        expect(i).toMatchObject({
          author: "urn:li:person:abc",
          commentary: "hello",
          visibility: "PUBLIC",
        });
        return { id: "urn:li:share:1" };
      },
      "GET /rest/posts": (i) => {
        expect(i).toMatchObject({ q: "author", author: "urn:li:person:abc", count: 2 });
        return {
          elements: [
            { id: "urn:li:share:1", commentary: "hello", publishedAt: Date.UTC(2026, 8, 21) },
            {
              id: "urn:li:share:2",
              commentary: "x".repeat(300),
              publishedAt: Date.UTC(2026, 8, 22),
            },
          ],
        };
      },
      "GET /rest/socialActions/urn:li:share:1": () => ({
        likesSummary: { totalLikes: 4 },
        commentsSummary: { totalFirstLevelComments: 1 },
      }),
      "GET /rest/socialActions/urn:li:share:1/comments": () => ({
        elements: [
          {
            id: "urn:li:comment:9",
            actor: "urn:li:person:z",
            message: { text: "nice" },
            created: { time: 1 },
          },
        ],
      }),
      "POST /rest/socialActions/urn:li:comment:9/comments": (i) => {
        expect(i).toEqual({ actor: "urn:li:person:abc", message: { text: "thanks" } });
        return {};
      },
    });
    const ch = linkedinContent(sites, { now: () => new Date(Date.UTC(2026, 8, 23)) });
    const p = await ch.publish({ text: "hello" });
    expect(p).toEqual({
      id: "urn:li:share:1",
      url: "https://www.linkedin.com/feed/update/urn:li:share:1/",
      publishedAt: "2026-09-23T00:00:00.000Z",
      fetchedWith: "api",
    });
    const rows = await ch.list({ limit: 2 });
    expect(rows.map((r) => r.id)).toEqual(["urn:li:share:2", "urn:li:share:1"]);
    expect(rows[0]?.preview).toHaveLength(120);
    expect(await ch.metrics("urn:li:share:1")).toMatchObject({
      reactions: 4,
      comments: 1,
      fetchedWith: "browser",
    });
    const cs = await ch.comments("urn:li:share:1");
    expect(cs).toEqual([
      {
        id: "urn:li:comment:9",
        postId: "urn:li:share:1",
        author: "urn:li:person:z",
        text: "nice",
        at: "1970-01-01T00:00:00.001Z",
      },
    ]);
    await ch.reply?.("urn:li:comment:9", "thanks");
    expect(calls.filter(([, p]) => p === "/v2/userinfo")).toHaveLength(1);
  });

  it("refuses media that is not an uploaded URN", async () => {
    const { sites } = fakeSites({});
    const ch = linkedinContent(sites, { author: "urn:li:person:abc" });
    await expect(
      ch.publish({ text: "x", media: { kind: "image", source: "/tmp/a.png" } }),
    ).rejects.toThrow(/uploaded urn:li:image/);
  });
});
