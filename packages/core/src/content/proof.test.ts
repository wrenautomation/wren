import { describe, expect, it } from "vitest";
import type { SiteClient } from "./autobrowse.js";
import {
  holds,
  idsIn,
  linkedinVerdict,
  modNoteIn,
  redditPermalink,
  redditVerdict,
  siteProof,
} from "./proof.js";

const NOW = new Date("2026-10-14T12:00:00Z");
const thing = (body: string, author = "someone") => ({
  name: "t1_c1",
  body,
  author,
  permalink: "/r/example/comments/p1/a_title/c1/",
  link_id: "t3_p1",
});
const listing = (...things: object[]) => ({
  data: { children: things.map((data) => ({ kind: "t1", data })) },
});

/** A desk that answers by `site METHOD path[@account]`, and logs every call. */
function desk(answers: Record<string, unknown>): SiteClient & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async call<T>(site: string, method: string, path: string, _i?: unknown, account?: string) {
      const key = `${site} ${method} ${path}${account ? `@${account}` : ""}`;
      log.push(key);
      if (!(key in answers)) throw new Error(`no answer for ${key}`);
      const a = answers[key];
      if (a instanceof Error) throw a;
      return a as T;
    },
    via: async () => "browser",
  };
}

describe("reddit verdict", () => {
  it("is live when a stranger reads it and the thread has it", () => {
    expect(redditVerdict({ open: thing("hi"), inThread: true })).toEqual({
      state: "live",
      note: null,
    });
    expect(redditVerdict({ open: thing("hi"), inThread: null }).state).toBe("live");
  });

  it("is hidden when only its author reads it", () => {
    const v = redditVerdict({ open: thing("[deleted]", ""), inThread: null, own: thing("hi") });
    expect(v.state).toBe("hidden");
    expect(v.note).toContain("[deleted] for strangers");
  });

  it("is missing when its author sees the tombstone too", () => {
    const v = redditVerdict({ open: null, inThread: null, own: thing("[removed]") });
    expect(v).toEqual({ state: "missing", note: "[removed] to its author" });
  });

  it("waits when no account can look", () => {
    expect(redditVerdict({ open: null, inThread: null }).state).toBe("pending");
  });

  it("finds ids in a nested tree and says when it is cut", () => {
    const tree = {
      data: {
        children: [
          { kind: "t1", data: { name: "t1_a", replies: listing({ name: "t1_b" }) } },
          { kind: "more", data: { children: ["c"] } },
        ],
      },
    };
    const r = idsIn(tree);
    expect([...r.ids]).toEqual(["t1_a", "t1_b"]);
    expect(r.partial).toBe(true);
  });

  it("builds a permalink without the thing", () => {
    expect(
      redditPermalink({ platform: "reddit", ref: "t1_c1", parent: "t3_p1", url: null }, null),
    ).toBe("https://www.reddit.com/comments/p1/comment/c1/");
  });
});

describe("a moderator's note under our comment", () => {
  const ours = {
    ...thing("[removed]"),
    replies: listing({
      name: "t1_m1",
      author: "AutoModerator",
      body: "Your comment was removed. Accounts must be 10+ days old\nwith 50+ karma.",
      parent_id: "t1_c1",
    }),
  };

  it("reads AutoModerator's reply to our comment", () => {
    expect(modNoteIn(listing(ours), "t1_c1")).toBe(
      'AutoModerator: "Your comment was removed. Accounts must be 10+ days old with 50+ karma."',
    );
  });

  it("reads a distinguished moderator, and ignores replies to other comments", () => {
    const mod = listing({
      ...thing("[removed]"),
      replies: listing({
        name: "t1_m2",
        author: "jane",
        distinguished: "moderator",
        body: "Rule 3.",
      }),
    });
    expect(modNoteIn(mod, "t1_c1")).toBe('mod jane: "Rule 3."');
    expect(modNoteIn(mod, "t1_other")).toBeNull();
    expect(modNoteIn(listing(thing("hi")), "t1_c1")).toBeNull();
  });
});

describe("linkedin verdict", () => {
  it("matches by the first words, whatever the spacing and quotes", () => {
    expect(
      holds(
        "A post\n\nRegional  roles sell the ’lifestyle’, not salary",
        "Regional roles sell the 'lifestyle', not salary",
      ),
    ).toBe(true);
    expect(holds("nothing here", "Regional roles sell the lifestyle")).toBe(false);
    expect(holds("ok", "ok")).toBe(false);
  });

  it("is live when its author's read finds it, whatever the public page shows", () => {
    expect(linkedinVerdict(true, true).state).toBe("live");
    expect(linkedinVerdict(false, true).state).toBe("live");
    expect(linkedinVerdict(true, false).state).toBe("missing");
    expect(linkedinVerdict(true, null).state).toBe("pending");
  });
});

describe("siteProof", () => {
  const jpeg = Buffer.from("jpeg").toString("base64");

  it("reads reddit signed out, then the thread, and keeps the shot", async () => {
    const d = desk({
      "reddit-public GET /api/info": listing(thing("hi")),
      "reddit-public GET /comments/p1": [listing(), listing(thing("hi"))],
      "web GET /proof/shot": { found: true, jpeg },
    });
    const kept: number[] = [];
    const proof = siteProof({
      sites: d,
      now: () => NOW,
      keep: async (b) => {
        kept.push(b.length);
        return "s3://bucket/media/x.jpg";
      },
    });
    const p = await proof.check({
      platform: "reddit",
      ref: "t1_c1",
      parent: "t3_p1",
      url: null,
      account: "reddit@one",
    });
    expect(p).toEqual({
      state: "live",
      checkedAt: NOW.toISOString(),
      url: "https://www.reddit.com/r/example/comments/p1/a_title/c1/",
      shot: "s3://bucket/media/x.jpg",
      note: null,
    });
    expect(kept).toEqual([4]);
    expect(d.log).not.toContain("reddit GET /api/info@reddit@one");
  });

  it("reads as another account of ours before the refused signed-out reader", async () => {
    const d = desk({
      "reddit-public GET /api/info": new Error("HTTP 403 (feed after a 403)"),
      "reddit GET /api/info@reddit@two": listing(thing("hi")),
      "reddit GET /comments/p1@reddit@two": [listing(), listing(thing("hi"))],
      "web GET /proof/shot": { found: true, jpeg },
    });
    const p = await siteProof({ sites: d, now: () => NOW, keep: async () => "s3://b/k" }).check({
      platform: "reddit",
      ref: "t1_c1",
      parent: "t3_p1",
      url: null,
      account: "reddit@one",
      peers: ["reddit@one", "reddit@two"],
    });
    expect(p.state).toBe("live");
    expect(p.note).toContain("read as another account of ours");
    expect(d.log).not.toContain("reddit GET /api/info@reddit@one");
    expect(d.log).not.toContain("reddit-public GET /api/info");
    // No peer: the signed-out read, and the check waits when it fails.
    const alone = await siteProof({ sites: d, now: () => NOW }).check({
      platform: "reddit",
      ref: "t1_c1",
      parent: "t3_p1",
      url: null,
      account: "reddit@one",
    });
    expect(alone.state).toBe("pending");
    expect(alone.note).toContain("the public read failed");
  });

  it("asks the account when strangers see a tombstone", async () => {
    const d = desk({
      "reddit-public GET /api/info": listing(thing("[deleted]", "")),
      "reddit GET /api/info@reddit@one": listing(thing("hi")),
      "web GET /proof/shot": new Error("desk down"),
    });
    const p = await siteProof({ sites: d, now: () => NOW, keep: async () => "s3://b/k" }).check({
      platform: "reddit",
      ref: "t1_c1",
      parent: "t3_p1",
      url: null,
      account: "reddit@one",
    });
    expect(p.state).toBe("hidden");
    expect(p.shot).toBeNull();
    expect(p.note).toContain("no shot: desk down");
  });

  it("keeps the moderator's reason in a removal's note", async () => {
    const d = desk({
      "reddit-public GET /api/info": listing(thing("[removed]", "")),
      "reddit GET /api/info@reddit@one": listing(thing("hi")),
      "reddit-public GET /comments/p1": [
        listing(),
        listing({
          ...thing("[removed]", ""),
          replies: listing({
            name: "t1_m1",
            author: "AutoModerator",
            body: "Needs 50 karma.",
          }),
        }),
      ],
      "web GET /proof/shot": new Error("desk down"),
    });
    const p = await siteProof({ sites: d, now: () => NOW, keep: async () => "s3://b/k" }).check({
      platform: "reddit",
      ref: "t1_c1",
      parent: "t3_p1",
      url: null,
      account: "reddit@one",
    });
    expect(p.state).toBe("hidden");
    expect(p.note).toContain('AutoModerator: "Needs 50 karma."');
  });

  it("reads linkedin's public page, then the account's comments", async () => {
    const d = desk({
      "web GET /read": { text: "someone else's words" },
      "web GET /proof/shot": { found: false, jpeg },
      "linkedin GET /rest/socialActions/urn%3Ali%3Aactivity%3A1/comments@linkedin@one": {
        elements: [{ message: { text: "Our words about hiring in the region" } }],
      },
    });
    const p = await siteProof({ sites: d, now: () => NOW, linkedinAccount: "linkedin@one" }).check({
      platform: "linkedin",
      ref: null,
      parent: "urn:li:activity:1",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
      text: "Our words about hiring in the region",
    });
    expect(p.state).toBe("live");
    expect(p.shot).toBeNull();
  });

  it("leaves platforms with no reader pending", async () => {
    const p = await siteProof({ sites: desk({}), now: () => NOW }).check({
      platform: "x",
      ref: "1",
      parent: "2",
      url: null,
    });
    expect(p).toMatchObject({ state: "pending", note: "no reader for x yet" });
  });
});
