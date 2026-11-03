/**
 * Outbound's own rows as touches (designs/2026-10-07-touches.md): `rt:` our comment on a Reddit
 * thread, `rp:` ours on someone's post (LinkedIn, X, Instagram). The turn rows (`rm:`, `c:`,
 * `ca:`) are conversations'; `backfillOutreachTouches` runs both, ours first.
 */
import { itemLink } from "@wren/core/touch-link";
import { recordTouch } from "@wren/core/touches";
import type { Queryable } from "@wren/db";
import {
  accountName,
  backfillTurnTouches,
  bareTouchRefs,
  OWN_ACCOUNT,
  type TurnTouchBackfill,
} from "@wren/starling-conversations/touches";
import { and, eq, sql } from "drizzle-orm";
import { reachPosts, redditPlaces, redditThreads } from "./schema.js";

/** The page of our comment in a Reddit thread. */
const threadLink = (
  t: Pick<typeof redditThreads.$inferSelect, "id" | "url" | "target" | "answerRef">,
) =>
  itemLink("reddit", t.target?.startsWith("t1_") ? "reply" : "comment", {
    url: t.url,
    externalId: t.answerRef,
    post: t.id,
  });

/** Our Reddit answer `ref` went to a karma place: warmup, so a reply to it is warmup too. */
export async function karmaAnswer(db: Queryable, ref: string) {
  const [hit] = await db
    .select({ id: redditThreads.id })
    .from(redditThreads)
    .innerJoin(redditPlaces, eq(redditPlaces.subreddit, redditThreads.subreddit))
    .where(and(eq(redditThreads.answerRef, ref), eq(redditPlaces.purpose, "karma")))
    .limit(1);
  return !!hit;
}

/** `u/<author>: …`, as `target_text` names the comment a thread answer replies to. */
const targetAuthor = (text: string | null) => /^u\/([A-Za-z0-9_-]{3,20}):/.exec(text ?? "")?.[1];

/**
 * Our comment in a Reddit thread: on the OP's post, or a reply to the comment that asked. A
 * comment in a karma place is warmup, not sales: the thread keeps it, no touch is written.
 */
export async function touchFromThread(db: Queryable, id: string) {
  const [t] = await db.select().from(redditThreads).where(eq(redditThreads.id, id));
  if (t?.state !== "commented" || !t.answer || !t.answeredAt) return null;
  const [place] = await db
    .select({ purpose: redditPlaces.purpose })
    .from(redditPlaces)
    .where(eq(redditPlaces.subreddit, t.subreddit));
  if (place?.purpose === "karma") return null;
  const reply = !!t.target?.startsWith("t1_");
  const author = reply ? targetAuthor(t.targetText) : t.author;
  if (!author) return null;
  return recordTouch(db, {
    platform: "reddit",
    handle: author,
    kind: reply ? "reply" : "comment",
    direction: "ours",
    account: await accountName(db, t.accountId),
    url: t.url,
    link: threadLink(t),
    text: t.answer,
    at: t.answeredAt,
    externalId: t.answerRef,
    source: "reddit_threads",
    ref: `rt:${t.id}`,
  });
}

/**
 * Ours on someone's post: the comment, then the like and the follow that went with it. LinkedIn
 * keys them by profile URL (a company page keys as `company:<slug>`), else by name; X and
 * Instagram by username, YouTube by channel id. LinkedIn and X comments go out as our own page (`wren`), the rest as
 * the reading account. The comment's own id isn't returned, so replies to it aren't read yet.
 */
export async function touchesFromReachPost(db: Queryable, id: number) {
  const [p] = await db.select().from(reachPosts).where(eq(reachPosts.id, id));
  if (!p) return null;
  const handle = p.platform === "linkedin" ? p.authorUrl || p.author : p.handle || p.author;
  const base = { platform: p.platform, handle, name: p.author, direction: "ours" as const };
  const done: Array<{ created: boolean; linked: boolean } | null> = [];
  if (p.state === "commented" && p.comment && p.commentedAt)
    done.push(
      await recordTouch(db, {
        ...base,
        kind: "comment",
        account: p.platform === "linkedin" || p.platform === "x" ? OWN_ACCOUNT : p.account,
        url: p.url,
        text: p.comment,
        at: p.commentedAt,
        source: "reach_posts",
        ref: `rp:${p.id}`,
      }),
    );
  if (p.likedAt)
    done.push(
      await recordTouch(db, {
        ...base,
        kind: "like",
        account: p.account,
        url: p.url,
        at: p.likedAt,
        source: "reach_posts",
        ref: `rp:${p.id}:like`,
      }),
    );
  if (p.followedAt)
    done.push(
      await recordTouch(db, {
        ...base,
        kind: "follow",
        account: p.account,
        url: p.authorUrl,
        at: p.followedAt,
        source: "reach_posts",
        ref: `rp:${p.id}:follow`,
      }),
    );
  return { created: done.some((d) => d?.created), linked: done.some((d) => d?.linked) };
}

export interface TouchBackfill extends TurnTouchBackfill {
  threads: number;
  posts: number;
}

/**
 * Every outreach source row as touches: ours on threads and posts first, then the turn rows, so
 * a reply's parent is already a touch. Re-runs keep nothing twice. `dryRun` counts the rows.
 */
export async function backfillOutreachTouches(
  db: Queryable,
  o: { dryRun?: boolean; now?: Date } = {},
): Promise<TouchBackfill> {
  const threads = await db
    .select({
      id: redditThreads.id,
      url: redditThreads.url,
      target: redditThreads.target,
      answerRef: redditThreads.answerRef,
    })
    .from(redditThreads)
    .where(eq(redditThreads.state, "commented"))
    .orderBy(redditThreads.answeredAt);
  const posts = await db
    .select({ id: reachPosts.id })
    .from(reachPosts)
    .where(sql`state = 'commented' or liked_at is not null or followed_at is not null`)
    .orderBy(sql`coalesce(commented_at, liked_at, followed_at)`, reachPosts.id);
  if (o.dryRun) {
    const bare = await bareTouchRefs(db);
    const turn = await backfillTurnTouches(db, o);
    return {
      ...turn,
      threads: threads.length,
      posts: posts.length,
      links: turn.links + threads.filter((t) => bare.has(`rt:${t.id}`) && threadLink(t)).length,
    };
  }
  let links = 0;
  const made = { threads: 0, posts: 0 };
  const count = (t: { created: boolean; linked?: boolean } | null) => {
    if (t?.linked) links++;
    return t?.created ? 1 : 0;
  };
  for (const t of threads) made.threads += count(await touchFromThread(db, t.id));
  for (const p of posts) made.posts += count(await touchesFromReachPost(db, p.id));
  const turn = await backfillTurnTouches(db, {
    ...(o.now ? { now: o.now } : {}),
    warmupAnswer: karmaAnswer,
  });
  return { ...turn, ...made, links: turn.links + links };
}
