/**
 * Engage's Pass: he's done with a person (not a lead, not worth a reply, spam). The rows he passed
 * from close with their drafts kept as turned down, everything else open of theirs closes, and
 * what the reads find from them later lands closed (`passedOn`), so nothing of theirs is drafted
 * again. "Not now" rests them 30 days; the rest last until lifted.
 */
import { PASS_DAYS, PASS_LABELS, type PassReason } from "@wren/core/pass-reasons";
import { REJECT_NOTE_MAX } from "@wren/core/reject-reasons";
import type { Queryable } from "@wren/db";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { dropComment } from "./comments.js";
import { skipThread } from "./discovery/threads.js";
import { skipPost } from "./reach-posts/acts.js";
import { comments, reachContacts, reachPasses, reachPosts, redditThreads } from "./schema.js";

const DAY = 86_400_000;

/** The key a pass matches on: the handle, else the name, lowercased. */
export const passKey = (handle: string | null | undefined, name: string): string =>
  (handle?.trim() || name.trim()).replace(/^@/, "").toLowerCase().slice(0, 200);

/** Active passes on a platform, as `passKey`s. */
export async function passedOn(db: Queryable, platform: string): Promise<Set<string>> {
  const rows = await db
    .select({ handle: reachPasses.handle })
    .from(reachPasses)
    .where(
      and(
        eq(reachPasses.platform, platform),
        isNull(reachPasses.liftedAt),
        or(isNull(reachPasses.until), gt(reachPasses.until, sql`now()`)),
      ),
    );
  return new Set(rows.map((r) => r.handle));
}

export interface Who {
  platform: string;
  handle: string;
  name: string;
}

/** Who wrote a typed Engage id; null when the row is gone. */
export async function whoOf(db: Queryable, item: string): Promise<Who | null> {
  const at = item.indexOf(":");
  const type = item.slice(0, at);
  const key = item.slice(at + 1);
  const n = Number(key);
  if (type === "comment") {
    const [c] = await db
      .select({ platform: comments.platform, author: comments.author })
      .from(comments)
      .where(eq(comments.id, n));
    return c ? { platform: c.platform, handle: passKey(null, c.author), name: c.author } : null;
  }
  if (type === "onpost") {
    const [p] = await db
      .select({
        platform: reachPosts.platform,
        handle: reachPosts.handle,
        author: reachPosts.author,
      })
      .from(reachPosts)
      .where(eq(reachPosts.id, n));
    return p ? { platform: p.platform, handle: passKey(p.handle, p.author), name: p.author } : null;
  }
  if (type === "thread") {
    const [t] = await db
      .select({ author: redditThreads.author })
      .from(redditThreads)
      .where(eq(redditThreads.id, key));
    return t ? { platform: "reddit", handle: passKey(null, t.author), name: t.author } : null;
  }
  if (type === "dm") {
    const [c] = await db
      .select({
        platform: reachContacts.platform,
        handle: reachContacts.handle,
        name: reachContacts.name,
      })
      .from(reachContacts)
      .where(eq(reachContacts.id, n));
    return c
      ? { platform: c.platform, handle: passKey(c.handle, c.handle), name: c.name ?? c.handle }
      : null;
  }
  return null;
}

/**
 * Pass on the people behind these Engage rows. Answers how many people and how many open rows
 * closed (the picked ones included).
 */
export async function passOn(
  db: Queryable,
  items: readonly string[],
  o: { reason: PassReason; note?: string | null; by?: string | null; now: Date },
): Promise<{ people: number; closed: number }> {
  const days = PASS_DAYS[o.reason];
  const until = days ? new Date(o.now.getTime() + days * DAY) : null;
  const why = `${PASS_LABELS[o.reason]}${o.note ? `: ${o.note}` : ""}`.slice(0, REJECT_NOTE_MAX);
  const seen = new Map<string, Who>();
  let closed = 0;
  for (const item of items) {
    const who = await whoOf(db, item);
    if (!who) continue;
    closed++;
    seen.set(`${who.platform}:${who.handle}`, who);
    await db
      .insert(reachPasses)
      .values({ ...who, reason: o.reason, note: o.note ?? null, item, by: o.by ?? null, until })
      .onConflictDoUpdate({
        target: [reachPasses.platform, reachPasses.handle],
        set: {
          reason: o.reason,
          note: o.note ?? null,
          item,
          by: o.by ?? null,
          until,
          liftedAt: null,
        },
      });
    // The picked row's draft is kept as turned down, with his why.
    const [type, key] = [item.slice(0, item.indexOf(":")), item.slice(item.indexOf(":") + 1)];
    const by = { ...(o.by ? { by: o.by } : {}), note: why };
    if (type === "comment") await dropComment(db, Number(key), by);
    else if (type === "onpost") await skipPost(db, [Number(key)], by);
    else if (type === "thread") await skipThread(db, key, by);
    else if (type === "dm")
      await db
        .update(reachContacts)
        .set({ readAt: o.now })
        .where(eq(reachContacts.id, Number(key)));
  }
  for (const who of seen.values()) closed += await closeOpen(db, who, why);
  return { people: seen.size, closed };
}

/** Everything else open from one person: comments on ours, their posts, their threads. */
async function closeOpen(db: Queryable, who: Who, why: string): Promise<number> {
  const c = await db
    .update(comments)
    .set({ state: "dropped" })
    .where(
      and(
        eq(comments.platform, who.platform as never),
        eq(sql`lower(${comments.author})`, who.handle),
        inArray(comments.state, ["new", "waiting"]),
      ),
    )
    .returning({ id: comments.id });
  const p =
    who.platform === "reddit"
      ? []
      : await db
          .update(reachPosts)
          .set({ state: "skipped", stateReason: `passed: ${why}` })
          .where(
            and(
              eq(reachPosts.platform, who.platform as never),
              or(
                eq(sql`lower(${reachPosts.handle})`, who.handle),
                eq(sql`lower(${reachPosts.author})`, who.handle),
              ),
              inArray(reachPosts.state, ["found", "queued"]),
            ),
          )
          .returning({ id: reachPosts.id });
  const t =
    who.platform !== "reddit"
      ? []
      : await db
          .update(redditThreads)
          .set({ state: "skipped" })
          .where(
            and(
              eq(sql`lower(${redditThreads.author})`, who.handle),
              inArray(redditThreads.state, ["new", "ranked", "queued"]),
            ),
          )
          .returning({ id: redditThreads.id });
  return c.length + p.length + t.length;
}

/** Lift a pass: they can be proposed again. Answers whether one was active. */
export async function liftPass(db: Queryable, platform: string, handle: string, now: Date) {
  const rows = await db
    .update(reachPasses)
    .set({ liftedAt: now })
    .where(
      and(
        eq(reachPasses.platform, platform),
        eq(reachPasses.handle, passKey(handle, handle)),
        isNull(reachPasses.liftedAt),
      ),
    )
    .returning({ id: reachPasses.id });
  return rows.length > 0;
}

/** Passes newest first, for the CLI. */
export async function listPasses(db: Queryable, o: { limit?: number } = {}) {
  return db
    .select()
    .from(reachPasses)
    .where(isNull(reachPasses.liftedAt))
    .orderBy(sql`${reachPasses.createdAt} desc`)
    .limit(Math.min(o.limit ?? 50, 500));
}
