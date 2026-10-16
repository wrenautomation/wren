import { SiteCallError, type SiteClient } from "@wren/core/content";
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

describe("reddit outreach enrich", () => {
  const now = () => new Date("2026-10-15T10:00:00Z");
  const post = {
    id: "p1",
    name: "t3_p1",
    title: "Invoices",
    selftext: "all day",
    subreddit: "smb",
  };
  const note = { id: "c1", name: "t1_c1", body: "same", subreddit: "smb", link_title: "Late pay" };
  const card = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    created_utc: 1_700_000_000,
    link_karma: 5,
    comment_karma: 7,
    ...extra,
  });
  /** Answers by path; `calls` is every read in order. */
  function reddit(answer: (path: string, input?: Record<string, unknown>) => unknown) {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const sites: SiteClient = {
      async call(_site, _method, path, input) {
        calls.push([path, input]);
        return answer(path, input) as never;
      },
      async via() {
        return "browser";
      },
    };
    return { sites, calls, count: (path: string) => calls.filter(([p]) => p === path).length };
  }
  const overview = () =>
    listing([
      ["t3", { ...post, created_utc: 1_790_000_100 }],
      ["t1", { ...note, created_utc: 1_790_000_200 }],
    ]);
  const authors = (rows: Array<[string, string | undefined]>) =>
    listing(
      rows.map(([author, id], i) => [
        "t3",
        {
          id: `x${i}`,
          name: `t3_x${i}`,
          author,
          subreddit: "smb",
          ...(id ? { author_fullname: id } : {}),
        },
      ]),
    );

  it("reads a person's posts and comments in one overview, and the card", async () => {
    const { sites, calls } = reddit((path) =>
      path === "/user/ann/overview" ? overview() : card("ann"),
    );
    const p = await redditOutreach(sites, { account: "reddit-public", now }).enrich("ann");
    expect(calls).toEqual([
      ["/user/ann/about", { raw_json: 1 }],
      ["/user/ann/overview", { limit: 20, sort: "new", raw_json: 1 }],
    ]);
    // Newest first, each as it was before: a post by its title and body, a comment by its words.
    expect(p.recent.map((r) => [r.where, r.text])).toEqual([
      ["r/smb · Late pay", "same"],
      ["r/smb", "Invoices\nall day"],
    ]);
    expect(p.raw).toEqual({ about: card("ann") });
  });

  it("find remembers who wrote what: the first card read takes everyone's in one read", async () => {
    const { sites, calls, count } = reddit((path, input) => {
      if (path === "/r/smb/new")
        return authors([
          ["ann", "t2_ann1"],
          ["bob", "t2_bob2"],
          ["bob", "t2_bob2"],
          ["AutoModerator", "t2_mod"],
          ["cyd", undefined],
        ]);
      if (path === "/api/user_data_by_account_ids") {
        expect(input?.ids).toBe("t2_ann1,t2_bob2");
        return { t2_ann1: card("ann"), t2_bob2: card("bob") };
      }
      if (path.endsWith("/overview")) return overview();
      return card("cyd");
    });
    const ch = redditOutreach(sites, { account: "reddit-public", now });
    await ch.find({ query: "r/smb", limit: 25 });
    const ann = await ch.enrich("ann");
    const bob = await ch.enrich("bob");
    expect(ann.raw).toMatchObject({ about: { name: "ann", id: "ann1", link_karma: 5 } });
    expect(bob.raw).toMatchObject({ about: { name: "bob", id: "bob2" } });
    expect(count("/api/user_data_by_account_ids")).toBe(1);
    // cyd's id was not shown: the old card read.
    await ch.enrich("cyd");
    expect(count("/user/cyd/about")).toBe(1);
    expect(count("/user/ann/about") + count("/user/bob/about")).toBe(0);
    expect(calls.filter(([p]) => p.endsWith("/overview"))).toHaveLength(3);
  });

  it("takes at most 100 cards a read, the one asked for first", async () => {
    const { sites, calls } = reddit((path, input) => {
      if (path === "/api/user_data_by_account_ids")
        return Object.fromEntries(
          String(input?.ids)
            .split(",")
            .map((id) => [id, card(id)]),
        );
      return overview();
    });
    const ch = redditOutreach(sites, { account: "reddit-public", now });
    ch.learn(Array.from({ length: 150 }, (_, i) => ({ handle: `user${i}`, id: `t2_u${i}` })));
    await ch.enrich("user120");
    const ids = String(calls.find(([p]) => p === "/api/user_data_by_account_ids")?.[1]?.ids);
    expect(ids.split(",")).toHaveLength(100);
    expect(ids.startsWith("t2_u120,t2_u0,")).toBe(true);
  });

  it("learn ignores AutoModerator, empty handles and ids that are not accounts", async () => {
    const { sites, count } = reddit((path) =>
      path.endsWith("/overview") ? overview() : card("ann"),
    );
    const ch = redditOutreach(sites, { account: "reddit-public", now });
    ch.learn([
      { handle: "ann", id: "t3_post" },
      { handle: "AutoModerator", id: "t2_mod" },
      { handle: null, id: "t2_x" },
      { handle: "ann", id: null },
    ]);
    await ch.enrich("ann");
    expect(count("/api/user_data_by_account_ids")).toBe(0);
    expect(count("/user/ann/about")).toBe(1);
  });

  it("a person the batch leaves out (suspended, deleted) is read with about", async () => {
    const { sites, count } = reddit((path) => {
      if (path === "/api/user_data_by_account_ids") return { t2_ann1: card("ann") };
      if (path.endsWith("/overview")) return overview();
      return { data: card("bob", { is_suspended: true }) };
    });
    const ch = redditOutreach(sites, { account: "reddit-public", now });
    ch.learn([
      { handle: "ann", id: "t2_ann1" },
      { handle: "bob", id: "t2_bob2" },
    ]);
    await ch.enrich("ann");
    const bob = await ch.enrich("bob");
    expect(bob.raw).toMatchObject({ about: { name: "bob", is_suspended: true } });
    expect(count("/api/user_data_by_account_ids")).toBe(1);
    expect(count("/user/bob/about")).toBe(1);
  });

  it("a batch Reddit refuses is not asked again this run: about reads stand in", async () => {
    const { sites, count } = reddit((path) => {
      if (path === "/api/user_data_by_account_ids")
        throw new SiteCallError("reddit-public", "GET", path, 403, "closed");
      return path.endsWith("/overview") ? overview() : card("x");
    });
    const ch = redditOutreach(sites, { account: "reddit-public", now });
    ch.learn([
      { handle: "ann", id: "t2_ann1" },
      { handle: "bob", id: "t2_bob2" },
    ]);
    await ch.enrich("ann");
    await ch.enrich("bob");
    expect(count("/api/user_data_by_account_ids")).toBe(1);
    expect(count("/user/ann/about") + count("/user/bob/about")).toBe(2);
  });

  it("a spent cap is the caller's to see: nothing falls back to another read", async () => {
    const { sites, count } = reddit((path) => {
      if (path === "/api/user_data_by_account_ids")
        throw new SiteCallError("reddit-public", "GET", path, 429, "cap");
      return overview();
    });
    const ch = redditOutreach(sites, { account: "reddit-public", now });
    ch.learn([{ handle: "ann", id: "t2_ann1" }]);
    await expect(ch.enrich("ann")).rejects.toMatchObject({ status: 429 });
    expect(count("/user/ann/about")).toBe(0);
  });

  it("a card Reddit closes (403) leaves the person without one, and is not asked for again", async () => {
    const { sites, count } = reddit((path) => {
      if (path.endsWith("/about"))
        throw new SiteCallError("reddit-public", "GET", path, 500, "reddit read: HTTP 403");
      return overview();
    });
    const ch = redditOutreach(sites, { account: "reddit-public", now });
    const ann = await ch.enrich("ann");
    const bob = await ch.enrich("bob");
    expect(ann.raw).toEqual({ about: null });
    expect(ann.handle).toBe("ann");
    expect(ann.recent).toHaveLength(2);
    expect(bob.recent).toHaveLength(2);
    expect(count("/user/ann/about") + count("/user/bob/about")).toBe(1);
  });

  it("with cards off (signed out), no card is asked for: the person comes from the overview", async () => {
    const { sites, calls } = reddit(() => overview());
    const ch = redditOutreach(sites, { account: "reddit-public", now, cards: false });
    ch.learn([{ handle: "ann", id: "t2_ann" }]);
    const ann = await ch.enrich("ann");
    expect(ann.raw).toEqual({ about: null });
    expect(ann.recent).toHaveLength(2);
    expect(calls.map(([p]) => p)).toEqual(["/user/ann/overview"]);
  });

  it("any other failure of the card read is still a failure", async () => {
    const { sites } = reddit((path) => {
      if (path.endsWith("/about"))
        throw new SiteCallError("reddit-public", "GET", path, 500, "boom");
      return overview();
    });
    await expect(
      redditOutreach(sites, { account: "reddit-public", now }).enrich("ann"),
    ).rejects.toThrow(/boom/);
  });
});

describe("reddit findSent", () => {
  const now = () => new Date("2026-10-16T12:10:00Z");
  const since = "2026-10-16T12:00:00Z";
  const utc = (iso: string) => new Date(iso).getTime() / 1000;
  const me = { "GET /api/v1/me": () => ({ name: "OurAccount" }) };

  it("finds our comment under its parent in our newest comments", async () => {
    const { sites, calls } = fakeSites({
      ...me,
      "GET /user/OurAccount/comments": () =>
        listing([
          [
            "t1",
            {
              id: "c9",
              name: "t1_c9",
              parent_id: "t3_p1",
              body: "Tom &amp; Jerry, our words",
              permalink: "/r/x/comments/p1/t/c9/",
              created_utc: utc("2026-10-16T12:00:30Z"),
            },
          ],
        ]),
    });
    const ch = redditOutreach(sites, { account: "reddit@alt", now });
    expect(
      await ch.findSent?.({ kind: "comment", to: "p1", text: "Tom & Jerry, our words", since }),
    ).toEqual({
      kind: "found",
      ref: "t1_c9",
      at: "2026-10-16T12:00:30.000Z",
      url: "https://www.reddit.com/r/x/comments/p1/t/c9/",
    });
    expect(calls.at(-1)?.[2]).toMatchObject({ sort: "new" });
  });

  it("absent when the listing reaches back past the send; unclear when it does not", async () => {
    const full = Array.from({ length: 25 }, (_, i): [string, Record<string, unknown>] => [
      "t1",
      { id: `c${i}`, name: `t1_c${i}`, parent_id: "t3_other", body: "else", created_utc: 0 },
    ]);
    const old = full.map(([k, d]) => [k, { ...d, created_utc: utc("2026-10-15T00:00:00Z") }]);
    const fresh = full.map(([k, d]) => [k, { ...d, created_utc: utc("2026-10-16T12:01:00Z") }]);
    for (const [rows, kind] of [
      [old, "absent"],
      [fresh, "unclear"],
    ] as const) {
      const { sites } = fakeSites({
        ...me,
        "GET /user/OurAccount/comments": () =>
          listing(rows as Array<[string, Record<string, unknown>]>),
      });
      const ch = redditOutreach(sites, { account: "reddit@alt", now });
      expect(
        (await ch.findSent?.({ kind: "comment", to: "t3_p1", text: "ours", since }))?.kind,
      ).toBe(kind);
    }
  });

  it("finds a DM in our sent messages", async () => {
    const { sites } = fakeSites({
      ...me,
      "GET /message/sent": () =>
        listing([
          ["t4", { id: "m3", name: "t4_m3", dest: "Dana", body: "hi there", created_utc: 1 }],
        ]),
    });
    const ch = redditOutreach(sites, { account: "reddit@alt", now });
    expect(
      await ch.findSent?.({ kind: "message", to: "dana", text: "hi there", since }),
    ).toMatchObject({ kind: "found", ref: "t4_m3" });
  });
});
