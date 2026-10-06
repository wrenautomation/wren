/**
 * Reddit discovery on Postgres with a fake model: places kept and judged, watched from the pool
 * account with room, threads filtered, ranked and queued under the rung's cap, drafted against
 * the thread (the guard drops one we're already in), commented once, and scored.
 */
import { fakeOutreachChannel } from "@wren/core/outreach";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import {
  addPlaces,
  draftThread,
  keepPerson,
  keepPlace,
  keepScores,
  keepThreads,
  markCommented,
  movePlace,
  type PlaceRead,
  type Post,
  peopleToRead,
  planThreadComment,
  queueThreads,
  rankThreads,
  skipPlace,
  WREN_AUDIENCE,
  watchPlace,
} from "../../src/index.js";
import { placeRecord, threadRecord } from "../../src/records.js";
import { ReachRefusal } from "../../src/refusal.js";
import { comments, type ReachAccount, redditPlaces, redditThreads } from "../../src/schema.js";

const TABLES = ["reddit_threads", "reddit_places", "reddit_people", "comments", "reach_accounts"];
const NOW = new Date("2026-10-06T18:00:00Z");
const DAY = 86_400_000;
const utc = (hoursAgo: number) => NOW.getTime() / 1000 - hoursAgo * 3600;

let pg: TestPostgres;
const db = () => pg.db;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
});

/** A warming Reddit account `days` old with `karma`. */
async function account(key: string, handle: string, days: number, karma: number) {
  const a = await addAccount(db(), { platform: "reddit", account: key, now: NOW });
  const ch = fakeOutreachChannel("reddit", { account: key, now: () => NOW });
  ch.setHealth({ handle, createdAt: new Date(NOW.getTime() - days * DAY).toISOString(), karma });
  await refreshHealth(db(), [a], () => ch, NOW);
  return setAccountState(db(), a.id, "warming", {
    reason: null,
    now: NOW,
  }) as Promise<ReachAccount>;
}

const read = (sub: string, rules: string[] = ["Be kind"]): PlaceRead => ({
  about: { display_name: sub, title: sub, subscribers: 40_000, subreddit_type: "public" },
  rules: { rules: rules.map((r) => ({ short_name: r, description: "" })) },
  top: [],
  latest: [],
});

const judged = (over = {}) => ({
  fit: 8,
  why: "Owners ask about hiring",
  rules: "No self-promo",
  mayComment: true,
  mayPost: true,
  linkOnly: true,
  karmaMin: null,
  ageMinDays: null,
  postsADay: 12,
  medianComments: 6,
  ...over,
});

const post = (n: number, over: Partial<Post> = {}): Post => ({
  id: `p${n}`,
  name: `t3_p${n}`,
  title: `How do I stop chasing invoices ${n}`,
  selftext: "We are a 10 person agency and invoices slip.",
  author: `owner${n}`,
  permalink: `/r/agency/comments/p${n}/x/`,
  created_utc: utc(n),
  num_comments: 2,
  ...over,
});

describe("reddit discovery", () => {
  it("places: kept once, judged, watched from the account with room, moved, skipped", async () => {
    const old = await account("reddit@wren", "WrenAutomation", 60, 300);
    const young = await account("reddit@alt", "ok_crow", 10, 5);
    expect(
      await addPlaces(db(), [
        { name: "r/Agency", foundBy: "topic: agency" },
        { name: "agency", foundBy: "named" },
        { name: "smallbusiness", foundBy: "named" },
      ]),
    ).toBe(2);
    await keepPlace(db(), "agency", read("Agency"), judged({ karmaMin: 100 }), NOW);
    await keepPlace(db(), "smallbusiness", read("smallbusiness"), judged(), NOW);
    // Only the old account meets the karma floor.
    expect(await watchPlace(db(), "agency", NOW)).toEqual({ account: old.id });
    // The young one has fewer places and meets no floor here.
    expect(await watchPlace(db(), "smallbusiness", NOW)).toEqual({ account: young.id });
    await movePlace(db(), "smallbusiness", "u/WrenAutomation");
    await expect(movePlace(db(), "smallbusiness", "reddit@nobody")).rejects.toThrow(ReachRefusal);
    await addPlaces(db(), [{ name: "nocomments", foundBy: "named" }]);
    await keepPlace(db(), "nocomments", read("nocomments"), judged({ mayComment: false }), NOW);
    await expect(watchPlace(db(), "nocomments", NOW)).rejects.toThrow(/doesn't allow/);
    await skipPlace(db(), "nocomments");
    // A re-read with new rules says so.
    const again = await keepPlace(db(), "agency", read("Agency", ["No links"]), judged(), NOW);
    expect(again.rulesChanged).toBe(true);
    const rows = (await placeRecord.rows?.(db())) ?? [];
    const byPlace = Object.fromEntries(rows.map((r) => [r.place, [r.state, r.account]]));
    expect(byPlace).toEqual({
      "r/Agency": ["watching", "WrenAutomation"],
      "r/smallbusiness": ["watching", "WrenAutomation"],
      "r/nocomments": ["skipped", null],
    });
    expect(String(rows.find((r) => r.place === "r/Agency")?.why)).toMatch(
      /^Rules changed 2026-10-06/,
    );
  });

  it("threads: filtered, ranked, queued to the cap, drafted, guarded, commented, scored", async () => {
    const a = await account("reddit@wren", "WrenAutomation", 5, 2); // comment rung: 3 a day
    await addPlaces(db(), [{ name: "agency", foundBy: "named" }]);
    await keepPlace(db(), "agency", read("agency"), judged(), NOW);
    await watchPlace(db(), "agency", NOW);
    const posts = [1, 2, 3, 4, 5].map((n) => post(n));
    posts.push(post(6, { created_utc: utc(30) }), post(7, { author: "WrenAutomation" }));
    const o = { now: NOW, ours: ["WrenAutomation"], judged: judged() };
    const fresh = await keepThreads(db(), "agency", posts, o);
    expect(fresh.sort()).toEqual(["t3_p1", "t3_p2", "t3_p3", "t3_p4", "t3_p5"]);
    expect(await keepThreads(db(), "agency", posts, o)).toEqual([]);
    const ranker = new FakeLlm({
      default: JSON.stringify({
        threads: fresh.map((id, i) => ({ id, kind: "help", fit: 9 - i, angle: "How we chase" })),
      }),
    });
    expect(await rankThreads(db(), ranker, fresh, WREN_AUDIENCE)).toBe(5);
    const queued = await queueThreads(db(), "agency", NOW);
    expect(queued).toHaveLength(3);
    expect(await queueThreads(db(), "agency", NOW)).toEqual([]);

    const [first, second] = queued as [string, string];
    const writer = new FakeLlm({
      default: JSON.stringify({ target: "t1_ask", comment: "We send the invoice from the CRM." }),
    });
    const thread = {
      post: post(1),
      comments: [
        { name: "t1_ask", author: "cfo_jane", body: "Same, what tool do you use?", depth: 0 },
      ],
    };
    const deps = { op: null, facts: [], voice: "plain", ours: ["WrenAutomation"] };
    expect(await draftThread(db(), writer, first, { ...deps, read: thread })).toBe("drafted");
    const [t] = await db().select().from(redditThreads).where(eq(redditThreads.id, first));
    expect(t).toMatchObject({ target: "t1_ask", draft: "We send the invoice from the CRM." });
    const met = {
      post: post(2),
      comments: [{ name: "t1_x", author: "wrenautomation", body: "hi", depth: 0 }],
    };
    expect(await draftThread(db(), writer, second, { ...deps, read: met })).toBe("dropped");

    const plan = await planThreadComment(db(), first, NOW);
    expect(plan.account.id).toBe(a.id);
    await markCommented(db(), first, { body: "x", ref: "t1_ours", accountId: a.id, now: NOW });
    await expect(planThreadComment(db(), first, NOW)).rejects.toThrow(/already commented/);
    await keepScores(db(), [{ ref: "t1_ours", score: 7 }], NOW);
    const rows = (await threadRecord.rows?.(db())) ?? [];
    const ours = rows.find((r) => r.id === first);
    expect(ours).toMatchObject({ state: "commented", score: 7, account: "WrenAutomation" });
    const [place] = await db().select().from(redditPlaces);
    expect(place?.state).toBe("watching");
  });

  it("the cap counts answers under our comments too", async () => {
    const a = await account("reddit@wren", "WrenAutomation", 5, 2);
    await addPlaces(db(), [{ name: "agency", foundBy: "named" }]);
    await keepPlace(db(), "agency", read("agency"), judged(), NOW);
    await watchPlace(db(), "agency", NOW);
    await keepThreads(db(), "agency", [post(1), post(2), post(3), post(4)], {
      now: NOW,
      ours: [],
      judged: judged(),
    });
    await rankThreads(
      db(),
      new FakeLlm({
        default: JSON.stringify({
          threads: [1, 2, 3, 4].map((n) => ({ id: `t3_p${n}`, kind: "help", fit: 8, angle: "a" })),
        }),
      }),
      ["t3_p1", "t3_p2", "t3_p3", "t3_p4"],
      WREN_AUDIENCE,
    );
    await queueThreads(db(), "agency", NOW);
    for (const id of ["t3_p1", "t3_p2", "t3_p3"])
      await db().update(redditThreads).set({ state: "queued" }).where(eq(redditThreads.id, id));
    for (const id of ["t3_p1", "t3_p2", "t3_p3"])
      await markCommented(db(), id, { body: "x", ref: null, accountId: a.id, now: NOW });
    await db().update(redditThreads).set({ state: "queued" }).where(eq(redditThreads.id, "t3_p4"));
    await expect(planThreadComment(db(), "t3_p4", NOW)).rejects.toThrow(/3 comments a day/);
  });

  it("people to read: commenters and Reddit DM contacts, not ours, not fresh", async () => {
    const a = await account("reddit@wren", "WrenAutomation", 60, 300);
    const said = (n: number, author: string, sort: string | null = null) => ({
      platform: "reddit" as const,
      accountId: a.id,
      ref: `t1_${n}`,
      post: "t3_x",
      parent: "t3_x",
      kind: "post_reply" as const,
      author,
      body: "hi",
      url: "https://www.reddit.com/r/x/comments/x/",
      at: new Date(NOW.getTime() - n * 60_000),
      raw: {},
      sort: sort as never,
    });
    await db()
      .insert(comments)
      .values([said(1, "Fresh_One"), said(2, "New_Two"), said(3, "WrenAutomation", "ours")]);
    const profile = (handle: string) => ({
      handle,
      url: "",
      name: null,
      headline: null,
      foundIn: "enrich",
      about: null,
      current: null,
      company: null,
      location: null,
      recent: [],
      raw: {},
      fetchedAt: NOW.toISOString(),
      fetchedWith: "api" as const,
    });
    await keepPerson(db(), profile("Fresh_One"), null, NOW);
    expect(await peopleToRead(db(), ["WrenAutomation"], NOW, 5)).toEqual(["new_two"]);
    const later = new Date(NOW.getTime() + 31 * DAY);
    expect(await peopleToRead(db(), ["WrenAutomation"], later, 5)).toEqual([
      "fresh_one",
      "new_two",
    ]);
  });
});
