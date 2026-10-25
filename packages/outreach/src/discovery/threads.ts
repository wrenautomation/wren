/**
 * Threads: new posts in watched places, filtered in code, ranked by a model, the day's best
 * queued with a researched draft in William's voice (designs/2026-10-06-reddit-discovery.md,
 * Threads and Research). He edits and clicks; it comments from the place's account under the
 * rung's cap, with the thread guard checked again at send. Two days on, the comment's score is
 * read back: the place's hit rate.
 *
 * Karma places (designs/2026-10-18-reddit-karma.md) run the same steps for young threads with few
 * comments, where an early plain answer earns the votes: their own rank and draft prompts, no
 * facts of ours, and never a word about Wren or a link.
 */
import { REACH_FULL_KARMA, warmupOf } from "@wren/channel-reddit";
import { editsFor } from "@wren/core/ask";
import { llmOf, type RejectReason, recordDraft } from "@wren/core/draft-record";
import { factsBlock, humanBlock } from "@wren/core/facts";
import { droppedWhy, guardDraft, recordGuard } from "@wren/core/grounded";
import { CanonError, canonRef, resolveObject, resolveObjects } from "@wren/core/objects";
import {
  COMMENT_RULE,
  cleanComment,
  type OurPost,
  ourPostsBlock,
  plainComment,
  postsFor,
} from "@wren/core/our-posts";
import type { AccountHealth } from "@wren/core/outreach";
import { modelDrafts } from "@wren/core/reply-drafts";
import { whereSent } from "@wren/core/sent-url";
import { wallClock, zonedInstant } from "@wren/core/time";
import { atomic, type Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { pickedReachAccount } from "../draft-accounts.js";
import { armMeta, guardBy, modelFor } from "../draft-llm.js";
import { COMMENT_KINDS_LEARNED, examplesFor } from "../examples.js";
import { ZONE } from "../pacing.js";
import { passedOn, passKey } from "../passes.js";
import { ReachRefusal } from "../refusal.js";
import {
  comments,
  type PlaceJudged,
  type PlacePurpose,
  type ReachAccount,
  type RedditPerson,
  type RedditThread,
  reachAccounts,
  redditPlaces,
  redditThreads,
  THREAD_KINDS,
} from "../schema.js";
import { keepTouch, touchFromThread } from "../touches.js";
import { personLine } from "./people.js";
import type { Audience } from "./places.js";
import type { Post } from "./reads.js";
import { gatesFor, holdsThread, ThreadHeld } from "./requirements.js";

const HOUR = 3_600_000;
/** Late comments sink: older or busier threads are dropped in code. */
const MAX_AGE_MS = 24 * HOUR;
const MAX_COMMENTS = 40;
/** A queued thread not answered by then has gone stale. */
const STALE_MS = 36 * HOUR;
/** How long after a thread is posted a drafted comment may still take a send slot: the whole drafted queue goes out under the cap. */
export const SLOT_WITHIN_MS = 14 * 24 * HOUR;
/** Ranked at or above this fit goes to the queue. */
const QUEUE_FIT = 6;
/** With no pool account yet, the queue still shows this many a day to read and learn from. */
const NO_ACCOUNT_CAP = 3;
/** A comment's score is read back after this long. */
const SCORE_AFTER_MS = 48 * HOUR;
/**
 * A karma place's thread earns votes only early: past this age it is dropped, never queued, never
 * slotted, and a queued one goes stale.
 */
export const KARMA_FRESH_MS = 6 * HOUR;
/** A karma place's thread with more comments than this is already answered. */
const KARMA_MAX_COMMENTS = 15;

/** Karma places, as a condition on a thread's subreddit. */
// Qualified by hand: Drizzle leaves column names bare in a select list, and a bare "subreddit"
// inside the subquery would name the place's own column.
export const inKarmaPlace = sql<boolean>`exists (select 1 from reddit_places kp where kp.subreddit = reddit_threads.subreddit and kp.purpose = 'karma')`;

/** Why code drops a post, $0; null = it passes to the model. */
export function dropReason(
  p: Post,
  o: { now: Date; ours: readonly string[]; judged: PlaceJudged | null; purpose?: PlacePurpose },
): string | null {
  const at = (p.created_utc ?? 0) * 1000;
  const karma = o.purpose === "karma";
  if (karma && o.now.getTime() - at > KARMA_FRESH_MS) return "too old to earn karma";
  if (o.now.getTime() - at > MAX_AGE_MS) return "over a day old";
  const most = karma ? KARMA_MAX_COMMENTS : MAX_COMMENTS;
  if ((p.num_comments ?? 0) > most) return `past ${most} comments`;
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

/** A Reddit post's fullname, or null for a name no rule reads. */
function postRefOf(name: string | undefined): string | null {
  if (!name) return null;
  try {
    return canonRef("reddit", "post", name);
  } catch {
    return null;
  }
}

/**
 * Keep every new post raw; answers the ids that passed the code filter. Each post is a platform
 * object first (`resolveObjects`: three statements for the whole pass), and its row keeps the ref
 * that comes back.
 */
export async function keepThreads(
  db: Queryable,
  sub: string,
  posts: readonly Post[],
  o: { now: Date; ours: readonly string[]; judged: PlaceJudged | null; purpose?: PlacePurpose },
): Promise<string[]> {
  const passed = await passedOn(db, "reddit");
  const rows = posts.flatMap((p) => {
    const id = postRefOf(p.name);
    return id && p.created_utc
      ? [
          {
            id,
            subreddit: sub,
            title: p.title ?? "",
            body: p.selftext ?? "",
            author: p.author ?? "[deleted]",
            url: `https://www.reddit.com${p.permalink ?? `/comments/${p.id}`}`,
            postedAt: new Date(p.created_utc * 1000),
            comments: p.num_comments ?? 0,
            raw: p as unknown as Record<string, unknown>,
            dropped: passed.has(passKey(null, p.author ?? ""))
              ? "you passed on them"
              : dropReason(p, o),
          },
        ]
      : [];
  });
  if (!rows.length) return [];
  return atomic(db, async (tx) => {
    const refs = await resolveObjects(
      tx,
      rows.map((r) => ({
        platform: "reddit" as const,
        kind: "post" as const,
        raw: r.id,
        url: r.url,
        author: r.author === "[deleted]" ? null : r.author,
        at: r.postedAt,
      })),
    );
    const made = await tx
      .insert(redditThreads)
      .values(
        rows.map((r) => ({
          ...r,
          id: refs.get(r.id) ?? r.id,
          state: r.dropped ? ("dropped" as const) : ("new" as const),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: redditThreads.id, dropped: redditThreads.dropped });
    return made.filter((m) => !m.dropped).map((m) => m.id);
  });
}

const RANK_SYSTEM = `You pick Reddit threads where we can add something useful in a comment. We \
are a one-person automation agency (outreach, content and browser automation for small \
businesses); our comments share concrete experience and never pitch. For each thread: kind (help: \
asks for help; tools: asks for tools; story: shares an experience; venting; hiring; other), fit \
0-10 (can we say something concrete from what we built or did, for someone like the audience), \
angle (one line: what we'd say). Answer JSON only: {"threads": [{"id": "...", "kind": "...", \
"fit": n, "angle": "..."}]}`;

/** Karma places: a short plain answer, early, where it earns votes. No audience, no work of ours. */
const KARMA_RANK_SYSTEM = `You pick Reddit threads in large general subreddits where one short, \
plain, helpful answer can earn upvotes. For each thread: kind (help: asks for help; tools: asks \
for tools; story: shares an experience; venting; hiring; other), fit 0-10 (a real question a \
short answer from common knowledge settles; young with few comments is higher; medical, legal, \
money or deeply personal questions are 0), angle (one line: the answer). Answer JSON only: \
{"threads": [{"id": "...", "kind": "...", "fit": n, "angle": "..."}]}`;

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
/** Unranked threads one pass ranks per place, oldest first. */
const RANK_PER_PLACE = 30;

/**
 * A place's threads still waiting on a rank: this pass's and any an earlier rank left out (the
 * model skipped it, or its answer didn't parse), so none sits unranked for good.
 */
export async function unrankedThreads(
  db: Queryable,
  sub: string,
  purpose: PlacePurpose = "reach",
): Promise<string[]> {
  // A karma place ranks its newest first: an old one has lost its chance anyway.
  const rows = await db
    .select({ id: redditThreads.id })
    .from(redditThreads)
    .where(and(eq(redditThreads.subreddit, sub), eq(redditThreads.state, "new")))
    .orderBy(purpose === "karma" ? desc(redditThreads.postedAt) : asc(redditThreads.postedAt))
    .limit(RANK_PER_PLACE);
  return rows.map((r) => r.id);
}

/** Rank up to RANK_BATCH new threads in one model call. Answers how many it ranked. */
export async function rankThreads(
  db: Queryable,
  llm: LlmClient,
  ids: readonly string[],
  audience: Audience,
  purpose: PlacePurpose = "reach",
): Promise<number> {
  if (!ids.length) return 0;
  const karma = purpose === "karma";
  const rows = await db
    .select()
    .from(redditThreads)
    .where(and(inArray(redditThreads.id, [...ids]), eq(redditThreads.state, "new")));
  if (!rows.length) return 0;
  const out = await completeAndParse(
    llm,
    `${karma ? "" : `Audience: ${audience.about}\n\n`}${rows
      .map(
        (t) =>
          `id: ${t.id}\nr/${t.subreddit} · ${t.comments} comments\n${t.title}\n${t.body.replace(/\s+/g, " ").slice(0, 600)}`,
      )
      .join("\n\n---\n\n")}`,
    RANKED,
    {
      maxTokens: 120 * rows.length,
      system: karma ? KARMA_RANK_SYSTEM : RANK_SYSTEM,
      name: "reddit.rank",
    },
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
        angle: r.angle.replace(/\s+/g, " ").trim().slice(0, 3000),
        state: "ranked",
      })
      .where(and(eq(redditThreads.id, r.id), eq(redditThreads.state, "new")));
    n++;
  }
  return n;
}

/** Midnight of the lane's day (`pacing.ts` ZONE): the day the slots and the caps count. */
export const dayStart = (now: Date): Date => {
  const w = wallClock(ZONE, now);
  return zonedInstant(ZONE, w.year, w.month, w.day);
};

/** Comments this account sent today (the lane's day): answers under ours and new threads alike. */
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

/** Thread comments of one account queued, or sent today, by the purpose of their place. */
interface PlaceUse {
  karma: number;
  reach: number;
}

/**
 * Room for one more thread of a purpose in the account's day. Reach places take at most their
 * share (`reachComments`); karma places the rest, and what reach leaves. A reach backlog past its
 * share never takes karma's room.
 */
export function roomFor(
  purpose: PlacePurpose,
  caps: { comments: number; reachComments: number },
  used: PlaceUse,
): number {
  if (purpose === "karma")
    return caps.comments - used.karma - Math.min(used.reach, caps.reachComments);
  return Math.min(caps.comments - used.karma - used.reach, caps.reachComments - used.reach);
}

/** Reach-place thread comments this account sent today: what the reach share counts at send. */
async function reachCommentsToday(db: Queryable, accountId: string, now: Date): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(redditThreads)
    .where(
      and(
        eq(redditThreads.accountId, accountId),
        gte(redditThreads.answeredAt, dayStart(now)),
        sql`not ${inKarmaPlace}`,
      ),
    );
  return r?.n ?? 0;
}

async function accountById(db: Queryable, id: string | null): Promise<ReachAccount | null> {
  if (!id) return null;
  const [a] = await db.select().from(reachAccounts).where(eq(reachAccounts.id, id));
  return a ?? null;
}

const capsOf = (a: ReachAccount, now: Date) =>
  a.health
    ? warmupOf(a.health as AccountHealth, now).caps
    : { comments: 0, reachComments: 0, posts: 0, messages: 0 };

/**
 * Threads past a day and a half that never got a send time go stale, in every sub, each pass: a
 * sub not read again must not keep its queue forever. A karma place's go stale past
 * `KARMA_FRESH_MS`.
 */
export async function expireStale(db: Queryable, now: Date): Promise<number> {
  const gone = await db
    .update(redditThreads)
    .set({ state: "skipped", dropped: "went stale" })
    .where(
      and(
        inArray(redditThreads.state, ["new", "queued"]),
        isNull(redditThreads.sendAt),
        or(
          lt(redditThreads.postedAt, new Date(now.getTime() - STALE_MS)),
          and(lt(redditThreads.postedAt, new Date(now.getTime() - KARMA_FRESH_MS)), inKarmaPlace),
        ),
      ),
    )
    .returning({ id: redditThreads.id });
  return gone.length;
}

/**
 * Move the place's best ranked threads to the queue. With an account, the queue holds at most
 * its comment cap for the day across every sub it works (queued, plus what it sent today), so
 * eight subs never queue eight caps; the cap rises as its warm-up rung does. Reach places take at
 * most the rung's reach share of it, karma places the rest (`roomFor`). With none, each sub
 * shows a few a day to read.
 */
export async function queueThreads(db: Queryable, sub: string, now: Date): Promise<string[]> {
  await expireStale(db, now);
  const [place] = await db.select().from(redditPlaces).where(eq(redditPlaces.subreddit, sub));
  if (place?.state !== "watching") return [];
  const account = await accountById(db, place.accountId);
  const karma = place.purpose === "karma";
  // A karma sub that removed our last comment without a word: nothing more queues there. Its
  // drafts go out on their own (nobody clears a karma hold), so each would only sit held and
  // spend the day's karma room; the other karma subs take it instead.
  if (karma && (await gatesFor(db, [sub], now)).get(sub)?.hold) return [];
  const [q] = await db
    .select({
      n: sql<number>`count(*)::int`,
      karma: sql<number>`(count(*) filter (where ${inKarmaPlace}))::int`,
    })
    .from(redditThreads)
    .where(
      account
        ? and(
            eq(redditThreads.accountId, account.id),
            or(
              eq(redditThreads.state, "queued"),
              and(
                eq(redditThreads.state, "commented"),
                gte(redditThreads.answeredAt, dayStart(now)),
              ),
            ),
          )
        : and(
            eq(redditThreads.subreddit, sub),
            inArray(redditThreads.state, ["queued", "commented"]),
            gte(redditThreads.createdAt, dayStart(now)),
          ),
    );
  const used = { karma: q?.karma ?? 0, reach: (q?.n ?? 0) - (q?.karma ?? 0) };
  const room = account
    ? roomFor(place.purpose, capsOf(account, now), used)
    : NO_ACCOUNT_CAP - (q?.n ?? 0);
  if (room <= 0) return [];
  const best = await db
    .select({ id: redditThreads.id })
    .from(redditThreads)
    .where(
      and(
        eq(redditThreads.subreddit, sub),
        eq(redditThreads.state, "ranked"),
        gte(redditThreads.fit, QUEUE_FIT),
        gte(
          redditThreads.postedAt,
          new Date(now.getTime() - (karma ? KARMA_FRESH_MS : MAX_AGE_MS)),
        ),
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

/**
 * Queued threads with no draft yet and still fresh, karma places first (they go stale in hours),
 * then best first; none when he writes replies himself.
 */
export async function threadsToDraft(db: Queryable, limit: number, now = new Date()) {
  if (!(await modelDrafts(db))) return [];
  return db
    .select({
      id: redditThreads.id,
      author: redditThreads.author,
      accountId: redditThreads.accountId,
      karma: sql<boolean>`${inKarmaPlace}`,
    })
    .from(redditThreads)
    .where(
      and(
        eq(redditThreads.state, "queued"),
        isNull(redditThreads.draft),
        gt(redditThreads.postedAt, new Date(now.getTime() - STALE_MS)),
        or(
          sql`not ${inKarmaPlace}`,
          gt(redditThreads.postedAt, new Date(now.getTime() - KARMA_FRESH_MS)),
        ),
      ),
    )
    .orderBy(desc(inKarmaPlace), desc(redditThreads.fit))
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

const DRAFT_SYSTEM = (voice: string, truths: readonly string[]) => `You write one Reddit comment \
for William, who runs a one-person automation agency. ${COMMENT_RULE} Reddit rules: no links, no \
pitch, no "DM me", at most 4 sentences, adds something the thread doesn't already say. Pick what \
to answer: the post itself, or one top-level comment in it that asks the question \
better. Our notes are how we work, not stories to retell as his.\n${factsBlock(truths)}\n${humanBlock()}\nHis \
voice:\n${voice}\nAnswer JSON only: {"target": "<the post id or a comment id from the list>", \
"comment": "<the comment>"}`;

/**
 * A karma place's comment: a plain answer from one person. No facts of ours, no posts, nothing
 * first-person, never Wren or a link.
 */
const KARMA_DRAFT_SYSTEM = (voice: string) => `You write one short Reddit comment for William in \
a large general subreddit. Answer the question plainly and helpfully, like one person who knows. \
Open with the answer. One concrete thing beats three general ones. Rules: no links, no pitch, \
never name Wren, his business or his work, no "DM me", at most 3 sentences, adds something the \
thread doesn't already say. No dashes. Sound like a text, not a post. Pick what to answer: the \
post itself, or one top-level comment in it that asks the question better.\n${factsBlock([])}\n${humanBlock()}\n\
His voice:\n${voice}\nAnswer JSON only: {"target": "<the post id or a comment id from the list>", \
"comment": "<the comment>"}`;

const PITCH = /\bwren\b|https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|io|ai|net|org|co)\b|\bdm me\b/i;

/** What a karma comment must not carry: Wren, a link or a "DM me". Null = clean. */
export function pitchIn(text: string): string | null {
  const m = PITCH.exec(text);
  return m ? `"${m[0]}"` : null;
}

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
    /** What is true about the writer (`wrenFacts`); none, and it claims nothing first-person. */
    truths?: readonly string[];
    voice: string;
    ours: readonly string[];
    /** What we've posted; the thread draws on the closest few. */
    posts?: readonly OurPost[];
    /** A karma place's thread: the karma prompt, no facts or posts of ours, no pitch. */
    karma?: boolean;
  },
): Promise<"drafted" | "dropped" | "unread"> {
  const karma = o.karma === true;
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
  const ours = karma ? [] : factsFor(`${t.title} ${t.body} ${said}`, o.facts);
  const posts = karma ? [] : postsFor(`${t.title} ${t.body}`, o.posts ?? []);
  const opLine = o.op ? personLine(o.op) : null;
  // His last 5 edits of thread comments (content desk, 6), then his yeses and nos closest to it.
  const edits = [
    await editsFor(db, ["thread"]),
    await examplesFor(db, COMMENT_KINDS_LEARNED, `${t.title} ${t.body}`),
  ]
    .filter(Boolean)
    .join("\n\n");
  // A karma comment claims nothing first-person: no truths, so the guard flags any claim.
  const truths = karma ? [] : (o.truths ?? []);
  const picked = await modelFor(llm, `thread:${id}`);
  const prompt = `Post ${t.id} in r/${t.subreddit} by u/${t.author}${opLine ? ` (${opLine})` : ""}:\n${t.title}\n${t.body.slice(0, 2000)}\n\nAngle: ${t.angle ?? "-"}\n\nComments so far:\n${said || "(none)"}\n\n${ours.map((f) => `Our notes, ${f.label}:\n${f.text}`).join("\n\n")}${posts.length ? `\n\n${ourPostsBlock(posts)}` : ""}`;
  const base = karma ? KARMA_DRAFT_SYSTEM(o.voice) : DRAFT_SYSTEM(o.voice, truths);
  const system = edits ? `${base}\n\n${edits}` : base;
  const ask = async (note: string | null) => {
    const out = await completeAndParse(picked.llm, note ? `${prompt}\n\n${note}` : prompt, DRAFT, {
      maxTokens: 400,
      system,
      name: "reddit.draft",
    });
    return { text: cleanComment(out.parsed?.comment ?? ""), result: out };
  };
  // A karma comment that names Wren or links is asked once more without it.
  const asked = async (note: string | null) => {
    const a = await ask(note);
    const pitch = karma ? pitchIn(a.text) : null;
    if (!pitch) return a;
    return ask(`${note ? `${note}\n` : ""}Cut ${pitch}: no links, never name Wren or his work.`);
  };
  // Numbers may come from the thread or our notes; a first-person claim only from the truths.
  const g = await guardDraft((fix) => plainComment(asked, fix), {
    facts: truths,
    sources: [prompt],
  });
  await recordGuard(db, "reddit.draft", `thread:${id}`, g, guardBy(picked));
  const out = g.result;
  const pitch = karma && g.text ? pitchIn(g.text) : null;
  if (g.text === null || pitch) {
    await db
      .update(redditThreads)
      .set({
        state: "dropped",
        dropped: pitch ? `a karma comment carried ${pitch}` : droppedWhy(g),
      })
      .where(eq(redditThreads.id, id));
    return "dropped";
  }
  if (!out.parsed) return "unread";
  const target = top.find((c) => c.name === out.parsed?.target);
  const sources = [
    { label: "Thread", text: `${t.title}\n${o.read.comments.length} comments read` },
    ...(opLine ? [{ label: `u/${t.author}`, text: opLine }] : []),
    ...ours.map((f) => ({ label: f.label, text: f.text.slice(0, 300) })),
  ];
  // The comment we answer is a platform object (a top-level one: its parent is the post). A name
  // no rule reads falls back to the post, which the thread row already names.
  const targetRef = await atomic(db, async (tx) => {
    const ref = target ? await commentRefOf(tx, t.id, target) : t.id;
    await tx
      .update(redditThreads)
      .set({
        draft: g.text,
        target: ref,
        targetText: target ? `u/${target.author}: ${target.body ?? ""}` : null,
        sources,
      })
      .where(eq(redditThreads.id, id));
    return ref;
  });
  await recordDraft(db, {
    item: `thread:${id}`,
    kind: "thread",
    platform: "reddit",
    event: "generated",
    via: "model",
    by: picked.llm.name,
    text: g.text,
    llm: llmOf(out, "reddit.draft", { target: targetRef }),
    runId: out.call?.run_id ?? null,
    meta: armMeta(picked.arm),
  });
  return "drafted";
}

/**
 * A top-level comment in a thread as a platform object: the ref the row keeps. Falls back to the
 * thread's own post for a name no rule reads, so the key never fails on a model's pick.
 */
async function commentRefOf(
  tx: Queryable,
  post: string,
  c: { name: string; author?: string },
): Promise<string> {
  try {
    return await resolveObject(tx, {
      platform: "reddit",
      kind: "comment",
      raw: c.name,
      post,
      parent: post,
      author: c.author && c.author !== "[deleted]" ? c.author : null,
    });
  } catch (e) {
    if (e instanceof CanonError) return post;
    throw e;
  }
}

interface CommentPlan {
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
  // The sub's own floor (karma, age, an unknown gate): held, not dropped. Another account that
  // qualifies sends instead.
  const gate = (await gatesFor(db, [thread.subreddit], now)).get(thread.subreddit);
  // A person's pick goes out as picked: its karma or age shortfall was warned on the picker. A
  // sub that removed our last comment without saying why still holds every account.
  const picked = await pickedReachAccount(db, `thread:${id}`);
  if (holdsThread(gate, Boolean(picked)))
    throw new ThreadHeld(gate?.reason ?? `r/${thread.subreddit} is held`);
  const account =
    picked ?? (await accountById(db, gate?.accountId ?? place?.accountId ?? thread.accountId));
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
    // Under 50 karma, reach places take at most the share; the comment waits for the next day.
    const [kind] = await db
      .select({ purpose: redditPlaces.purpose })
      .from(redditPlaces)
      .where(eq(redditPlaces.subreddit, thread.subreddit));
    if (
      kind?.purpose !== "karma" &&
      (await reachCommentsToday(db, account.id, now)) >= w.caps.reachComments
    )
      throw new ThreadHeld(
        `${account.account} sends ${w.caps.reachComments} business comments a day until ${REACH_FULL_KARMA} karma (has ${w.karma})`,
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
  r: { body: string; ref: string | null; accountId: string; now: Date; by?: string },
): Promise<void> {
  // Our reply is a platform object before its ref lands on the row, in the same transaction: a
  // key that fails cannot fail after the send. A ref no rule reads (the send answered something
  // odd) is kept on the send ledger and the draft record, not here.
  const { t, answerRef } = await atomic(db, async (tx) => {
    const [thread] = await tx
      .select({ target: redditThreads.target })
      .from(redditThreads)
      .where(eq(redditThreads.id, id));
    let ref: string | null = null;
    if (r.ref) {
      try {
        ref = await resolveObject(tx, {
          platform: "reddit",
          kind: "comment",
          raw: r.ref,
          post: id,
          parent: thread?.target ?? id,
          at: r.now,
        });
      } catch (e) {
        if (!(e instanceof CanonError)) throw e;
      }
    }
    const [row] = await tx
      .update(redditThreads)
      .set({
        state: "commented",
        answer: r.body,
        answerRef: ref,
        answeredAt: r.now,
        accountId: r.accountId,
      })
      .where(eq(redditThreads.id, id))
      .returning({ url: redditThreads.url });
    return { t: row, answerRef: ref };
  });
  await keepTouch(`rt:${id}`, () => touchFromThread(db, id));
  await recordDraft(db, {
    item: `thread:${id}`,
    kind: "thread",
    platform: "reddit",
    event: "sent",
    via: "person",
    by: r.by ?? null,
    text: r.body,
    externalId: answerRef ?? r.ref,
    url: whereSent("reddit", t?.url ?? null, r.ref),
    ref: `sent:thread:${id}`,
  });
}

export async function skipThread(
  db: Queryable,
  id: string,
  o: { by?: string; reason?: RejectReason | null; note?: string | null } = {},
): Promise<void> {
  const [t] = await db
    .update(redditThreads)
    .set({ state: "skipped" })
    .where(and(eq(redditThreads.id, id), inArray(redditThreads.state, ["new", "ranked", "queued"])))
    .returning({ draft: redditThreads.draft });
  if (t?.draft)
    await recordDraft(db, {
      item: `thread:${id}`,
      kind: "thread",
      platform: "reddit",
      event: "rejected",
      via: "person",
      by: o.by ?? null,
      text: t.draft,
      reason: o.reason ?? null,
      note: o.note ?? null,
    });
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
