import { SiteCallError, type SiteClient } from "@wren/core/content";
import { slidesKey } from "@wren/core/content/slides";
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

  it("refuses a local file with no host, and a video upload, before anything sends", async () => {
    const { sites, calls } = fakeSites({});
    const ch = linkedinContent(sites, { author: "urn:li:person:abc" });
    await expect(
      ch.publish({ text: "x", media: { kind: "image", source: "/tmp/a.png" } }),
    ).rejects.toThrow(/media host/);
    await expect(
      ch.publish({ text: "x", media: { kind: "video", source: "s3://m/v.mp4" } }),
    ).rejects.toThrow(/video upload is in development/);
    expect(calls).toEqual([]);
  });

  it("uploads an image, then posts it by URN", async () => {
    const host = { host: async (p: string) => `https://cdn.test/${p.split("/").pop()}` };
    const { sites } = fakeSites({
      "POST /upload": (i) => {
        expect(i).toEqual({
          kind: "image",
          owner: "urn:li:person:abc",
          file: "https://cdn.test/a.jpg",
        });
        return { urn: "urn:li:image:1" };
      },
      "POST /rest/posts": (i) => {
        expect(i?.content).toEqual({ media: { id: "urn:li:image:1" } });
        return { id: "urn:li:share:2" };
      },
    });
    const ch = linkedinContent(sites, { author: "urn:li:person:abc", host });
    await ch.publish({ text: "x", media: { kind: "image", source: "s3://m/a.jpg" } });
  });

  it("posts the field's PDF as a document, titled by the text's first line", async () => {
    const host = { host: async (p: string) => `https://cdn.test/${p.split("/").pop()}` };
    const { sites } = fakeSites({
      "POST /upload": (i) => {
        expect(i).toMatchObject({ kind: "document", file: "https://cdn.test/a.pdf" });
        return { urn: "urn:li:document:4" };
      },
      "POST /rest/posts": (i) => {
        expect(i?.content).toEqual({ media: { id: "urn:li:document:4", title: "The guide" } });
        return { id: "urn:li:share:5" };
      },
    });
    const ch = linkedinContent(sites, { author: "urn:li:person:abc", host });
    await ch.publish({ text: "The guide\nmore", extra: { attachment: "s3://m/a.pdf" } });
  });

  it("posts a carousel as a document: the drawn PDF, titled by its first slide", async () => {
    const host = { host: async (p: string) => `https://cdn.test/${p.split("/").pop()}` };
    const slides = Array.from({ length: 5 }, (_, i) => ({ title: `Slide ${i + 1}`, lines: [] }));
    const extra = {
      kind: "document",
      slides,
      rendered: { images: [], pdf: "s3://m/deck.pdf", of: slidesKey(slides), at: "x" },
    };
    const { sites } = fakeSites({
      "POST /upload": (i) => {
        expect(i).toMatchObject({ kind: "document", file: "https://cdn.test/deck.pdf" });
        return { urn: "urn:li:document:9" };
      },
      "POST /rest/posts": (i) => {
        expect(i?.content).toEqual({ media: { id: "urn:li:document:9", title: "Slide 1" } });
        return { id: "urn:li:share:3" };
      },
    });
    const ch = linkedinContent(sites, { organization: "urn:li:organization:5", host });
    expect((await ch.publish({ text: "slides", extra })).id).toBe("urn:li:share:3");
  });

  it("activity maps notification kinds, drops views and news, since filters, a capped day reads nothing", async () => {
    const n = (id: string, kind: string, at?: string) => ({
      id,
      kind,
      actor: "Test Person",
      actorUrl: "https://www.linkedin.com/in/test-person/",
      text: `Test Person ${kind} line`,
      url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
      ...(at ? { at, approx: true } : {}),
      raw: { text: "synthetic", links: [], bold: ["Test Person"] },
    });
    const page = [
      n("h1", "mention", "2026-10-06T10:00:00.000Z"),
      n("h2", "view", "2026-10-06T09:00:00.000Z"),
      n("h3", "follow", "2026-10-05T00:00:00.000Z"),
      n("h4", "comment"),
      n("h5", "other", "2026-10-04T00:00:00.000Z"),
      n("h6", "reaction", "2026-09-01T00:00:00.000Z"),
    ];
    const { sites, calls } = fakeSites({
      "GET /notifications": (i) => {
        expect(i).toEqual({ max: 40 });
        return { notifications: page };
      },
    });
    const ch = linkedinContent(sites, { author: "urn:li:person:abc" });
    const rows = await ch.activity?.({ since: "2026-10-01T00:00:00Z" });
    expect(rows?.map((r) => [r.id, r.kind, r.at])).toEqual([
      ["h1", "mention", "2026-10-06T10:00:00.000Z"],
      ["h3", "follow", "2026-10-05T00:00:00.000Z"],
      ["h4", "notification", null],
    ]);
    expect(rows?.[0]).toEqual({
      id: "h1",
      kind: "mention",
      actor: "Test Person",
      actorUrl: "https://www.linkedin.com/in/test-person/",
      text: "Test Person mention line",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
      at: "2026-10-06T10:00:00.000Z",
      raw: page[0],
    });
    expect((await ch.activity?.())?.map((r) => r.id)).toEqual(["h1", "h3", "h4", "h6"]);
    expect(calls).toHaveLength(2);

    const capped = linkedinContent(
      {
        async call() {
          throw new SiteCallError("linkedin", "GET", "/notifications", 429, "notifications cap");
        },
        async via() {
          return "browser";
        },
      },
      { author: "urn:li:person:abc" },
    );
    expect(await capped.activity?.()).toEqual([]);
    const broken = linkedinContent(
      {
        async call() {
          throw new SiteCallError("linkedin", "GET", "/notifications", 500, "boom");
        },
        async via() {
          return "browser";
        },
      },
      { author: "urn:li:person:abc" },
    );
    await expect(broken.activity?.()).rejects.toThrow(/500/);
  });

  it("audience reads Wren's own account only, the whole answer kept", async () => {
    const answer = { followers: 57, connections: { n: 48, label: "48" }, page: { followers: 9 } };
    const accounts: Array<string | undefined> = [];
    const ch = linkedinContent(
      {
        async call(_site, method, path, input, account) {
          expect([method, path, input]).toEqual(["GET", "/audience", {}]);
          accounts.push(account);
          return answer as never;
        },
        async via() {
          return "browser";
        },
      },
      { author: "urn:li:person:abc", now: () => new Date("2026-10-06T12:00:00.000Z") },
    );
    expect(await ch.audience?.()).toEqual({
      followers: 57,
      asOf: "2026-10-06T12:00:00.000Z",
      raw: answer,
    });
    expect(accounts).toEqual(["linkedin@wren"]);
  });

  it("insights read the post's analytics page as Wren, on its analytics days only", async () => {
    const page = {
      urn: "urn:li:share:7",
      impressions: 1204,
      reached: 800,
      reactions: 12,
      comments: 3,
      reposts: 1,
      saves: null,
      sends: 2,
      profileViewers: 9,
      followersGained: 1,
    };
    const calls: Array<[string, string | undefined]> = [];
    const sites: SiteClient = {
      async call(_site, _method, path, _input, account) {
        calls.push([path, account]);
        return page as never;
      },
      async via() {
        return "browser";
      },
    };
    const at = (iso: string) => linkedinContent(sites, { author: "a", now: () => new Date(iso) });
    const published = "2026-10-01T10:00:00.000Z";
    const off = await at("2026-10-03T12:00:00.000Z").insights?.({
      id: "urn:li:share:7",
      published,
    });
    expect(off).toMatchObject({ values: [], gaps: [] });
    expect(calls).toEqual([]);
    const got = await at("2026-10-02T12:00:00.000Z").insights?.({
      id: "urn:li:share:7",
      published,
    });
    expect(calls).toEqual([["/analytics/post-summary/urn%3Ali%3Ashare%3A7", "linkedin@wren"]]);
    const of = (m: string) => got?.values.find((v) => v.metric === m)?.value;
    expect([of("impressions"), of("reach"), of("likes"), of("shares"), of("sends")]).toEqual([
      1204, 800, 12, 1, 2,
    ]);
    expect(of("profile_visits")).toBe(9);
    expect(of("saves")).toBeUndefined();
    expect(got?.gaps).toEqual([]);
  });

  it("insights: a capped day reads nothing; a route the box lacks is a gap", async () => {
    const failing = (err: Error): SiteClient => ({
      async call() {
        throw err;
      },
      async via() {
        return "browser";
      },
    });
    const q = { id: "urn:li:share:7", published: "2026-10-01T10:00:00.000Z" };
    const now = () => new Date("2026-10-02T12:00:00.000Z");
    const capped = await linkedinContent(
      failing(new SiteCallError("linkedin", "GET", "/analytics", 429, "cap")),
      { author: "a", now },
    ).insights?.(q);
    expect(capped).toMatchObject({ values: [], gaps: [] });
    const missing = await linkedinContent(
      failing(new SiteCallError("linkedin", "GET", "/analytics", 404, "no route")),
      { author: "a", now },
    ).insights?.(q);
    expect(missing?.gaps.find((g) => g.metric === "impressions")?.state).toBe("not_built");
  });
});

describe("linkedin company page", () => {
  const ORG = "urn:li:organization:5";
  const COMMENT = "urn:li:comment:(urn:li:share:1,77)";

  it("posts, reads and answers as the page, and counts its followers", async () => {
    const { sites, calls } = fakeSites({
      "POST /rest/posts": (i) => {
        expect(i).toMatchObject({ author: ORG });
        return { id: "urn:li:share:1" };
      },
      "GET /rest/socialActions/urn:li:share:1/comments": () => ({
        elements: [
          { id: "77", commentUrn: COMMENT, actor: "urn:li:person:p1", message: { text: "Nice" } },
          {
            id: "78",
            commentUrn: "urn:li:comment:(urn:li:share:1,78)",
            actor: ORG,
            parentComment: COMMENT,
            message: { text: "Thanks" },
          },
        ],
      }),
      [`POST /rest/socialActions/${COMMENT}/comments`]: (i) => {
        expect(i).toMatchObject({
          actor: ORG,
          object: "urn:li:share:1",
          parentComment: COMMENT,
          message: { text: "Thank you" },
        });
        return {};
      },
      [`GET /rest/networkSizes/${ORG}`]: (i) => {
        expect(i).toEqual({ edgeType: "COMPANY_FOLLOWED_BY_MEMBER" });
        return { firstDegreeSize: 412 };
      },
    });
    const ch = linkedinContent(sites, { organization: ORG });
    await ch.publish({ text: "hello" });
    const rows = await ch.comments("urn:li:share:1");
    expect(rows.map((r) => [r.id, r.parentId ?? null, r.mine ?? false])).toEqual([
      [COMMENT, null, false],
      ["urn:li:comment:(urn:li:share:1,78)", COMMENT, true],
    ]);
    await ch.reply?.(COMMENT, "Thank you");
    expect((await ch.audience?.())?.followers).toBe(412);
    expect(ch.activity).toBeUndefined();
    expect(calls.some(([, p]) => p.includes("userinfo"))).toBe(false);
  });

  it("a connected profile has no browser reads", async () => {
    const { sites, calls } = fakeSites({});
    const ch = linkedinContent(sites, { author: "urn:li:person:abc", direct: true });
    expect(ch.audience).toBeUndefined();
    expect(ch.activity).toBeUndefined();
    const i = await ch.insights?.({ id: "urn:li:share:1", published: new Date().toISOString() });
    expect(i?.gaps[0]?.state).toBe("needs_william");
    expect(calls).toHaveLength(0);
  });
});
