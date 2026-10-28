/**
 * Approved comments on a schedule: each drafted, queued comment gets a slot on its account's lane
 * (`pacing.ts`), kept in `send_at`. Comments on others' posts share one lane per platform (the
 * settings' account); Reddit threads one per account, under its warm-up cap, within two weeks of
 * the thread (a drafted comment never goes stale once slotted). With `autoSend`, a post comment that
 * can no longer fit before its post goes cold is skipped: no one waits to click it (William, 10-27).
 * Without it, what can't fit stays waiting for his click.
 *
 * Reddit threads go out every day, 8:00 to 22:00 fleet time: people read Reddit in the evening and
 * on weekends (designs/2026-10-18-reddit-karma.md). A karma place's thread takes the first slots,
 * within `KARMA_FRESH_MS` of its post; reach places take at most the rung's reach share a day.
 * LinkedIn and DMs keep their own windows (`policy.ts`).
 */

import { warmupOf } from "@wren/channel-reddit";
import type { AccountHealth } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { applyGates, holdsThread } from "./discovery/requirements.js";
import { inKarmaPlace, KARMA_FRESH_MS, SLOT_WITHIN_MS } from "./discovery/threads.js";
import { type Pace, sendSlots, ZONE } from "./pacing.js";
import type { CommentsSettings } from "./reach-posts/settings.js";
import {
  type ReachPostPlatform,
  reachAccounts,
  reachPosts,
  redditPlaces,
  redditThreads,
} from "./schema.js";
import { sendOpen } from "./send-attempts.js";

const HOUR = 3_600_000;
/** Sends looked back on for spacing and the day's count. */
const LOOKBACK_MS = 2 * 86_400_000;

export const POST_PACE: Omit<Pace, "perDay"> = { gapMinutes: 45, from: 9, to: 20, zone: ZONE };
/**
 * A comment lane's pace for `perDay`: the 45-minute gap, closer when the day must hold more.
 * Each slot may land up to half a gap late, so a gap holds 1.25 gaps of the day.
 */
export function postPace(perDay: number): Pace {
  const minutes = (POST_PACE.to - POST_PACE.from) * 60;
  const fits = Math.floor(minutes / (Math.max(1, perDay) * 1.25));
  return { ...POST_PACE, gapMinutes: Math.max(10, Math.min(POST_PACE.gapMinutes, fits)), perDay };
}
export const THREAD_PACE: Omit<Pace, "perDay"> = { gapMinutes: 120, from: 8, to: 22, zone: ZONE };

export interface Slotted {
  kind: "post" | "thread";
  id: string;
  at: string;
}

/**
 * One slot at a time: an item whose slot comes too late is left, and its slot stays free. A slot
 * goes into `taken`, and into `kind` when the lane caps that kind of send on its own.
 */
function fill<T>(
  items: readonly T[],
  o: {
    now: Date;
    taken: Date[];
    pace: Pace;
    rand: () => number;
    latest: (item: T) => number;
    kind?: { perDay: number; taken: Date[] };
  },
): Array<{ item: T; at: Date }> {
  const out: Array<{ item: T; at: Date }> = [];
  const pace = o.kind ? { ...o.pace, within: o.kind } : o.pace;
  for (const item of items) {
    const [at] = sendSlots(1, { ...o, pace });
    if (!at) break;
    if (at.getTime() > o.latest(item)) continue;
    o.taken.push(at);
    o.kind?.taken.push(at);
    out.push({ item, at });
  }
  return out;
}

/**
 * Reach slots past the share on their day: a lane slotted under a larger share sends no more than
 * the share now. Sent ones count first (they can't move); of the rest, the latest go. Answers the
 * ids to take off the schedule.
 */
export function overShare(
  slots: readonly { id: string; at: Date; sent: boolean }[],
  perDay: number,
  zone: string,
): string[] {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
  const count = new Map<string, number>();
  const out: string[] = [];
  const order = [...slots].sort(
    (a, b) => Number(b.sent) - Number(a.sent) || a.at.getTime() - b.at.getTime(),
  );
  for (const s of order) {
    const d = day(s.at);
    const n = (count.get(d) ?? 0) + 1;
    count.set(d, n);
    if (n > perDay && !s.sent) out.push(s.id);
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
        // One that may have gone out waits on a person (designs/2026-10-16-maybe-sent.md).
        sql`not ${sendOpen(sql`'onpost:' || ${reachPosts.id}`)}`,
      ),
    )
    .orderBy(desc(reachPosts.fit), reachPosts.id);
  // A comment lands while the post is still read: inside the guard, or one half-life after we
  // found it when it was found near the guard.
  const latest = (p: (typeof items)[number]) =>
    Math.max(
      (p.postedAt ?? p.createdAt).getTime() + s.maxAgeHours * HOUR,
      p.createdAt.getTime() + s.halfLifeHours * HOUR,
    );
  const cold = s.autoSend ? items.filter((p) => latest(p) < o.now.getTime()).map((p) => p.id) : [];
  if (cold.length)
    await db
      .update(reachPosts)
      .set({ state: "skipped", stateReason: "post went cold before a slot" })
      .where(and(inArray(reachPosts.id, cold), eq(reachPosts.state, "queued")));
  const slots = fill(
    items.filter((p) => !cold.includes(p.id)),
    {
      now: o.now,
      taken: lane.map((r) => new Date(r.at)),
      pace: postPace(s.perDay),
      rand: o.rand,
      latest,
    },
  );
  for (const { item, at } of slots)
    await db
      .update(reachPosts)
      .set({ sendAt: at })
      .where(and(eq(reachPosts.id, item.id), eq(reachPosts.state, "queued")));
  return slots.map(({ item, at }) => ({ kind: "post", id: String(item.id), at: at.toISOString() }));
}

/**
 * Reddit threads: each account's drafted queue onto its lane, under its warm-up cap. Karma places
 * first, while their thread is young; reach places under the rung's reach share a day.
 */
export async function scheduleThreads(
  db: Queryable,
  o: { now: Date; rand: () => number },
): Promise<Slotted[]> {
  const since = new Date(o.now.getTime() - LOOKBACK_MS);
  const out: Slotted[] = [];
  // A sub whose floor no account meets keeps its queue off the schedule; one only another account
  // meets moves to it. Held comments stay queued and are slotted once the floor is met.
  // A person's pick rides the picked account's lane and passes a karma or age floor.
  const gates = await applyGates(db, o.now);
  const accounts = await db
    .select()
    .from(reachAccounts)
    .where(
      and(
        eq(reachAccounts.platform, "reddit"),
        inArray(reachAccounts.state, ["warming", "active"]),
      ),
    );
  const karma = inKarmaPlace;
  for (const a of accounts) {
    const w = a.health ? warmupOf(a.health as AccountHealth, o.now) : null;
    if (!w || w.frozen || w.caps.comments <= 0) continue;
    const pick = sql`(select da.account from draft_accounts da where da.item = 'thread:' || ${redditThreads.id})`;
    const owns = or(
      sql`${pick} = ${a.account}`,
      and(
        sql`${pick} is null`,
        or(
          eq(redditThreads.accountId, a.id),
          sql`${redditThreads.subreddit} IN (SELECT ${redditPlaces.subreddit} FROM ${redditPlaces} WHERE ${redditPlaces.accountId} = ${a.id})`,
        ),
      ),
    );
    const lane = await db
      .select({
        id: redditThreads.id,
        at: sql<Date>`coalesce(${redditThreads.sendAt}, ${redditThreads.answeredAt})`,
        sent: sql<boolean>`${redditThreads.answeredAt} is not null`,
        karma,
      })
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
    // Reach slots past the share on their day (slotted under a larger one) are slotted again.
    const over = new Set(
      overShare(
        lane.filter((r) => !r.karma).map((r) => ({ ...r, at: new Date(r.at) })),
        w.caps.reachComments,
        THREAD_PACE.zone,
      ),
    );
    if (over.size) await unschedule(db, { threads: [...over] });
    const kept = lane.filter((r) => !over.has(r.id));
    const items = await db
      .select({
        id: redditThreads.id,
        postedAt: redditThreads.postedAt,
        subreddit: redditThreads.subreddit,
        picked: sql<boolean>`${pick} is not null`,
        karma,
      })
      .from(redditThreads)
      .where(
        and(
          owns,
          eq(redditThreads.state, "queued"),
          isNotNull(redditThreads.draft),
          isNull(redditThreads.sendAt),
          sql`not ${sendOpen(sql`'thread:' || ${redditThreads.id}`)}`,
        ),
      )
      .orderBy(desc(redditThreads.fit), redditThreads.id);
    const open = items.filter((t) => !holdsThread(gates.get(t.subreddit), t.picked));
    const taken = kept.map((r) => new Date(r.at));
    const pace = { ...THREAD_PACE, perDay: w.caps.comments };
    const slots = [
      ...fill(
        open.filter((t) => t.karma),
        {
          now: o.now,
          taken,
          pace,
          rand: o.rand,
          latest: (t) => t.postedAt.getTime() + KARMA_FRESH_MS,
        },
      ),
      ...fill(
        open.filter((t) => !t.karma),
        {
          now: o.now,
          taken,
          pace,
          rand: o.rand,
          latest: (t) => t.postedAt.getTime() + SLOT_WITHIN_MS,
          kind: {
            perDay: w.caps.reachComments,
            taken: kept.filter((r) => !r.karma).map((r) => new Date(r.at)),
          },
        },
      ),
    ];
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
/** The platform's standing no: forbidden (comments off), not found, gone. */
const CLOSED = [403, 404, 410];

/**
 * A slot's send failed for good. The row leaves the schedule so the next pass slots it again;
 * a post failing its second slot is skipped. A post the platform says is gone or closed (403,
 * 404, 410: comments off, post deleted) is skipped at once: a retry cannot help it. A thread
 * retries until it goes stale. A send that
 * may have gone out never comes here: it waits unsure in To approve (`send_attempts`), and
 * the scheduler leaves it alone.
 */
export async function sendFailed(
  db: Queryable,
  kind: "post" | "thread",
  id: string,
  why: string,
  status?: number,
): Promise<"retry" | "skipped"> {
  if (kind === "thread") {
    await db.update(redditThreads).set({ sendAt: null }).where(eq(redditThreads.id, id));
    return "retry";
  }
  const [r] = await db
    .select({ reason: reachPosts.stateReason })
    .from(reachPosts)
    .where(eq(reachPosts.id, Number(id)));
  // One retry for a send that failed, none for a post that will never take it.
  const again = CLOSED.includes(status ?? 0) || (r?.reason?.startsWith(SEND_FAILED) ?? false);
  await db
    .update(reachPosts)
    .set({
      sendAt: null,
      stateReason: `${SEND_FAILED}${why}`.slice(0, 5000),
      ...(again ? { state: "skipped" as const } : {}),
    })
    .where(and(eq(reachPosts.id, Number(id)), eq(reachPosts.state, "queued")));
  return again ? "skipped" : "retry";
}

/**
 * Autobrowse said nothing went out (the browser was busy, the page never loaded). The row leaves
 * the schedule so the next pass slots it again, and it spends no retry.
 */
export async function sendHeld(
  db: Queryable,
  kind: "post" | "thread",
  id: string,
  why: string,
): Promise<void> {
  if (kind === "thread") {
    await db.update(redditThreads).set({ sendAt: null }).where(eq(redditThreads.id, id));
    return;
  }
  await db
    .update(reachPosts)
    .set({ sendAt: null, stateReason: `Nothing went out: ${why}`.slice(0, 5000) })
    .where(and(eq(reachPosts.id, Number(id)), eq(reachPosts.state, "queued")));
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
