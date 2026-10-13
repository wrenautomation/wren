/**
 * Engage's Pass on Postgres: passing on a person closes the picked row with its draft kept as
 * turned down, closes everything else open of theirs, and what the reads find from them later
 * lands closed. "Not now" rests them 30 days; a lift lets them back.
 */
import type { CommentIn } from "@wren/core/outreach";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount } from "../../src/accounts.js";
import { keepComments } from "../../src/comments.js";
import { addPlaces } from "../../src/discovery/places.js";
import type { Post } from "../../src/discovery/reads.js";
import { keepThreads } from "../../src/discovery/threads.js";
import { liftPass, listPasses, passOn } from "../../src/passes.js";
import { type FeedPost, keepPosts } from "../../src/reach-posts.js";
import { comments, reachPasses, reachPosts, redditThreads } from "../../src/schema.js";

const TABLES = [
  "reach_passes",
  "comments",
  "reach_posts",
  "reddit_threads",
  "reddit_places",
  "reach_accounts",
  "draft_events",
];
const NOW = new Date("2026-10-13T15:00:00Z");
const DAY = 86_400_000;

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

const comment = (n: number, handle: string): CommentIn => ({
  ref: `t1_c${n}`,
  post: "t3_p1",
  parent: "t3_p1",
  kind: "post_reply",
  place: "agency",
  postTitle: "How we cut invoice chasing to zero",
  handle,
  text: "How did you set that up?",
  url: `https://www.reddit.com/r/agency/comments/p1/x/c${n}/`,
  at: new Date(NOW.getTime() - n * 60_000).toISOString(),
  raw: {},
});

const thread = (n: number, author: string): Post => ({
  id: `p${n}`,
  name: `t3_p${n}`,
  title: `How do I stop chasing invoices ${n}`,
  selftext: "We are a 10 person agency and invoices slip.",
  author,
  permalink: `/r/agency/comments/p${n}/x/`,
  created_utc: NOW.getTime() / 1000 - 3600,
  num_comments: 2,
});

const feedPost = (n: number, handle: string): FeedPost => ({
  ref: `urn:li:activity:${9_000 + n}`,
  author: `Author ${n}`,
  authorUrl: `https://www.linkedin.com/in/${handle}`,
  handle,
  text: `Post ${n}: our recruiting agency spends hours chasing candidates for interview slots.`,
  at: new Date(NOW.getTime() - 3_600_000).toISOString(),
  reactions: 4,
  comments: 1,
  url: `https://www.linkedin.com/feed/update/urn:li:activity:${9_000 + n}/`,
});

const POSTS = {
  platform: "linkedin" as const,
  foundBy: "topic: recruiting",
  account: "linkedin@wren",
  topics: ["recruiting"],
  ours: [],
  maxAgeHours: 48,
  now: NOW,
};
const THREADS = { now: NOW, ours: [], judged: null };

async function reddit() {
  await addPlaces(db(), [{ name: "agency", foundBy: "named" }]);
  return addAccount(db(), { platform: "reddit", account: "reddit@wren", now: NOW });
}

describe("passes", () => {
  it("closes the picked row, the rest of theirs, and what comes later", async () => {
    const a = await reddit();
    const [mine, other] = await keepComments(
      db(),
      a,
      [comment(2, "Spammy"), comment(1, "real_owner")],
      [],
    );
    await db()
      .update(comments)
      .set({ draft: "Glad it helped." })
      .where(eq(comments.id, mine?.id as number));
    expect(await keepThreads(db(), "agency", [thread(1, "spammy")], THREADS)).toEqual(["t3_p1"]);

    const r = await passOn(db(), [`comment:${mine?.id}`], {
      reason: "spam",
      note: "sells followers",
      by: "william",
      now: NOW,
    });
    expect(r).toEqual({ people: 1, closed: 2 });
    const states = await db().select({ id: comments.id, state: comments.state }).from(comments);
    expect(Object.fromEntries(states.map((s) => [s.id, s.state]))).toEqual({
      [mine?.id as number]: "dropped",
      [other?.id as number]: "new",
    });
    const [t] = await db().select().from(redditThreads);
    expect(t?.state).toBe("skipped");
    // His draft is kept as turned down, with why.
    const [ev] = await db().execute<{ event: string; note: string }>(
      sql`select event, note from draft_events where item = ${`comment:${mine?.id}`}`,
    );
    expect(ev).toEqual({ event: "rejected", note: "Spam or a bot: sells followers" });

    // Later reads: theirs land closed, anyone else's as usual.
    expect(await keepComments(db(), a, [comment(3, "SPAMMY"), comment(4, "someone")], [])).toEqual([
      expect.objectContaining({ author: "someone" }),
    ]);
    expect(
      await keepThreads(db(), "agency", [thread(2, "Spammy"), thread(3, "x")], THREADS),
    ).toEqual(["t3_p3"]);
    const [later] = await db().select().from(redditThreads).where(eq(redditThreads.id, "t3_p2"));
    expect(later?.dropped).toBe("you passed on them");
  });

  it("posts: by handle; not now rests 30 days; a lift lets them back", async () => {
    const kept = await keepPosts(db(), [feedPost(1, "jane-doe"), feedPost(2, "jane-doe")], POSTS);
    expect(kept.found).toHaveLength(2);
    const r = await passOn(db(), [`onpost:${kept.found[0]}`], { reason: "not_now", now: NOW });
    expect(r).toEqual({ people: 1, closed: 2 });
    const rows = await db().select({ state: reachPosts.state }).from(reachPosts);
    expect(rows.map((p) => p.state)).toEqual(["skipped", "skipped"]);
    const [p] = await db().select().from(reachPasses);
    expect(p?.until?.getTime()).toBe(NOW.getTime() + 30 * DAY);
    expect(p?.handle).toBe("jane-doe");

    expect((await keepPosts(db(), [feedPost(3, "Jane-Doe")], POSTS)).found).toEqual([]);
    expect(await liftPass(db(), "linkedin", "jane-doe", NOW)).toBe(true);
    expect(await listPasses(db())).toEqual([]);
    expect((await keepPosts(db(), [feedPost(4, "jane-doe")], POSTS)).found).toHaveLength(1);
  });

  it("a row that's gone passes no one", async () => {
    expect(
      await passOn(db(), ["comment:999", "onpost:5"], { reason: "not_lead", now: NOW }),
    ).toEqual({ people: 0, closed: 0 });
  });
});
