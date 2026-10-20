/**
 * Every post we may answer is a platform object before its row lands (designs/briefs
 * 2026-10-20-objects-3-reach.md): found posts, pasted posts and threads, the comment we answer, and
 * our reply once a send gives its ref. A spelling no rule reads is skipped on a read, refused on a
 * paste, and never fails a send. Synthetic rows only.
 */
import { resolveObjects } from "@wren/core/objects";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount } from "../../src/accounts.js";
import { addPlaces } from "../../src/discovery/places.js";
import type { Post } from "../../src/discovery/reads.js";
import { keepThreads, markCommented } from "../../src/discovery/threads.js";
import { keepPasted, queuePastedThread } from "../../src/intercept.js";
import { type FeedPost, keepPosts } from "../../src/reach-posts.js";
import { ReachRefusal } from "../../src/refusal.js";
import { reachPosts, redditThreads } from "../../src/schema.js";

const NOW = new Date("2026-10-13T15:00:00Z");
const TABLES = [
  "reach_posts",
  "reddit_threads",
  "reddit_places",
  "reach_accounts",
  "platform_objects",
];

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

const feedPost = (ref: string, over: Partial<FeedPost> = {}): FeedPost => ({
  ref,
  author: "Author One",
  authorUrl: "https://www.linkedin.com/in/author-one",
  handle: "author-one",
  text: "Our recruiting agency spends hours chasing candidates for interview slots.",
  at: new Date(NOW.getTime() - 3_600_000).toISOString(),
  reactions: 4,
  comments: 1,
  url: `https://www.linkedin.com/feed/update/${ref}/`,
  ...over,
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

const thread = (n: number, over: Partial<Post> = {}): Post => ({
  id: `p${n}`,
  name: `t3_p${n}`,
  title: `How do I stop chasing invoices ${n}`,
  selftext: "We are a 10 person agency and invoices slip.",
  author: `owner${n}`,
  subreddit: "agency",
  permalink: `/r/agency/comments/p${n}/x/`,
  created_utc: NOW.getTime() / 1000 - 3600,
  num_comments: 2,
  ...over,
});

/** One platform object, as the table holds it. */
async function objectOf(platform: string, ref: string) {
  const [o] = await db().execute<{
    kind: string;
    url: string | null;
    author: string | null;
    post: string | null;
    parent: string | null;
  }>(
    sql`select kind, url, author, post, parent from platform_objects
      where platform = ${platform} and ref = ${ref}`,
  );
  return o ?? null;
}

describe("found posts", () => {
  it("keepPosts writes the object, with its author, and skips a ref no rule reads", async () => {
    const out = await keepPosts(
      db(),
      [feedPost("urn:li:activity:5001"), feedPost("not a urn", { url: "https://example.com/x" })],
      POSTS,
    );
    expect(out.found).toHaveLength(1);
    expect(await objectOf("linkedin", "urn:li:activity:5001")).toMatchObject({
      kind: "post",
      author: "author-one",
    });
    const rows = await db().select({ ref: reachPosts.ref }).from(reachPosts);
    expect(rows).toEqual([{ ref: "urn:li:activity:5001" }]);
  });

  it("a second pass keeps nothing twice", async () => {
    await keepPosts(db(), [feedPost("urn:li:activity:5002")], POSTS);
    const again = await keepPosts(db(), [feedPost("urn:li:activity:5002")], POSTS);
    expect(again.found).toEqual([]);
    expect(await db().select().from(reachPosts)).toHaveLength(1);
  });

  it("a pasted post is an object first; a ref no rule reads is refused", async () => {
    const kept = await keepPasted(db(), feedPost("urn:li:activity:5003"), {
      platform: "linkedin",
      account: "linkedin@wren",
      now: NOW,
    });
    expect(kept.state).toBe("found");
    expect(await objectOf("linkedin", "urn:li:activity:5003")).toMatchObject({ kind: "post" });
    await expect(
      keepPasted(db(), feedPost("nonsense", { url: "https://example.com/x" }), {
        platform: "linkedin",
        account: "linkedin@wren",
        now: NOW,
      }),
    ).rejects.toThrow(ReachRefusal);
    expect(await db().select().from(reachPosts)).toHaveLength(1);
  });
});

describe("Reddit threads", () => {
  it("a pasted thread is an object first; a name no rule reads is refused", async () => {
    const p = thread(1);
    const out = await queuePastedThread(db(), { post: p, comments: [] }, NOW);
    expect(out).toMatchObject({ id: "t3_p1", state: "queued" });
    expect(await objectOf("reddit", "t3_p1")).toMatchObject({
      kind: "post",
      author: "owner1",
    });
    await expect(
      queuePastedThread(db(), { post: thread(2, { name: "t1_nope" }), comments: [] }, NOW),
    ).rejects.toThrow(ReachRefusal);
    expect(await db().select().from(redditThreads)).toHaveLength(1);
  });

  it("a reply ref after a send lands with its object, under the comment we answered", async () => {
    await addPlaces(db(), [{ name: "agency", foundBy: "named" }]);
    const a = await addAccount(db(), { platform: "reddit", account: "reddit@wren", now: NOW });
    await keepThreads(db(), "agency", [thread(1)], { now: NOW, ours: [], judged: null });
    await resolveObjects(db(), [
      { platform: "reddit", kind: "comment", raw: "t1_ask", post: "t3_p1", parent: "t3_p1" },
    ]);
    await db().update(redditThreads).set({ target: "t1_ask" }).where(eq(redditThreads.id, "t3_p1"));
    await markCommented(db(), "t3_p1", {
      body: "Words.",
      ref: "t1_ours",
      accountId: a.id,
      now: NOW,
    });
    expect(await objectOf("reddit", "t1_ours")).toMatchObject({
      kind: "comment",
      post: "t3_p1",
      parent: "t1_ask",
    });
    const [t] = await db().select().from(redditThreads).where(eq(redditThreads.id, "t3_p1"));
    expect(t).toMatchObject({ state: "commented", answerRef: "t1_ours" });
  });

  it("a reply ref no rule reads does not fail the send: the row keeps no ref", async () => {
    await addPlaces(db(), [{ name: "agency", foundBy: "named" }]);
    const a = await addAccount(db(), { platform: "reddit", account: "reddit@wren", now: NOW });
    await keepThreads(db(), "agency", [thread(3)], { now: NOW, ours: [], judged: null });
    await markCommented(db(), "t3_p3", {
      body: "Words.",
      ref: "no way!",
      accountId: a.id,
      now: NOW,
    });
    const [t] = await db().select().from(redditThreads).where(eq(redditThreads.id, "t3_p3"));
    expect(t).toMatchObject({ state: "commented", answer: "Words.", answerRef: null });
  });

  it("a raw row with a post no object names fails on the key", async () => {
    await addPlaces(db(), [{ name: "agency", foundBy: "named" }]);
    await expect(
      db().insert(redditThreads).values({
        id: "t3_ghost",
        subreddit: "agency",
        title: "x",
        body: "x",
        author: "x",
        url: "https://example.com/ghost",
        postedAt: NOW,
        comments: 0,
        raw: {},
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "fk_reddit_threads_platform_id_platform_objects" },
    });
  });
});
