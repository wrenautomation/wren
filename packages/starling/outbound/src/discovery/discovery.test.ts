import type { Profile } from "@wren/core/outreach";
import { FakeLlm } from "@wren/llm";
import { describe, expect, it } from "vitest";
import { personFacts, readWords } from "./people.js";
import { judgePlace, paceOf, WREN_AUDIENCE } from "./places.js";
import { reader, signedOut, subredditsIn } from "./reads.js";
import { dayStart, dropReason, factsFor, pitchIn, roomFor } from "./threads.js";

const NOW = new Date("2026-10-06T18:00:00Z");
const utc = (hoursAgo: number) => NOW.getTime() / 1000 - hoursAgo * 3600;

const profile = (recent: Profile["recent"]): Profile => ({
  handle: "Ok_Crow",
  url: "https://www.reddit.com/user/Ok_Crow",
  name: null,
  headline: null,
  foundIn: "enrich",
  about: null,
  current: null,
  company: null,
  location: null,
  recent,
  raw: { about: { created_utc: utc(24 * 400), total_karma: 812 } },
  fetchedAt: NOW.toISOString(),
  fetchedWith: "api",
});

const said = (where: string, text: string, at = "2026-10-05T15:10:00Z") => ({
  at,
  where,
  text,
  url: null,
});

describe("reddit discovery", () => {
  it("reads go to the signed-out site; other sites pass through", async () => {
    const calls: string[] = [];
    const sites = {
      call: async (site: string) => {
        calls.push(site);
        return {} as never;
      },
      via: async () => ({}) as never,
    };
    const out = signedOut(sites);
    await out.call("reddit", "GET", "/r/x/new", {});
    await out.call("linkedin", "GET", "/x", {});
    expect(calls).toEqual(["reddit-public", "linkedin"]);
  });

  it("Exa candidates: subreddit names from reddit.com result URLs, once each", async () => {
    expect(
      subredditsIn([
        "https://www.reddit.com/r/Agency/comments/abc/how_do_you_price/",
        "https://old.reddit.com/r/agency/comments/def/x/",
        "https://reddit.com/r/smallbusiness",
        "https://www.reddit.com/user/someone/",
        "https://example.test/r/notreddit/",
      ]),
    ).toEqual(["agency", "smallbusiness"]);
    const asked: unknown[] = [];
    const sites = {
      call: async (site: string, _m: string, path: string, input: unknown) => {
        asked.push([site, path, input]);
        return { hits: [{ url: "https://www.reddit.com/r/consulting/comments/x/y/" }] } as never;
      },
      via: async () => ({}) as never,
    };
    expect(await reader(sites).exaPlaces("client onboarding")).toEqual(["consulting"]);
    expect(asked).toEqual([
      ["web", "/search", { q: "site:reddit.com client onboarding", n: 10, via: "exa" }],
    ]);
    expect(WREN_AUDIENCE.exaSearches).toBe(3);
  });

  it("code drops what a comment can't help, $0", () => {
    const o = { now: NOW, ours: ["WrenAutomation"], judged: null };
    const post = { id: "a", name: "t3_a", created_utc: utc(2), num_comments: 3, author: "x" };
    expect(dropReason(post, o)).toBeNull();
    expect(dropReason({ ...post, created_utc: utc(25) }, o)).toBe("over a day old");
    expect(dropReason({ ...post, num_comments: 41 }, o)).toBe("past 40 comments");
    expect(dropReason({ ...post, stickied: true }, o)).toBe("pinned by the mods");
    expect(dropReason({ ...post, author: "wrenautomation" }, o)).toBe("one of ours wrote it");
    const judged = { mayComment: false } as Parameters<typeof dropReason>[1]["judged"];
    expect(dropReason(post, { ...o, judged })).toBe("the place's rules forbid our comments");
  });

  it("a karma place keeps only young threads with few comments", () => {
    const post = { id: "k", name: "t3_k", created_utc: utc(1), num_comments: 3, author: "asker" };
    const o = { now: NOW, ours: [], judged: null, purpose: "karma" as const };
    expect(dropReason(post, o)).toBeNull();
    expect(dropReason({ ...post, created_utc: utc(7) }, o)).toBe("too old to earn karma");
    expect(dropReason({ ...post, num_comments: 16 }, o)).toBe("past 15 comments");
    // A reach place keeps the day and the 40 comments.
    expect(
      dropReason({ ...post, created_utc: utc(7), num_comments: 16 }, { ...o, purpose: "reach" }),
    ).toBeNull();
  });

  it("the day's comments: reach places take at most their share, karma the rest", () => {
    const young = { comments: 5, reachComments: 2 };
    expect(roomFor("reach", young, { karma: 0, reach: 0 })).toBe(2);
    expect(roomFor("reach", young, { karma: 0, reach: 2 })).toBe(0);
    expect(roomFor("karma", young, { karma: 0, reach: 2 })).toBe(3);
    // Karma may take what reach leaves.
    expect(roomFor("karma", young, { karma: 0, reach: 0 })).toBe(5);
    // Karma using the day leaves reach none, though its share is unused.
    expect(roomFor("reach", young, { karma: 4, reach: 0 })).toBe(1);
    expect(roomFor("reach", young, { karma: 5, reach: 0 })).toBe(0);
    // A reach backlog past its share never takes karma's room.
    expect(roomFor("karma", young, { karma: 1, reach: 20 })).toBe(2);
    expect(roomFor("reach", young, { karma: 1, reach: 20 })).toBeLessThan(0);
    // Past 50 karma the share is the whole day.
    expect(roomFor("reach", { comments: 6, reachComments: 6 }, { karma: 1, reach: 2 })).toBe(3);
  });

  it("a karma comment carries no Wren, link or DM me", () => {
    expect(pitchIn("Use a pivot table, then filter by month.")).toBeNull();
    expect(pitchIn("We built this at Wren for a client.")).toBe('"Wren"');
    expect(pitchIn("See https://example.com for a guide")).toBe('"https://"');
    expect(pitchIn("Try example.com, it does that")).toBe('"example.com"');
    expect(pitchIn("dm me and I'll send it")).toBe('"dm me"');
  });

  it("the caps count the lane's day, not UTC's", () => {
    // 23:30 in Toronto on Oct 6 is 03:30 UTC on Oct 7: still Oct 6's count.
    expect(dayStart(new Date("2026-10-07T03:30:00Z")).toISOString()).toBe(
      "2026-10-06T04:00:00.000Z",
    );
    expect(dayStart(new Date("2026-10-06T18:00:00Z")).toISOString()).toBe(
      "2026-10-06T04:00:00.000Z",
    );
  });

  it("person facts: age, karma, places by count, their domains, peak hour", () => {
    const f = personFacts(
      profile([
        said("r/agency · Hiring", "We run https://acmeops.io and https://imgur.com/x"),
        said("r/agency · Tools", "acmeops again https://www.acmeops.io/about"),
        said("r/smallbusiness", "hi", "2026-10-04T09:00:00Z"),
      ]),
      NOW,
    );
    expect(f).toEqual({
      ageDays: 400,
      karma: 812,
      places: [
        { place: "r/agency", n: 2 },
        { place: "r/smallbusiness", n: 1 },
      ],
      domains: [{ domain: "acmeops.io", n: 2 }],
      peakHourUtc: 15,
    });
  });

  it("a model's fact stands only on their exact words; a site only when its host is in them", async () => {
    const p = profile([
      said("r/agency", "I run a 12 person agency in Denver. My site is acmeops.io"),
    ]);
    const llm = new FakeLlm({
      default: JSON.stringify({
        role: { value: "owner", quote: "I run a 12 person agency" },
        business: { value: "agency", quote: "a marketing agency" },
        size: { value: "12 people", quote: "12 person agency" },
        location: null,
        site: { value: "acmeops.io", quote: "My site is acmeops.io" },
        struggles: [{ value: "hiring", quote: "hiring is killing me" }],
        fit: 8.4,
        why: "Agency owner",
      }),
    });
    const r = await readWords(llm, p, WREN_AUDIENCE.about);
    expect(r?.read.role?.value).toBe("owner");
    expect(r?.read.business).toBeNull();
    expect(r?.read.size?.value).toBe("12 people");
    expect(r?.read.struggles).toEqual([]);
    expect(r?.site).toBe("acmeops.io");
    expect(r?.fit).toBe(8);
  });

  it("pace from the newest posts; small places skip the model; facts are the SOPs sharing the most words", async () => {
    const posts = [0, 6, 12, 24].map((h, i) => ({
      id: `${i}`,
      name: `t3_${i}`,
      created_utc: utc(h),
      num_comments: [1, 5, 9, 3][i] as number,
    }));
    expect(paceOf(posts)).toEqual({ postsADay: 3, medianComments: 5 });
    const llm = new FakeLlm({
      respond: () => {
        throw new Error("no model call under the floors");
      },
    });
    const place = (subscribers: number, latest: typeof posts) => ({
      about: { display_name: "Tiny", subscribers },
      rules: {},
      top: [],
      latest,
    });
    expect(await judgePlace(llm, "tiny", place(75, posts), WREN_AUDIENCE)).toMatchObject({
      fit: 0,
      why: "Too small: 75 members.",
    });
    expect(
      await judgePlace(llm, "tiny", place(5000, posts.slice(0, 1)), WREN_AUDIENCE),
    ).toMatchObject({
      fit: 0,
      why: "Too small: 0 posts a day.",
    });
    const facts = [
      { label: "cold-email", text: "warmup inboxes deliverability bounce rates domains" },
      { label: "reddit", text: "karma subreddit comments warmup accounts ladder" },
    ];
    expect(
      factsFor("how do you warmup inboxes without hurting deliverability on new domains", facts),
    ).toEqual([facts[0]]);
  });
});
