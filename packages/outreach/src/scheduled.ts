/**
 * Approved comments on a schedule: each drafted, queued comment gets a slot on its account's lane
 * (`pacing.ts`), kept in `send_at`. Comments on others' posts share one lane per platform (the
 * settings' account); Reddit threads one per account, under its warm-up cap, within ten days of
 * the thread (a drafted comment never goes stale once slotted). What can't fit stays waiting for his click.
 */

import { warmupOf } from "@wren/channel-reddit";
import { mayHavePosted } from "@wren/core/content";
import type { AccountHealth } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { applyGates } from "./discovery/requirements.js";
import { SLOT_WITHIN_MS } from "./discovery/threads.js";
import { type Pace, sendSlots, ZONE } from "./pacing.js";
import type { CommentsSettings } from "./reach-posts.js";
import {
  type ReachPostPlatform,
  reachAccounts,
  reachPosts,
  redditPlaces,
  redditThreads,
} from "./schema.js";

const HOUR = 3_600_000;
/** Sends looked back on for spacing and the day's count. */
const LOOKBACK_MS = 2 * 86_400_000;

export const POST_PACE: Omit<Pace, "perDay"> = { gapMinutes: 45, from: 9, to: 20, zone: ZONE };
export const THREAD_PACE: Omit<Pace, "perDay"> = { gapMinutes: 120, from: 9, to: 21, zone: ZONE };

export interface Slotted {
  kind: "post" | "thread";
  id: string;
  at: string;
}

/** One slot at a time: an item whose slot comes too late is left, and its slot stays free. */
function fill<T>(
  items: readonly T[],
  o: {
    now: Date;
    taken: Date[];
    pace: Pace;
    rand: () => number;
    latest: (item: T) => number;
  },
): Array<{ item: T; at: Date }> {
  const out: Array<{ item: T; at: Date }> = [];
  for (const item of items) {
    const [at] = sendSlots(1, o);
    if (!at) break;
    if (at.getTime() > o.latest(item)) continue;
    o.taken.push(at);
    out.push({ item, at });
  }
  return out;
}

/** Comments on others' posts, one platform: its drafted queue onto its lane. */
export async function schedulePosts(
  db: Queryable,
  platform: ReachPostPlatform,
  s: CommentsSettings,
  o: { now: Date; rand: () => number },
): Promise<Slotted[]> {
  if (!s.account || s.perDay <= 0) return [];
  const since = new Date(o.now.getTime() - LOOKBACK_MS);
  const lane = await db
    .select({ at: sql<Date>`coalesce(${reachPosts.sendAt}, ${reachPosts.commentedAt})` })
    .from(reachPosts)
    .where(
      and(
        eq(reachPosts.platform, platform),
        or(
          and(eq(reachPosts.state, "queued"), isNotNull(reachPosts.sendAt)),
          gte(reachPosts.commentedAt, since),
        ),
      ),
    );
  const items = await db
    .select({ id: reachPosts.id, postedAt: reachPosts.postedAt, createdAt: reachPosts.createdAt })
    .from(reachPosts)
    .where(
      and(
        eq(reachPosts.platform, platform),
        eq(reachPosts.state, "queued"),
        isNotNull(reachPosts.draft),
        isNull(reachPosts.sendAt),
      ),
    )
    .orderBy(desc(reachPosts.fit), reachPosts.id);
  const slots = fill(items, {
    now: o.now,
    taken: lane.map((r) => new Date(r.at)),
    pace: { ...POST_PACE, perDay: s.perDay },
    rand: o.rand,
    // A comment lands while the post is still read: twice the age a post is read at.
    latest: (p) => (p.postedAt ?? p.createdAt).getTime() + 2 * s.maxAgeHours * HOUR,
  });
  for (const { item, at } of slots)
    await db
      .update(reachPosts)
      .set({ sendAt: at })
      .where(and(eq(reachPosts.id, item.id), eq(reachPosts.state, "queued")));
  return slots.map(({ item, at }) => ({ kind: "post", id: String(item.id), at: at.toISOString() }));
}

/** Reddit threads: each account's drafted queue onto its lane, under its warm-up cap. */
export async function scheduleThreads(
  db: Queryable,
  o: { now: Date; rand: () => number },
): Promise<Slotted[]> {
  const since = new Date(o.now.getTime() - LOOKBACK_MS);
  const out: Slotted[] = [];
  // A sub whose floor no account meets keeps its queue off the schedule; one only another account
  // meets moves to it. Held comments stay queued and are slotted once the floor is met.
  const held = new Set(
    [...(await applyGates(db, o.now))].flatMap(([sub, g]) => (g.ok ? [] : [sub])),
  );
  const accounts = await db
    .select()
    .from(reachAccounts)
    .where(
      and(
        eq(reachAccounts.platform, "reddit"),
        inArray(reachAccounts.state, ["warming", "active"]),
      ),
    );
  for (const a of accounts) {
    const w = a.health ? warmupOf(a.health as AccountHealth, o.now) : null;
    if (!w || w.frozen || w.caps.comments <= 0) continue;
    const owns = or(
      eq(redditThreads.accountId, a.id),
      sql`${redditThreads.subreddit} IN (SELECT ${redditPlaces.subreddit} FROM ${redditPlaces} WHERE ${redditPlaces.accountId} = ${a.id})`,
    );
    const lane = await db
      .select({ at: sql<Date>`coalesce(${redditThreads.sendAt}, ${redditThreads.answeredAt})` })
      .from(redditThreads)
      .where(
        and(
          owns,
          or(
            and(eq(redditThreads.state, "queued"), isNotNull(redditThreads.sendAt)),
            gte(redditThreads.answeredAt, since),
          ),
        ),
      );
    const items = await db
      .select({
        id: redditThreads.id,
        postedAt: redditThreads.postedAt,
        subreddit: redditThreads.subreddit,
      })
      .from(redditThreads)
      .where(
        and(
          owns,
          eq(redditThreads.state, "queued"),
          isNotNull(redditThreads.draft),
          isNull(redditThreads.sendAt),
        ),
      )
      .orderBy(desc(redditThreads.fit), redditThreads.id);
    const slots = fill(
      items.filter((t) => !held.has(t.subreddit)),
      {
        now: o.now,
        taken: lane.map((r) => new Date(r.at)),
        pace: { ...THREAD_PACE, perDay: w.caps.comments },
        rand: o.rand,
        latest: (t) => t.postedAt.getTime() + SLOT_WITHIN_MS,
      },
    );
    for (const { item, at } of slots)
      await db
        .update(redditThreads)
        .set({ sendAt: at })
        .where(and(eq(redditThreads.id, item.id), eq(redditThreads.state, "queued")));
    out.push(
      ...slots.map(({ item, at }) => ({
        kind: "thread" as const,
        id: item.id,
        at: at.toISOString(),
      })),
    );
  }
  return out;
}

/** Take items off the schedule: back to waiting for his click. */
export async function unschedule(
  db: Queryable,
  o: { posts?: readonly number[]; threads?: readonly string[] },
): Promise<void> {
  if (o.posts?.length)
    await db
      .update(reachPosts)
      .set({ sendAt: null })
      .where(inArray(reachPosts.id, [...o.posts]));
  if (o.threads?.length)
    await db
      .update(redditThreads)
      .set({ sendAt: null })
      .where(inArray(redditThreads.id, [...o.threads]));
}

/** What a failed slot writes on a post, so a second failure can tell it is the second. */
const SEND_FAILED = "send failed: ";

/**
 * A slot's send failed for good. The row leaves the schedule so the next pass slots it again;
 * a post failing its second slot, or one that may have posted, is skipped. A thread retries
 * until it goes stale; its send reads the thread first, so ours never lands twice.
 */
export async function sendFailed(
  db: Queryable,
  kind: "post" | "thread",
  id: string,
  why: string,
): Promise<"retry" | "skipped"> {
  if (kind === "thread") {
    await db.update(redditThreads).set({ sendAt: null }).where(eq(redditThreads.id, id));
    return "retry";
  }
  const [r] = await db
    .select({ reason: reachPosts.stateReason })
    .from(reachPosts)
    .where(eq(reachPosts.id, Number(id)));
  // One retry for a send that failed, none for one that may have posted anyway.
  const again = (r?.reason?.startsWith(SEND_FAILED) ?? false) || mayHavePosted(why);
  await db
    .update(reachPosts)
    .set({
      sendAt: null,
      stateReason: `${SEND_FAILED}${why}`.slice(0, 500),
      ...(again ? { state: "skipped" as const } : {}),
    })
    .where(and(eq(reachPosts.id, Number(id)), eq(reachPosts.state, "queued")));
  return again ? "skipped" : "retry";
}

/** At send: is this still the slot? A cleared or moved `send_at` means his change of mind. */
export async function stillDue(
  db: Queryable,
  kind: "post" | "thread",
  id: string,
  at: string,
): Promise<boolean> {
  const [r] =
    kind === "post"
      ? await db
          .select({ at: reachPosts.sendAt })
          .from(reachPosts)
          .where(eq(reachPosts.id, Number(id)))
      : await db
          .select({ at: redditThreads.sendAt })
          .from(redditThreads)
          .where(eq(redditThreads.id, id));
  return !!r?.at && r.at.getTime() === new Date(at).getTime();
}
