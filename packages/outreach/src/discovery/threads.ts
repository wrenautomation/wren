/**
 * Threads: new posts in watched places, filtered in code, ranked by a model, the day's best
 * queued with a researched draft in William's voice (designs/2026-10-06-reddit-discovery.md,
 * Threads and Research). He edits and clicks; it comments from the place's account under the
 * rung's cap, with the thread guard checked again at send. Two days on, the comment's score is
 * read back: the place's hit rate.
 */
import { warmupOf } from "@wren/channel-reddit";
import type { AccountHealth } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { ReachRefusal } from "../refusal.js";
import {
  comments,
  type PlaceJudged,
  type ReachAccount,
  type RedditPerson,
  type RedditThread,
  reachAccounts,
  redditPlaces,
  redditThreads,
  THREAD_KINDS,
} from "../schema.js";
import { personLine } from "./people.js";
import type { Audience } from "./places.js";
import type { Post } from "./reads.js";

const HOUR = 3_600_000;
/** Late comments sink: older or busier threads are dropped in code. */
export const MAX_AGE_MS = 24 * HOUR;
export const MAX_COMMENTS = 40;
/** A queued thread not answered by then has gone stale. */
const STALE_MS = 36 * HOUR;
/** Ranked at or above this fit goes to the queue. */
export const QUEUE_FIT = 6;
/** With no pool account yet, the queue still shows this many a day to read and learn from. */
const NO_ACCOUNT_CAP = 3;
/** A comment's score is read back after this long. */
export const SCORE_AFTER_MS = 48 * HOUR;

/** Why code drops a post, $0; null = it passes to the model. */
export function dropReason(
  p: Post,
  o: { now: Date; ours: readonly string[]; judged: PlaceJudged | null },
): string | null {
  const at = (p.created_utc ?? 0) * 1000;
  if (o.now.getTime() - at > MAX_AGE_MS) return "over a day old";
  if ((p.num_comments ?? 0) > MAX_COMMENTS) return `past ${MAX_COMMENTS} comments`;
  if (p.locked) return "locked";
  if (p.archived) return "archived";
  if (p.removed_by_category) return "removed";
  if (p.stickied) return "pinned by the mods";
  if (p.over_18) return "NSFW";
  if (p.author && o.ours.some((h) => h.toLowerCase() === p.author?.toLowerCase()))
    return "one of ours wrote it";
  if (o.judged && !o.judged.mayComment) return "the place's rules forbid our comments";
  return null;
}

/** Keep every new post raw; answers the ids that passed the code filter. */
export async function keepThreads(
  db: Queryable,
  sub: string,
  posts: readonly Post[],
  o: { now: Date; ours: readonly string[]; judged: PlaceJudged | null },
): Promise<string[]> {
  const rows = posts.flatMap((p) =>
    p.name && p.created_utc
      ? [
          {
            id: p.name,
            subreddit: sub,
            title: p.title ?? "",
            body: p.selftext ?? "",
            author: p.author ?? "[deleted]",
            url: `https://www.reddit.com${p.permalink ?? `/comments/${p.id}`}`,
            postedAt: new Date(p.created_utc * 1000),
            comments: p.num_comments ?? 0,
            raw: p as unknown as Record<string, unknown>,
            dropped: dropReason(p, o),
          },
        ]
      : [],
  );
  if (!rows.length) return [];
  const made = await db
    .insert(redditThreads)
    .values(rows.map((r) => ({ ...r, state: r.dropped ? ("dropped" as const) : ("new" as const) })))
    .onConflictDoNothing()
    .returning({ id: redditThreads.id, dropped: redditThreads.dropped });
  return made.filter((m) => !m.dropped).map((m) => m.id);
}

const RANK_SYSTEM = `You pick Reddit threads where we can add something useful in a comment. We \
are a one-person automation agency (outreach, content and browser automation for small \
businesses); our comments share concrete experience and never pitch. For each thread: kind (help: \
asks for help; tools: asks for tools; story: shares an experience; venting; hiring; other), fit \
0-10 (can we say something concrete from what we built or did, for someone like the audience), \
angle (one line: what we'd say). Answer JSON only: {"threads": [{"id": "...", "kind": "...", \
"fit": n, "angle": "..."}]}`;

const RANKED = z.object({
  threads: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(THREAD_KINDS).catch("other"),
      fit: z.number().min(0).max(10),
      angle: z.string(),
    }),
  ),
});

export const RANK_BATCH = 10;

/** Rank up to RANK_BATCH new threads in one model call. Answers how many it ranked. */
export async function rankThreads(
  db: Queryable,
  llm: LlmClient,
  ids: readonly string[],
  audience: Audience,
): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db
    .select()
    .from(redditThreads)
    .where(and(inArray(redditThreads.id, [...ids]), eq(redditThreads.state, "new")));
  if (!rows.length) return 0;
  const out = await completeAndParse(
    llm,
    `Audience: ${audience.about}\n\n${rows
      .map(
        (t) =>
          `id: ${t.id}\nr/${t.subreddit} · ${t.comments} comments\n${t.title}\n${t.body.replace(/\s+/g, " ").slice(0, 600)}`,
      )
      .join("\n\n---\n\n")}`,
    RANKED,
    { maxTokens: 120 * rows.length, system: RANK_SYSTEM, name: "reddit.rank" },
  );
  if (!out.parsed) return 0;
  let n = 0;
  for (const r of out.parsed.threads) {
    if (!rows.some((t) => t.id === r.id)) continue;
    await db
      .update(redditThreads)
      .set({
        kind: r.kind,
        fit: Math.round(r.fit),
        angle: r.angle.replace(/\s+/g, " ").trim().slice(0, 300),
        state: "ranked",
      })
      .where(and(eq(redditThreads.id, r.id), eq(redditThreads.state, "new")));
    n++;
  }
  return n;
}

const dayStart = (now: Date) => new Date(now.toISOString().slice(0, 10));

/** Comments this account sent today (UTC day): answers under ours and new threads alike. */
export async function commentsToday(db: Queryable, accountId: string, now: Date): Promise<number> {
  const day = dayStart(now);
  const [a] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.accountId, accountId), gte(comments.answeredAt, day)));
  const [b] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(redditThreads)
    .where(and(eq(redditThreads.accountId, accountId), gte(redditThreads.answeredAt, day)));
  return (a?.n ?? 0) + (b?.n ?? 0);
}

async function accountById(db: Queryable, id: string | null): Promise<ReachAccount | null> {
  if (!id) return null;
  const [a] = await db.select().from(reachAccounts).where(eq(reachAccounts.id, id));
  return a ?? null;
}

const capOf = (a: ReachAccount | null, now: Date) =>
  a?.health ? warmupOf(a.health as AccountHealth, now).caps.comments : a ? 0 : NO_ACCOUNT_CAP;

/**
 * Move the place's best ranked threads to the queue, up to its account's comment cap for the day
 * (counting what's queued or sent today). Queued threads past a day and a half go stale.
 */
export async function queueThreads(db: Queryable, sub: string, now: Date): Promise<string[]> {
  await db
    .update(redditThreads)
    .set({ state: "skipped", dropped: "went stale" })
    .where(
      and(
        eq(redditThreads.subreddit, sub),
        eq(redditThreads.state, "queued"),
        lt(redditThreads.postedAt, new Date(now.getTime() - STALE_MS)),
      ),
    );
  const [place] = await db.select().from(redditPlaces).where(eq(redditPlaces.subreddit, sub));
  if (place?.state !== "watching") return [];
  const account = await accountById(db, place.accountId);
  const [q] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(redditThreads)
    .where(
      and(
        eq(redditThreads.subreddit, sub),
        inArray(redditThreads.state, ["queued", "commented"]),
        gte(redditThreads.createdAt, dayStart(now)),
      ),
    );
  const room = capOf(account, now) - (q?.n ?? 0);
  if (room <= 0) return [];
  const best = await db
    .select({ id: redditThreads.id })
    .from(redditThreads)
    .where(
      and(
        eq(redditThreads.subreddit, sub),
        eq(redditThreads.state, "ranked"),
        gte(redditThreads.fit, QUEUE_FIT),
        gte(redditThreads.postedAt, new Date(now.getTime() - MAX_AGE_MS)),
      ),
    )
    .orderBy(desc(redditThreads.fit), desc(redditThreads.postedAt))
    .limit(room);
  if (!best.length) return [];
  const ids = best.map((b) => b.id);
  await db
    .update(redditThreads)
    .set({ state: "queued", accountId: place.accountId })
    .where(inArray(redditThreads.id, ids));
  return ids;
}

/** Queued threads with no draft yet, best first. */
export async function threadsToDraft(db: Queryable, limit: number) {
  return db
    .select({ id: redditThreads.id, author: redditThreads.author })
    .from(redditThreads)
    .where(and(eq(redditThreads.state, "queued"), isNull(redditThreads.draft)))
    .orderBy(desc(redditThreads.fit))
    .limit(limit);
}

/** Our own facts for a thread: the SOPs sharing the most words with it ($0). */
export function factsFor(
  words: string,
  facts: readonly { label: string; text: string }[],
  n = 2,
): { label: string; text: string }[] {
  const bag = (s: string) => new Set(s.toLowerCase().match(/[a-z]{5,}/g) ?? []);
  const want = bag(words);
  return facts
    .map((f) => ({ f, hits: [...bag(f.text)].filter((w) => want.has(w)).length }))
    .filter((x) => x.hits >= 3)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, n)
    .map((x) => ({ label: x.f.label, text: x.f.text.slice(0, 1500) }));
}

export interface ThreadRead {
  post: Post;
  comments: Array<{ name: string; author?: string; body?: string; depth: number; score?: number }>;
}

const DRAFT_SYSTEM = (voice: string) => `You write one Reddit comment for William, who runs a \
one-person automation agency. He edits it before it goes. Reddit rules: no links, no pitch, no \
"DM me", at most 4 sentences, concrete (what he built, what broke, a number), adds something the \
thread doesn't already say. Pick what to answer: the post itself, or one top-level comment in it \
that asks the question better. His voice:\n${voice}\nAnswer JSON only: {"target": "<the post id \
or a comment id from the list>", "comment": "<the comment>"}`;

const DRAFT = z.object({ target: z.string(), comment: z.string() });

/** The draft, from the whole thread, the OP and our facts; sources kept beside it. */
export async function draftThread(
  db: Queryable,
  llm: LlmClient,
  id: string,
  o: {
    read: ThreadRead;
    op: RedditPerson | null;
    facts: readonly { label: string; text: string }[];
    voice: string;
    ours: readonly string[];
  },
): Promise<"drafted" | "dropped" | "unread"> {
  const [t] = await db.select().from(redditThreads).where(eq(redditThreads.id, id));
  if (t?.state !== "queued") return "unread";
  // The thread guard: one of ours already wrote here.
  const met = o.read.comments.find((c) =>
    o.ours.some((h) => h.toLowerCase() === c.author?.toLowerCase()),
  );
  if (met) {
    await db
      .update(redditThreads)
      .set({ state: "dropped", dropped: `u/${met.author} already wrote in it` })
      .where(eq(redditThreads.id, id));
    return "dropped";
  }
  const top = o.read.comments.filter((c) => c.depth === 0).slice(0, 15);
  const said = o.read.comments
    .slice(0, 40)
    .map(
      (c) =>
        `${"  ".repeat(c.depth)}[${c.name}] u/${c.author}: ${(c.body ?? "").replace(/\s+/g, " ").slice(0, 300)}`,
    )
    .join("\n");
  const ours = factsFor(`${t.title} ${t.body} ${said}`, o.facts);
  const opLine = o.op ? personLine(o.op) : null;
  const out = await completeAndParse(
    llm,
    `Post ${t.id} in r/${t.subreddit} by u/${t.author}${opLine ? ` (${opLine})` : ""}:\n${t.title}\n${t.body.slice(0, 2000)}\n\nAngle: ${t.angle ?? "-"}\n\nComments so far:\n${said || "(none)"}\n\n${ours.map((f) => `Our notes, ${f.label}:\n${f.text}`).join("\n\n")}`,
    DRAFT,
    { maxTokens: 400, system: DRAFT_SYSTEM(o.voice), name: "reddit.draft" },
  );
  if (!out.parsed) return "unread";
  const target = top.find((c) => c.name === out.parsed?.target);
  const sources = [
    { label: "Thread", text: `${t.title}\n${o.read.comments.length} comments read` },
    ...(opLine ? [{ label: `u/${t.author}`, text: opLine }] : []),
    ...ours.map((f) => ({ label: f.label, text: f.text.slice(0, 300) })),
  ];
  await db
    .update(redditThreads)
    .set({
      draft: out.parsed.comment.trim(),
      target: target?.name ?? t.id,
      targetText: target ? `u/${target.author}: ${target.body ?? ""}` : null,
      sources,
    })
    .where(eq(redditThreads.id, id));
  return "drafted";
}

export interface CommentPlan {
  thread: RedditThread;
  account: ReachAccount;
  others: string[];
}

/** Everything that refuses a comment before Reddit is asked. */
export async function planThreadComment(
  db: Queryable,
  id: string,
  now: Date,
): Promise<CommentPlan> {
  const [thread] = await db.select().from(redditThreads).where(eq(redditThreads.id, id));
  if (!thread) throw new ReachRefusal(`no thread ${id}`);
  if (thread.state === "commented") throw new ReachRefusal("already commented");
  if (thread.state !== "queued") throw new ReachRefusal(`that thread is ${thread.state}`);
  const [place] = await db
    .select({ accountId: redditPlaces.accountId })
    .from(redditPlaces)
    .where(eq(redditPlaces.subreddit, thread.subreddit));
  const account = await accountById(db, place?.accountId ?? thread.accountId);
  if (!account)
    throw new ReachRefusal(`r/${thread.subreddit} has no account yet: pick one on Places`);
  if (account.state === "paused" || account.state === "retired")
    throw new ReachRefusal(`${account.account} is ${account.state}`);
  if (account.health) {
    const w = warmupOf(account.health as AccountHealth, now);
    if (w.frozen) throw new ReachRefusal(`${account.account}: ${w.frozen}`);
    if ((await commentsToday(db, account.id, now)) >= w.caps.comments)
      throw new ReachRefusal(
        `${account.account} is at ${w.stage}: ${w.caps.comments} comments a day${w.next ? ` (${w.next})` : ""}`,
      );
  }
  const all = await db
    .select({ handle: reachAccounts.handle })
    .from(reachAccounts)
    .where(eq(reachAccounts.platform, "reddit"));
  return { thread, account, others: all.flatMap((r) => (r.handle ? [r.handle] : [])) };
}

export async function markCommented(
  db: Queryable,
  id: string,
  r: { body: string; ref: string | null; accountId: string; now: Date },
): Promise<void> {
  await db
    .update(redditThreads)
    .set({
      state: "commented",
      answer: r.body,
      answerRef: r.ref,
      answeredAt: r.now,
      accountId: r.accountId,
    })
    .where(eq(redditThreads.id, id));
}

export async function skipThread(db: Queryable, id: string): Promise<void> {
  await db
    .update(redditThreads)
    .set({ state: "skipped" })
    .where(
      and(eq(redditThreads.id, id), inArray(redditThreads.state, ["new", "ranked", "queued"])),
    );
}

/** Our comments two days old with no score yet. */
export async function threadsToScore(db: Queryable, now: Date, limit = 50) {
  return db
    .select({ id: redditThreads.id, ref: redditThreads.answerRef })
    .from(redditThreads)
    .where(
      and(
        eq(redditThreads.state, "commented"),
        isNotNull(redditThreads.answerRef),
        isNull(redditThreads.scoredAt),
        lt(redditThreads.answeredAt, new Date(now.getTime() - SCORE_AFTER_MS)),
      ),
    )
    .limit(limit);
}

export async function keepScores(
  db: Queryable,
  scores: readonly { ref: string; score: number }[],
  now: Date,
): Promise<void> {
  for (const s of scores)
    await db
      .update(redditThreads)
      .set({ score: s.score, scoredAt: now })
      .where(eq(redditThreads.answerRef, s.ref));
}
