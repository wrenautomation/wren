/**
 * A comment's whole conversation as the context view draws it (designs/2026-10-15-engage-threads.md):
 * the last thread read with every row we keep laid over it.
 */
import type { Queryable } from "@wren/db";
import { reachAccounts } from "@wren/starling-acts";
import { and, asc, eq, sql } from "drizzle-orm";
import { comments, commentThreads } from "./schema.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The post a context view heads with; null fields where the site gave none. */
interface ContextPost {
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
