import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { postOf, redditOutreach } from "./outreach.js";

function fakeSites(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(_site, method, path, input) {
      calls.push([method, path, input]);
      const a = answers[`${method} ${path}`];
      if (!a) throw new Error(`no fake for ${method} ${path}`);
      return a(input) as never;
    },
    async via() {
      return "browser";
    },
  };
  return { sites, calls };
}

const listing = (rows: Array<[string, Record<string, unknown>]>) => ({
  kind: "Listing",
  data: { children: rows.map(([kind, data]) => ({ kind, data })) },
});

describe("reddit outreach inbox", () => {
  const now = () => new Date("2026-10-05T10:00:00Z");

  it("one inbox read serves DMs and comments; Reddit's own notices are skipped", async () => {
    const { sites, calls } = fakeSites({
      "GET /api/v1/me": () => ({ name: "WrenAutomation" }),
      "GET /message/inbox": () =>
        listing([
          ["t4", { id: "m1", name: "t4_m1", author: "dana", subject: "hey", body: "the doc?" }],
          ["t4", { id: "m2", name: "t4_m2", author: "reddit", body: "Welcome" }],
          [
            "t1",
            {
              id: "c1",
              name: "t1_c1",
              author: "lee",
              body: "dm me",
              was_comment: true,
              type: "post_reply",
              parent_id: "t3_p1",
              subreddit: "smallbusiness",
              link_title: "Invoices",
              context: "/r/smallbusiness/comments/p1/invoices/c1/?context=3",
              created_utc: 1_790_000_000,
            },
          ],
        ]),
    });
    const ch = redditOutreach(sites, { account: "reddit@wren", now });
    const replies = await ch.replies(null);
    const comments = (await ch.comments?.()) ?? [];
    expect(replies.map((r) => r.handle)).toEqual(["dana"]);
    expect(comments).toMatchObject([
      {
        ref: "t1_c1",
        post: "t3_p1",
        parent: "t3_p1",
        kind: "post_reply",
        place: "smallbusiness",
        handle: "lee",
        url: "https://www.reddit.com/r/smallbusiness/comments/p1/invoices/c1/?context=3",
      },
    ]);
    expect(calls.filter(([, p]) => p === "/message/inbox")).toEqual([
      ["GET", "/message/inbox", { limit: 100, raw_json: 1 }],
    ]);
  });

  it("answers under a comment and lists every author in a thread", async () => {
    const { sites } = fakeSites({
      "POST /api/comment": (input) => {
        expect(input).toMatchObject({ thing_id: "t1_c1", text: "Sent!" });
        return { json: { errors: [], data: { things: [{ data: { name: "t1_ours" } }] } } };
      },
      "GET /comments/p1": () => [
        listing([["t3", { id: "p1", name: "t3_p1", author: "WrenAutomation" }]]),
        listing([
          [
            "t1",
            {
              id: "c1",
              author: "lee",
              replies: listing([["t1", { id: "c2", author: "Ok_Crow" }]]),
            },
          ],
          ["t1", { id: "c3", author: "lee", replies: "" }],
        ]),
      ],
    });
    const ch = redditOutreach(sites, { account: "reddit@wren", now });
    expect(await ch.comment?.("t1_c1", "Sent!")).toMatchObject({
      ref: "t1_ours",
      fetchedWith: "browser",
    });
    expect(await ch.threadAuthors?.("t3_p1")).toEqual(["WrenAutomation", "lee", "Ok_Crow"]);
  });

  it("reads the post from a comment's context", () => {
    expect(postOf("/r/x/comments/abc12/title/def/?context=3")).toBe("t3_abc12");
    expect(postOf(undefined)).toBeNull();
  });
});
