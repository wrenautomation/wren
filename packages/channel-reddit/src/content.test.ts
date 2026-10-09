import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { redditContent } from "./content.js";

function fakeSites(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(site, method, path, input) {
      expect(site).toBe("reddit");
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

const listing = (kind: string, rows: Record<string, unknown>[]) => ({
  kind: "Listing",
  data: { children: rows.map((data) => ({ kind, data })) },
});

describe("reddit content channel", () => {
  const now = () => new Date("2026-09-26T10:00:00Z");

  it("submits a text post into the subreddit, lists, reads metrics, comments, replies", async () => {
    const { sites, calls } = fakeSites({
      "GET /api/v1/me": () => ({ name: "wren_hq" }),
      "POST /api/submit": () => ({
        json: {
          errors: [],
          data: {
            id: "abc",
            name: "t3_abc",
            url: "https://www.reddit.com/r/startups/comments/abc/x/",
          },
        },
      }),
      "GET /user/wren_hq/submitted": () =>
        listing("t3", [
          {
            id: "abc",
            name: "t3_abc",
            title: "how we",
            permalink: "/r/startups/comments/abc/x/",
            created_utc: 1790000000,
          },
        ]),
      "GET /api/info": (i) => {
        expect(i?.id).toBe("t3_abc");
        return listing("t3", [
          {
            id: "abc",
            name: "t3_abc",
            score: 42,
            num_comments: 7,
            num_crossposts: 1,
            view_count: null,
          },
        ]);
      },
      "GET /comments/abc": () => [
        listing("t3", [{ id: "abc", name: "t3_abc" }]),
        listing("t1", [
          { id: "c1", name: "t1_c1", author: "someone", body: "nice", created_utc: 1790000100 },
          { id: "more", name: "t1_more" },
        ]),
      ],
      "POST /api/comment": () => ({ json: { errors: [], data: { things: [] } } }),
    });
    const ch = redditContent(sites, { now });
    const out = await ch.publish({
      text: "body",
      extra: { subreddit: "r/startups", title: "how we" },
    });
    expect(out).toEqual({
      id: "abc",
      url: "https://www.reddit.com/r/startups/comments/abc/x/",
      publishedAt: "2026-09-26T10:00:00.000Z",
      fetchedWith: "api",
    });
    expect(calls[0]?.[2]).toMatchObject({
      sr: "startups",
      kind: "self",
      text: "body",
      title: "how we",
    });

    const rows = await ch.list();
    expect(rows[0]).toMatchObject({
      id: "abc",
      url: "https://www.reddit.com/r/startups/comments/abc/x/",
      preview: "how we",
    });
    expect(await ch.metrics("abc")).toMatchObject({
      views: 0,
      reactions: 42,
      comments: 7,
      shares: 1,
    });
    const comments = await ch.comments("t3_abc");
    expect(comments).toEqual([
      { id: "c1", postId: "abc", author: "someone", text: "nice", at: "2026-09-21T14:15:00.000Z" },
    ]);
    await ch.reply?.("c1", "thanks");
    expect(calls.at(-1)?.[2]).toMatchObject({ thing_id: "t1_c1", text: "thanks" });
  });

  it("sends flair, NSFW and spoiler; a mark the page missed comes back as a note", async () => {
    const { sites, calls } = fakeSites({
      "POST /api/submit": () => ({
        json: {
          errors: [],
          data: { name: "t3_f1", notes: ["Posted, but couldn't set NSFW: set it on the post."] },
        },
      }),
    });
    const ch = redditContent(sites, { now });
    const out = await ch.publish({
      text: "body",
      extra: { subreddit: "sales", title: "t", flair: "Feedback", nsfw: true, spoiler: false },
    });
    expect(calls[0]?.[2]).toMatchObject({ flair_text: "Feedback", nsfw: true });
    expect(calls[0]?.[2]).not.toHaveProperty("spoiler");
    expect(out.notes).toEqual(["Posted, but couldn't set NSFW: set it on the post."]);
  });

  it("a link post, and refusals: no subreddit, media, Reddit's own error", async () => {
    const { sites, calls } = fakeSites({
      "POST /api/submit": (i) =>
        i?.sr === "banned"
          ? {
              json: {
                errors: [["SUBREDDIT_NOTALLOWED", "you aren't allowed to post there.", "sr"]],
              },
            }
          : { json: { errors: [], data: { name: "t3_l1" } } },
      "GET /api/v1/me": () => ({ name: "w" }),
    });
    const ch = redditContent(sites, { now });
    const out = await ch.publish({
      text: "",
      extra: { subreddit: "sales", title: "t", url: "https://wren.dev" },
    });
    expect(out.id).toBe("l1");
    expect(calls[0]?.[2]).toMatchObject({ kind: "link", url: "https://wren.dev" });
    await expect(ch.publish({ text: "x", extra: { title: "t" } })).rejects.toThrow(/subreddit/);
    await expect(
      ch.publish({
        text: "x",
        media: { kind: "image", source: "a.png" },
        extra: { subreddit: "sales", title: "t" },
      }),
    ).rejects.toThrow(/media/);
    await expect(
      ch.publish({ text: "x", extra: { subreddit: "banned", title: "t" } }),
    ).rejects.toThrow(/SUBREDDIT_NOTALLOWED/);
  });

  it("activity picks username mentions from the inbox newest first, since filters; audience is profile followers", async () => {
    const mention = (id: string, utc: number) => ({
      id,
      name: `t1_${id}`,
      type: "username_mention",
      author: "test_user",
      body: `hey u/wren_test ${id}\nsecond line`,
      context: `/r/testsub/comments/p1/title/${id}/?context=3`,
      created_utc: utc,
    });
    const inbox = listing("t1", [
      mention("m1", 1758000000),
      {
        id: "r1",
        type: "comment_reply",
        author: "other",
        body: "a reply",
        created_utc: 1759000000,
      },
      { id: "pm1", author: "other", body: "a private message", created_utc: 1759000000 },
      mention("m2", 1759000000),
    ]);
    const { sites, calls } = fakeSites({
      "GET /api/v1/me": () => ({ name: "wren_test" }),
      "GET /message/inbox": (i) => {
        expect(i).toEqual({ limit: 100 });
        return inbox;
      },
      "GET /user/wren_test/about": () => ({ name: "wren_test", followers: 7 }),
    });
    const ch = redditContent(sites, { now });
    expect(await ch.activity?.()).toEqual([
      {
        id: "m2",
        kind: "mention",
        actor: "test_user",
        actorUrl: "https://www.reddit.com/user/test_user/",
        text: "hey u/wren_test m2",
        url: "https://www.reddit.com/r/testsub/comments/p1/title/m2/?context=3",
        at: "2025-09-27T19:06:40.000Z",
        raw: mention("m2", 1759000000),
      },
      expect.objectContaining({ id: "m1", at: "2025-09-16T05:20:00.000Z" }),
    ]);
    expect((await ch.activity?.({ since: "2025-09-20T00:00:00Z" }))?.map((a) => a.id)).toEqual([
      "m2",
    ]);
    expect((await ch.activity?.({ limit: 1 }))?.map((a) => a.id)).toEqual(["m2"]);
    expect(await ch.audience?.()).toEqual({
      followers: 7,
      asOf: "2026-09-26T10:00:00.000Z",
      raw: { name: "wren_test", followers: 7 },
    });
    expect(calls.filter(([, p]) => p === "/api/v1/me")).toHaveLength(1);
  });

  it("audience refuses an account with no profile rather than report zero", async () => {
    const { sites } = fakeSites({
      "GET /api/v1/me": () => ({ name: "wren_test" }),
      "GET /user/wren_test/about": () => ({ kind: "t2", data: {} }),
    });
    await expect(redditContent(sites, { now }).audience?.()).rejects.toThrow(/no profile/);
  });
});
