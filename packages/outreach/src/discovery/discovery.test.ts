import type { Profile } from "@wren/core/outreach";
import { FakeLlm } from "@wren/llm";
import { describe, expect, it } from "vitest";
import { personFacts, readWords } from "./people.js";
import { paceOf, WREN_AUDIENCE } from "./places.js";
import { signedOut } from "./reads.js";
import { dropReason, factsFor } from "./threads.js";

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

  it("pace from the newest posts; facts are the SOPs sharing the most words", () => {
    const posts = [0, 6, 12, 24].map((h, i) => ({
      id: `${i}`,
      name: `t3_${i}`,
      created_utc: utc(h),
      num_comments: [1, 5, 9, 3][i] as number,
    }));
    expect(paceOf(posts)).toEqual({ postsADay: 3, medianComments: 5 });
    const facts = [
      { label: "cold-email", text: "warmup inboxes deliverability bounce rates domains" },
      { label: "reddit", text: "karma subreddit comments warmup accounts ladder" },
    ];
    expect(
      factsFor("how do you warmup inboxes without hurting deliverability on new domains", facts),
    ).toEqual([facts[0]]);
  });
});
