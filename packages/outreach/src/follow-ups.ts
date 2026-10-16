/**
 * Follow-ups in a thread (designs/2026-10-15-engage-threads.md). An inbox lists only direct
 * replies to us: a person who replies to their own reply, or a third person who answers them, never
 * shows there. So for `followUpDays` after something lands under our comment, the watch reads the
 * conversation under it and keeps what the inbox missed: anything below our comment, at any depth,
 * and anything by a person already talking to us there. Kept once by the platform's id.
 */

import { settingsFor } from "@wren/core/clients";
import type { CommentIn, ThreadNode, ThreadRead } from "@wren/core/outreach";
import { warmEveryMs } from "@wren/core/warm";
import type { Queryable } from "@wren/db";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { keepComments } from "./comments.js";
import { ReachRefusal } from "./refusal.js";
import {
  type Comment,
  type CommentThread,
  comments,
  commentThreads,
  type ReachAccount,
  reachAccounts,
  type ThreadNodeRow,
} from "./schema.js";
import { keepTouch, touchFromAnswer, touchFromComment } from "./touches.js";

export const COMMENTS_READ = "comments.read";

/** The comment reader's block: how long a thread stays watched after its last activity. */
export const commentsReadSettingsSchema = z
  .object({
    /** Days after the last comment or answer in a thread that the watch keeps reading it; 0 = off. */
    followUpDays: z.number().int().min(0).max(30).default(7),
  })
  .strict();
export type CommentsReadSettings = z.infer<typeof commentsReadSettingsSchema>;

/** A bad or missing block reads as the defaults. */
export function commentsReadSettings(block: unknown): CommentsReadSettings {
  const p = commentsReadSettingsSchema.safeParse(block ?? {});
  return p.success ? p.data : commentsReadSettingsSchema.parse({});
}

/** Wren's own block (`wren_settings`). */
export const wrenCommentsRead = async (db: Queryable) =>
  commentsReadSettings((await settingsFor(db, null))[COMMENTS_READ]);

const DAY_MS = 86_400_000;
const MIN = 60_000;
/** Never sooner than this between two probes of one thread. */
export const THREAD_FLOOR_MS = 5 * MIN;
/** A thread quiet for a day is probed this often until its watch ends. */
export const THREAD_IDLE_MS = 3 * 60 * MIN;
/** A probe that says nothing moved still reads the thread this often: counts can lag. */
export const THREAD_SWEEP_MS = 12 * 60 * MIN;
/** Full thread reads one watch pass makes at most, across accounts. */
export const THREAD_READS_PER_PASS = 3;
/** Focused reads per thread at most, when a big thread hid comments behind "load more". */
export const FOCUS_READS = 2;
/** Threads one pass looks at at most. */
const DUE_LIMIT = 25;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** When to probe next: warm right after activity, easing off, slow after a quiet day. */
export function nextCheckAt(activeAt: Date, now: Date, r: number): Date {
  const age = now.getTime() - activeAt.getTime();
  const wait =
    age > DAY_MS ? THREAD_IDLE_MS : Math.max(THREAD_FLOOR_MS, warmEveryMs(activeAt, now, r));
  return new Date(now.getTime() + wait);
}

export interface FollowUpScope {
  /** Our handles on the platform: their comments are ours, never follow-ups. */
  ours: readonly string[];
  /** People already talking to us in this thread (their comments are rows). */
  talking: readonly string[];
  /** Refs already kept: never twice. */
  known: ReadonlySet<string>;
}

/**
 * What the inbox missed: every comment below one of ours at any depth, and every comment by a
 * person already talking to us, minus ours and what is kept. Oldest first.
 */
export function followUpsOf(read: ThreadRead, scope: FollowUpScope): CommentIn[] {
  const isOurs = (h: string) => scope.ours.some((o) => same(o, h));
  const byRef = new Map(read.nodes.map((n) => [n.ref, n]));
  const below = (n: ThreadNode) => {
    const seen = new Set<string>();
    for (let p = byRef.get(n.parent); p && !seen.has(p.ref); p = byRef.get(p.parent)) {
      if (isOurs(p.handle)) return true;
      seen.add(p.ref);
    }
    return false;
  };
  const postOurs = !!read.post.handle && isOurs(read.post.handle);
  return read.nodes
    .filter(
      (n) =>
        !isOurs(n.handle) &&
        n.handle !== "[deleted]" &&
        !scope.known.has(n.ref) &&
        (below(n) || scope.talking.some((t) => same(t, n.handle))),
    )
    .map((n) => {
      const parent = byRef.get(n.parent);
      const kind =
        parent && isOurs(parent.handle)
          ? "comment_reply"
          : !parent && postOurs
            ? "post_reply"
            : "thread_reply";
      return {
        ref: n.ref,
        post: read.post.ref,
        parent: n.parent,
        kind,
        place: read.post.place,
        postTitle: read.post.title,
        handle: n.handle,
        text: n.text,
        url: n.url,
        at: n.at,
        raw: { via: "thread", parentAuthor: parent?.handle ?? read.post.handle },
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Two reads of one thread as one: a focused read adds what the whole read hid. */
export function mergeReads(base: ThreadRead, more: readonly ThreadRead[]): ThreadRead {
  const nodes = new Map(base.nodes.map((n) => [n.ref, n]));
  for (const r of more) for (const n of r.nodes) if (!nodes.has(n.ref)) nodes.set(n.ref, n);
  return {
    ...base,
    nodes: [...nodes.values()].sort(
      (a, b) => a.at.localeCompare(b.at) || a.ref.localeCompare(b.ref),
    ),
  };
}

/**
 * Start or extend a watch for every thread where something landed in the last `days`: a reach
 * comment from someone else, or our answer to one. New activity makes it due now.
 */
export async function watchFromComments(
  db: Queryable,
  now: Date,
  days: number,
  platforms: readonly string[],
): Promise<number> {
  if (days <= 0 || !platforms.length) return 0;
  const since = new Date(now.getTime() - days * DAY_MS);
  const until = sql`greatest(c.at, c.answered_at) + make_interval(days => ${days}::int)`;
  const rows = (await db.execute(sql`
    INSERT INTO comment_threads (platform, post, account_id, post_title, post_place, active_at, until, check_at)
    SELECT DISTINCT ON (c.platform, c.post)
      c.platform, c.post, c.account_id, c.post_title, c.place,
      greatest(c.at, c.answered_at), ${until}, ${now.toISOString()}::timestamptz
    FROM comments c
    WHERE c.channel = 'reach' AND c.account_id IS NOT NULL
      AND c.sort IS DISTINCT FROM 'ours'
      AND c.platform IN (${sql.join(
        platforms.map((p) => sql`${p}`),
        sql`, `,
      )})
      AND greatest(c.at, c.answered_at) > ${since.toISOString()}::timestamptz
    ORDER BY c.platform, c.post, greatest(c.at, c.answered_at) DESC
    ON CONFLICT (platform, post) DO UPDATE SET
      post_title = coalesce(comment_threads.post_title, excluded.post_title),
      post_place = coalesce(comment_threads.post_place, excluded.post_place),
      check_at = CASE WHEN excluded.active_at > comment_threads.active_at
        THEN least(comment_threads.check_at, excluded.check_at) ELSE comment_threads.check_at END,
      active_at = greatest(comment_threads.active_at, excluded.active_at),
      until = greatest(comment_threads.until, excluded.until)
    WHERE excluded.active_at > comment_threads.active_at OR excluded.until > comment_threads.until
    RETURNING id`)) as unknown as Array<{ id: number }>;
  return rows.length;
}

/** Threads due a probe now, on live accounts, soonest first. */
export async function dueThreads(
  db: Queryable,
  now: Date,
  accounts: readonly string[],
): Promise<CommentThread[]> {
  if (!accounts.length) return [];
  return db
    .select()
    .from(commentThreads)
    .where(
      and(
        gt(commentThreads.until, now),
        lte(commentThreads.checkAt, now),
        inArray(commentThreads.accountId, [...accounts]),
      ),
    )
    .orderBy(asc(commentThreads.checkAt))
    .limit(DUE_LIMIT);
}

/** Whether a probe's count asks for a full read. */
export function needsRead(t: CommentThread, count: number | undefined, now: Date) {
  if (!t.readAt) return true;
  if (now.getTime() - t.readAt.getTime() >= THREAD_SWEEP_MS) return true;
  return count !== undefined && count !== t.count;
}

/** A probe that saw nothing new: the next one waits. */
export async function probed(db: Queryable, id: number, at: Date) {
  await db.update(commentThreads).set({ checkAt: at }).where(eq(commentThreads.id, id));
}

const asRow = (n: ThreadNode): ThreadNodeRow => ({ ...n });

export interface Applied {
  kept: Array<Pick<Comment, "id" | "platform" | "author" | "post">>;
  /** Rows closed because one of ours answered them on the site. */
  answered: number[];
}

/**
 * One full read applied: follow-ups kept (each one spine event for the caller), open rows our
 * account answered on the site closed, and the snapshot the context view draws saved.
 */
export async function applyThread(
  db: Queryable,
  t: CommentThread,
  account: Pick<ReachAccount, "id" | "platform">,
  read: ThreadRead,
  ours: readonly string[],
  now: Date,
  r: number,
  days: number,
): Promise<Applied> {
  const isOurs = (h: string) => ours.some((o) => same(o, h));
  const rows = await db
    .select({
      id: comments.id,
      ref: comments.ref,
      author: comments.author,
      sort: comments.sort,
      state: comments.state,
    })
    .from(comments)
    .where(and(eq(comments.platform, t.platform), eq(comments.post, t.post)));
  const refs = read.nodes.map((n) => n.ref);
  const elsewhere = refs.length
    ? await db
        .select({ ref: comments.ref })
        .from(comments)
        .where(and(eq(comments.platform, t.platform), inArray(comments.ref, refs)))
    : [];
  const known = new Set([...rows.map((c) => c.ref), ...elsewhere.map((c) => c.ref)]);
  const talking = [
    ...new Set(rows.filter((c) => c.sort !== "ours" && !isOurs(c.author)).map((c) => c.author)),
  ];
  const items = followUpsOf(read, { ours, talking, known });
  const kept = await keepComments(db, account, items, ours);
  // Ours under an open row: answered on the site, not from here.
  const answered: number[] = [];
  for (const c of rows) {
    if (c.state === "answered" || c.state === "dropped" || c.sort === "ours") continue;
    const ans = read.nodes.find((n) => n.parent === c.ref && isOurs(n.handle));
    if (!ans) continue;
    const [done] = await db
      .update(comments)
      .set({
        state: "answered",
        answer: ans.text,
        answerRef: ans.ref,
        answeredAt: new Date(ans.at),
      })
      .where(and(eq(comments.id, c.id), inArray(comments.state, ["new", "waiting"])))
      .returning({ id: comments.id });
    if (!done) continue;
    answered.push(done.id);
    await keepTouch(`ca:${done.id}`, () => touchFromAnswer(db, done.id));
  }
  const active = kept.length || answered.length ? now : t.activeAt;
  await db
    .update(commentThreads)
    .set({
      postTitle: read.post.title ?? t.postTitle,
      postText: read.post.text,
      postUrl: read.post.url,
      postPlace: read.post.place ?? t.postPlace,
      postAuthor: read.post.handle,
      postMedia: read.post.media,
      postAt: read.post.at ? new Date(read.post.at) : null,
      nodes: read.nodes.map(asRow),
      more: Math.max(0, read.more),
      count: read.post.count,
      readAt: now,
      activeAt: active,
      until: new Date(Math.max(t.until.getTime(), active.getTime() + days * DAY_MS)),
      checkAt: nextCheckAt(active, now, r),
    })
    .where(eq(commentThreads.id, t.id));
  return { kept, answered };
}

/** Ours in the thread whose conversation a focused read opens: newest first. */
export function focusesOf(read: ThreadRead, ours: readonly string[], limit = FOCUS_READS) {
  return read.nodes
    .filter((n) => ours.some((o) => same(o, n.handle)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((n) => n.ref);
}

/** The post a context view heads with; null fields where the site gave none. */
export interface ContextPost {
  title: string | null;
  text: string | null;
  url: string | null;
  place: string | null;
  author: string | null;
  media: string | null;
  at: string | null;
}

/** One comment in a context view; the web nests them by `parent`. */
export interface ContextNode {
  ref: string;
  parent: string;
  handle: string;
  text: string;
  at: string;
  url: string | null;
  ours: boolean;
  /** Its row, when we keep one: where it stands, and the id an answer goes through. */
  row: { id: number; state: string } | null;
}

/** A comment's whole conversation, as the context view draws it. */
export interface ThreadContext {
  platform: string;
  post: ContextPost;
  nodes: ContextNode[];
  /** The comment it was opened from. */
  focus: string;
  /** When the thread was last read on the site; null: drawn from what we kept. */
  readAt: string | null;
  /** Comments the site hid behind "load more" on that read. */
  more: number;
  /** A refresh reads it again on the site: a reach thread, or our own post's comments. */
  refresh: boolean;
}

const iso = (d: Date | string | null | undefined) =>
  d ? (d instanceof Date ? d.toISOString() : new Date(d).toISOString()) : null;

/**
 * A comment's conversation: the last thread read, with every row we keep in it laid over (their
 * state, our answers), so it shows even before a read. `postOf` heads our own post's comments.
 */
export async function threadContextOf(
  db: Queryable,
  id: number,
  postOf?: (platform: string, post: string) => Promise<Partial<ContextPost> | null>,
): Promise<ThreadContext | null> {
  const [c] = await db.select().from(comments).where(eq(comments.id, id));
  if (!c) return null;
  const [snap] = await db
    .select()
    .from(commentThreads)
    .where(and(eq(commentThreads.platform, c.platform), eq(commentThreads.post, c.post)));
  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.platform, c.platform), eq(comments.post, c.post)))
    .orderBy(asc(comments.at));
  const handles = (
    await db
      .select({ handle: reachAccounts.handle, id: reachAccounts.id })
      .from(reachAccounts)
      .where(sql`${reachAccounts.platform} = ${c.platform}`)
  ).filter((a): a is { handle: string; id: string } => !!a.handle);
  const isOurs = (h: string) => handles.some((a) => same(a.handle, h));
  const nodes = new Map<string, ContextNode>();
  for (const n of snap?.nodes ?? []) nodes.set(n.ref, { ...n, ours: isOurs(n.handle), row: null });
  for (const r of rows) {
    const had = nodes.get(r.ref);
    const ours = r.sort === "ours" || isOurs(r.author);
    nodes.set(r.ref, {
      ref: r.ref,
      parent: had?.parent ?? r.parent,
      handle: r.author,
      text: had?.text ?? r.body,
      at: had?.at ?? r.at.toISOString(),
      url: had?.url ?? (r.url || null),
      ours,
      row: ours ? null : { id: r.id, state: r.state },
    });
  }
  // Our answers sent from here, before a read shows them.
  const own = handles.find((a) => a.id === c.accountId)?.handle ?? "us";
  for (const r of rows) {
    if (r.state !== "answered" || !r.answer || !r.answeredAt) continue;
    const ref = r.answerRef ?? `answer:${r.id}`;
    if (nodes.has(ref) || [...nodes.values()].some((n) => n.ours && n.parent === r.ref)) continue;
    // One answer covering their earlier messages is drawn once, under the one it answered.
    if (
      r.answerRef &&
      rows.some((o) => o.id !== r.id && o.answerRef === r.answerRef && o.at > r.at)
    )
      continue;
    nodes.set(ref, {
      ref,
      parent: r.ref,
      handle: r.accountId ? own : "us",
      text: r.answer,
      at: r.answeredAt.toISOString(),
      url: null,
      ours: true,
      row: null,
    });
  }
  const head = postOf ? await postOf(c.platform, c.post) : null;
  return {
    platform: c.platform,
    post: {
      title: snap?.postTitle ?? head?.title ?? c.postTitle,
      text: snap?.postText ?? head?.text ?? null,
      url: snap?.postUrl ?? head?.url ?? null,
      place: snap?.postPlace ?? head?.place ?? c.place,
      author: snap?.postAuthor ?? head?.author ?? null,
      media: snap?.postMedia ?? head?.media ?? null,
      at: iso(snap?.postAt) ?? head?.at ?? null,
    },
    nodes: [...nodes.values()].sort(
      (a, b) => a.at.localeCompare(b.at) || a.ref.localeCompare(b.ref),
    ),
    focus: c.ref,
    readAt: iso(snap?.readAt),
    more: snap?.more ?? 0,
    refresh: (c.channel === "reach" && !!c.accountId) || c.channel === "content",
  };
}

/**
 * The row an answer to `ref` goes through, from the conversation of comment `from`: its kept row,
 * or one made now from the thread read. Ours, or one the read never saw, is refused.
 */
export async function adoptNode(db: Queryable, from: number, ref: string): Promise<number> {
  const [c] = await db.select().from(comments).where(eq(comments.id, from));
  if (!c) throw new ReachRefusal(`no comment ${from}`);
  if (c.ref === ref) return c.id;
  const [kept] = await db
    .select({ id: comments.id, sort: comments.sort, post: comments.post })
    .from(comments)
    .where(and(eq(comments.platform, c.platform), eq(comments.ref, ref)));
  if (kept) {
    if (kept.post !== c.post) throw new ReachRefusal("that comment is in another thread");
    if (kept.sort === "ours") throw new ReachRefusal("that one is ours");
    return kept.id;
  }
  const [snap] = await db
    .select()
    .from(commentThreads)
    .where(and(eq(commentThreads.platform, c.platform), eq(commentThreads.post, c.post)));
  const node = snap?.nodes.find((n) => n.ref === ref);
  if (!node) throw new ReachRefusal("that comment isn't in the thread we read; refresh it first");
  if (node.handle === "[deleted]") throw new ReachRefusal("that comment was deleted");
  const ours = (
    await db
      .select({ handle: reachAccounts.handle })
      .from(reachAccounts)
      .where(sql`${reachAccounts.platform} = ${c.platform}`)
  ).flatMap((a) => (a.handle ? [a.handle] : []));
  if (ours.some((h) => same(h, node.handle))) throw new ReachRefusal("that one is ours");
  const parent = snap?.nodes.find((n) => n.ref === node.parent);
  const [made] = await db
    .insert(comments)
    .values({
      platform: c.platform,
      accountId: c.accountId,
      channel: c.channel,
      ref: node.ref,
      post: c.post,
      parent: node.parent,
      kind: parent && ours.some((h) => same(h, parent.handle)) ? "comment_reply" : "thread_reply",
      place: c.place,
      postTitle: c.postTitle,
      author: node.handle.slice(0, 120),
      body: node.text,
      url: node.url,
      at: new Date(node.at),
      raw: { via: "context" },
    })
    .onConflictDoNothing()
    .returning({ id: comments.id });
  if (made) {
    await keepTouch(`c:${made.id}`, () => touchFromComment(db, made.id));
    return made.id;
  }
  const [again] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.platform, c.platform), eq(comments.ref, ref)));
  if (!again) throw new ReachRefusal("that comment could not be kept");
  return again.id;
}

/**
 * The watched thread a reach comment sits in, started now when none is, and the account that
 * reads it. Null: a comment on our own post (the content reader reads those).
 */
export async function threadFor(
  db: Queryable,
  id: number,
  now = new Date(),
  days = 7,
): Promise<{ thread: CommentThread; account: ReachAccount } | null> {
  const [c] = await db.select().from(comments).where(eq(comments.id, id));
  if (!c) throw new ReachRefusal(`no comment ${id}`);
  if (c.channel !== "reach" || !c.accountId) return null;
  const [account] = await db.select().from(reachAccounts).where(eq(reachAccounts.id, c.accountId));
  if (!account) throw new ReachRefusal(`comment ${id}: its account is gone`);
  const active = c.answeredAt && c.answeredAt > c.at ? c.answeredAt : c.at;
  await db
    .insert(commentThreads)
    .values({
      platform: c.platform,
      post: c.post,
      accountId: c.accountId,
      postTitle: c.postTitle,
      postPlace: c.place,
      activeAt: active,
      until: new Date(Math.max(now.getTime(), active.getTime()) + days * DAY_MS),
      checkAt: now,
    })
    .onConflictDoNothing();
  const [thread] = await db
    .select()
    .from(commentThreads)
    .where(and(eq(commentThreads.platform, c.platform), eq(commentThreads.post, c.post)));
  if (!thread) throw new ReachRefusal(`comment ${id}: no thread`);
  return { thread, account };
}

const DATES = ["postAt", "readAt", "checkAt", "activeAt", "until", "createdAt"] as const;

/** A thread row back from a journal (dates as text): its dates as dates again. */
export function asThread(t: CommentThread): CommentThread {
  const out = { ...t } as Record<string, unknown>;
  for (const k of DATES) {
    const v = out[k];
    if (typeof v === "string") out[k] = new Date(v);
  }
  return out as unknown as CommentThread;
}
