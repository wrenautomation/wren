/**
 * Reddit discovery on Postgres with a fake model: places kept and judged, watched from the pool
 * account with room, threads filtered, ranked and queued under the rung's cap, drafted against
 * the thread (the guard drops one we're already in), commented once, and scored.
 */
import { fakeOutreachChannel } from "@wren/core/outreach";
import {
  commentObjects,
  seedObjects,
  startTestPostgres,
  type TestPostgres,
  truncate,
} from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, refreshHealth, setAccountState } from "../../src/accounts.js";
import {
  addKarmaPlaces,
  addPlaces,
  draftThread,
  expireStale,
  joined,
  KARMA_FRESH_MS,
  KARMA_PLACES,
  keepPerson,
  keepPlace,
  keepScores,
  keepThreads,
  markCommented,
  movePlace,
  type PlaceRead,
  type Post,
  peopleToRead,
  placesToJoin,
  planThreadComment,
  queueThreads,
  rankThreads,
  settleKarmaPlace,
  skipPlace,
  ThreadHeld,
  unrankedThreads,
  WREN_AUDIENCE,
  watchPlace,
} from "../../src/index.js";
import { placeRecord, threadRecord } from "../../src/records.js";
import { ReachRefusal } from "../../src/refusal.js";
import { scheduleThreads, THREAD_PACE } from "../../src/scheduled.js";
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
      "r/Agency": ["watching", "reddit@wren"],
      "r/smallbusiness": ["watching", "reddit@wren"],
      "r/nocomments": ["skipped", null],
    });
    expect(String(rows.find((r) => r.place === "r/Agency")?.why)).toMatch(
      /^Rules changed 2026-10-06/,
    );
    // Watched places wait for their account to join, oldest first; a joined one is done.
    expect(await placesToJoin(db(), 5)).toEqual([
      { subreddit: "agency", account: "reddit@wren" },
      { subreddit: "smallbusiness", account: "reddit@wren" },
    ]);
    await joined(db(), "agency", NOW);
    expect((await placesToJoin(db(), 5)).map((p) => p.subreddit)).toEqual(["smallbusiness"]);
  });

  it("threads: filtered, ranked, queued to the cap, drafted, guarded, commented, scored", async () => {
    const a = await account("reddit@wren", "WrenAutomation", 5, 2); // comment rung: 2 a day in reach places
    await addPlaces(db(), [{ name: "agency", foundBy: "named" }]);
    await keepPlace(db(), "agency", read("agency"), judged(), NOW);
    await watchPlace(db(), "agency", NOW);
    const posts = [1, 2, 3, 4, 5].map((n) => post(n));
    posts.push(post(6, { created_utc: utc(30) }), post(7, { author: "WrenAutomation" }));
    const o = { now: NOW, ours: ["WrenAutomation"], judged: judged() };
    const fresh = await keepThreads(db(), "agency", posts, o);
    expect(fresh.sort()).toEqual(["t3_p1", "t3_p2", "t3_p3", "t3_p4", "t3_p5"]);
    expect(await keepThreads(db(), "agency", posts, o)).toEqual([]);
    const rank = (ids: string[]) =>
      new FakeLlm({
        default: JSON.stringify({
          threads: ids.map((id) => ({
            id,
            kind: "help",
            fit: 9 - Number(id.slice(4)) + 1,
            angle: "How we chase",
          })),
        }),
      });
    // The model leaves one out: the next pass ranks it, with nothing new read.
    expect(await rankThreads(db(), rank(fresh.slice(1)), fresh, WREN_AUDIENCE)).toBe(4);
    const left = await unrankedThreads(db(), "agency");
    expect(left).toEqual([fresh[0]]);
    expect(await rankThreads(db(), rank(left), left, WREN_AUDIENCE)).toBe(1);
    expect(await unrankedThreads(db(), "agency")).toEqual([]);
    const queued = await queueThreads(db(), "agency", NOW);
    expect(queued).toHaveLength(2);
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
    expect(ours).toMatchObject({ state: "commented", score: 7, account: "reddit@wren" });
    const [place] = await db().select().from(redditPlaces);
    expect(place?.state).toBe("watching");
  });

  it("the cap counts every comment of the day; reach places hold past their share", async () => {
    // 60 karma at 5 days: the comment rung (5 a day), the reach share lifted.
    const a = await account("reddit@wren", "WrenAutomation", 5, 60);
    await addPlaces(db(), [{ name: "agency", foundBy: "named" }]);
    await keepPlace(db(), "agency", read("agency"), judged(), NOW);
    await watchPlace(db(), "agency", NOW);
    const ids = [1, 2, 3, 4, 5, 6].map((n) => `t3_p${n}`);
    await keepThreads(
      db(),
      "agency",
      [1, 2, 3, 4, 5, 6].map((n) => post(n)),
      {
        now: NOW,
        ours: [],
        judged: judged(),
      },
    );
    await db().update(redditThreads).set({ state: "queued", accountId: a.id });
    for (const id of ids.slice(0, 5))
      await markCommented(db(), id, { body: "x", ref: null, accountId: a.id, now: NOW });
    await expect(planThreadComment(db(), "t3_p6", NOW)).rejects.toThrow(/5 comments a day/);

    // Under 50 karma, a third reach comment of the day is held; a karma place's still goes.
    await truncate(pg.db, TABLES);
    const young = await account("reddit@wren", "WrenAutomation", 5, 2);
    for (const [sub, purpose] of [
      ["agency", "reach"],
      ["excel", "karma"],
    ] as const) {
      await addPlaces(db(), [{ name: sub, foundBy: "named" }]);
      await db().update(redditPlaces).set({ purpose }).where(eq(redditPlaces.subreddit, sub));
      await keepPlace(db(), sub, read(sub), judged(), NOW);
      await watchPlace(db(), sub, NOW);
    }
    await keepThreads(
      db(),
      "agency",
      [1, 2, 3].map((n) => post(n)),
      { now: NOW, ours: [], judged: judged() },
    );
    await keepThreads(db(), "excel", [post(9, { id: "k9", name: "t3_k9" })], {
      now: NOW,
      ours: [],
      judged: judged(),
      purpose: "karma",
    });
    await db().update(redditThreads).set({ state: "queued", accountId: young.id });
    for (const id of ["t3_p1", "t3_p2"])
      await markCommented(db(), id, { body: "x", ref: null, accountId: young.id, now: NOW });
    const held = planThreadComment(db(), "t3_p3", NOW);
    await expect(held).rejects.toBeInstanceOf(ThreadHeld);
    await expect(held).rejects.toThrow(/2 business comments a day until 50 karma/);
    expect((await planThreadComment(db(), "t3_k9", NOW)).account.id).toBe(young.id);
  });

  it("the queue holds the account's cap across its subs; stale threads expire in every sub", async () => {
    await account("reddit@wren", "WrenAutomation", 5, 2); // 2 a day in reach places
    for (const sub of ["agency", "smallbusiness"]) {
      await addPlaces(db(), [{ name: sub, foundBy: "named" }]);
      await keepPlace(db(), sub, read(sub), judged(), NOW);
      await watchPlace(db(), sub, NOW);
    }
    const o = { now: NOW, ours: [], judged: judged() };
    for (const sub of ["agency", "smallbusiness"]) {
      const posts = [1, 2, 3].map((n) => post(n, { id: `${sub}${n}`, name: `t3_${sub}${n}` }));
      const ids = await keepThreads(db(), sub, posts, o);
      await db()
        .update(redditThreads)
        .set({ state: "ranked", fit: 8 })
        .where(inArray(redditThreads.id, ids));
    }
    expect(await queueThreads(db(), "agency", NOW)).toHaveLength(2);
    // Same account, its cap already queued: the second sub queues none.
    expect(await queueThreads(db(), "smallbusiness", NOW)).toEqual([]);
    // Two days on, nothing was slotted: every queued thread goes stale, read again or not.
    const later = new Date(NOW.getTime() + 2 * DAY);
    expect(await expireStale(db(), later)).toBe(2);
    const left = await db().select().from(redditThreads);
    expect(left.filter((t) => t.dropped === "went stale").map((t) => t.subreddit)).toEqual([
      "agency",
      "agency",
    ]);
  });

  it("karma places: kept as rows, judged, watched by themselves across both accounts", async () => {
    const one = await account("reddit@wren", "WrenAutomation", 20, 2);
    const two = await account("reddit@alt", "AltHandle", 15, 3);
    // A known place becomes a karma place and is read again; a reach place stays as it is.
    await addPlaces(db(), [
      { name: "Entrepreneur", foundBy: "topic: x" },
      { name: "agency", foundBy: "named" },
    ]);
    await keepPlace(db(), "entrepreneur", read("Entrepreneur"), judged(), NOW);
    expect(await addKarmaPlaces(db())).toBe(KARMA_PLACES.length);
    expect(await addKarmaPlaces(db())).toBe(0);
    const rows = await db().select().from(redditPlaces);
    expect(rows.filter((r) => r.purpose === "karma")).toHaveLength(KARMA_PLACES.length);
    expect(rows.find((r) => r.subreddit === "agency")?.purpose).toBe("reach");
    expect(rows.find((r) => r.subreddit === "entrepreneur")).toMatchObject({
      purpose: "karma",
      readAt: null,
      foundBy: "topic: x",
    });
    // Rules that allow us watch it; four split across the two accounts.
    for (const sub of ["excel", "productivity", "answers", "nocode"]) {
      await keepPlace(db(), sub, read(sub), judged(), NOW);
      expect(await settleKarmaPlace(db(), sub, NOW)).toBe("watching");
    }
    const watched = (await db().select().from(redditPlaces)).filter((r) => r.state === "watching");
    expect(watched.filter((r) => r.accountId === one.id)).toHaveLength(2);
    expect(watched.filter((r) => r.accountId === two.id)).toHaveLength(2);
    // Rules that forbid our comments skip it; a floor above both accounts leaves it found.
    await keepPlace(db(), "casualconversation", read("cc"), judged({ mayComment: false }), NOW);
    expect(await settleKarmaPlace(db(), "casualconversation", NOW)).toBe("skipped");
    await keepPlace(db(), "careerguidance", read("cg"), judged({ karmaMin: 100 }), NOW);
    expect(await settleKarmaPlace(db(), "careerguidance", NOW)).toBe("found");
    // A reach place is never watched by the pass.
    await keepPlace(db(), "agency", read("agency"), judged(), NOW);
    expect(await settleKarmaPlace(db(), "agency", NOW)).toBeNull();
    // The place rows say what each is for.
    const places = (await placeRecord.rows?.(db())) ?? [];
    expect(places.find((r) => r.id === "excel")).toMatchObject({ purpose: "karma" });
  });

  it("karma threads: young only, their own queue room, slotted first and soon", async () => {
    const a = await account("reddit@wren", "WrenAutomation", 20, 2);
    for (const [sub, purpose] of [
      ["agency", "reach"],
      ["excel", "karma"],
    ] as const) {
      await addPlaces(db(), [{ name: sub, foundBy: "named" }]);
      await db().update(redditPlaces).set({ purpose }).where(eq(redditPlaces.subreddit, sub));
      await keepPlace(db(), sub, read(sub), judged(), NOW);
      await watchPlace(db(), sub, NOW);
    }
    // A reach backlog past its share: four queued, drafted, unslotted.
    const reach = [1, 2, 3, 4].map((n) => post(n));
    await keepThreads(db(), "agency", reach, { now: NOW, ours: [], judged: judged() });
    await db()
      .update(redditThreads)
      .set({ state: "queued", accountId: a.id, fit: 8, draft: "reach" })
      .where(eq(redditThreads.subreddit, "agency"));
    const k = (n: number, over: Partial<Post> = {}) =>
      post(n, { id: `k${n}`, name: `t3_k${n}`, created_utc: utc(n / 2), ...over });
    const kept = await keepThreads(
      db(),
      "excel",
      [k(1), k(2), k(3), k(4), k(5, { created_utc: utc(8) }), k(6, { num_comments: 30 })],
      { now: NOW, ours: [], judged: judged(), purpose: "karma" },
    );
    expect(kept.sort()).toEqual(["t3_k1", "t3_k2", "t3_k3", "t3_k4"]);
    // Newest first for a karma place.
    expect(await unrankedThreads(db(), "excel", "karma")).toEqual([
      "t3_k1",
      "t3_k2",
      "t3_k3",
      "t3_k4",
    ]);
    await db()
      .update(redditThreads)
      .set({ state: "ranked", fit: 8 })
      .where(inArray(redditThreads.id, kept));
    // The backlog counts as its share (2): karma gets the other 3 of the day's 5.
    expect(await queueThreads(db(), "excel", NOW)).toHaveLength(3);
    expect(await queueThreads(db(), "agency", NOW)).toEqual([]);
    await db()
      .update(redditThreads)
      .set({ draft: "karma" })
      .where(and(eq(redditThreads.subreddit, "excel"), eq(redditThreads.state, "queued")));
    const slots = await scheduleThreads(db(), { now: NOW, rand: () => 0 });
    const at = new Map(slots.map((s) => [s.id, new Date(s.at).getTime()]));
    const karmaAt = [...at].filter(([id]) => id.startsWith("t3_k")).map(([, t]) => t);
    const reachAt = [...at].filter(([id]) => id.startsWith("t3_p")).map(([, t]) => t);
    expect(karmaAt).toHaveLength(3);
    // Karma first, each inside 6 hours of its post; reach after, 2 a day.
    expect(Math.max(...karmaAt)).toBeLessThan(Math.min(...reachAt));
    const posted = new Map(
      (await db().select().from(redditThreads)).map((t) => [t.id, t.postedAt.getTime()]),
    );
    for (const [id, t] of at)
      if (id.startsWith("t3_k"))
        expect(t - (posted.get(id) ?? 0)).toBeLessThanOrEqual(KARMA_FRESH_MS);
    const day = (t: number) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: THREAD_PACE.zone }).format(new Date(t));
    const perDay = new Map<string, number>();
    for (const t of reachAt) perDay.set(day(t), (perDay.get(day(t)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
    // A karma thread past 6 hours goes stale unslotted; the reach ones keep their day and a half.
    await db().update(redditThreads).set({ sendAt: null });
    expect(await expireStale(db(), new Date(NOW.getTime() + 7 * 3_600_000))).toBe(3);
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
    await seedObjects(
      db(),
      commentObjects([1, 2, 3].map((n) => ({ platform: "reddit", ref: `t1_${n}`, post: "t3_x" }))),
    );
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
