/**
 * An Inbox thread's team state (designs/2026-10-07-inbox-reply.md): who has it, open, waiting or
 * closed, snoozed until when. With none kept, the channel's own state says it.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { type InboxStatus, type InboxThread, inboxThreads } from "../schema.js";

export type ThreadStatus = InboxStatus | "snoozed";

/** Splits a typed id (`dm:5`) into its type and the row's own id. */
export const typed = (id: string): readonly [string, string] => {
  const at = id.indexOf(":");
  return at < 0 ? ["", id] : [id.slice(0, at), id.slice(at + 1)];
};

/** The status a thread shows with none kept: theirs unanswered is open, ours last is waiting. */
export function derivedStatus(state: unknown): InboxStatus {
  if (state === "new" || state === "waiting") return "open";
  if (state === "answered") return "waiting";
  return "closed";
}

const time = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" || typeof v === "number") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
};

/**
 * What a row shows: its kept status, unless they wrote after it was set (their word unanswered
 * and newer): then open again. Snoozed until `snooze_until`, or until they write.
 */
export function statusOf(
  row: { state: unknown; at: unknown },
  kept: Pick<InboxThread, "status" | "statusAt" | "snoozeUntil"> | undefined,
  now: Date,
): ThreadStatus {
  const derived = derivedStatus(row.state);
  if (!kept) return derived;
  const at = time(row.at);
  const set = kept.statusAt?.getTime() ?? null;
  const wroteSince = derived === "open" && at !== null && set !== null && at > set;
  if (wroteSince) return "open";
  if (kept.snoozeUntil && kept.snoozeUntil.getTime() > now.getTime()) return "snoozed";
  return kept.status ?? derived;
}

/** Every kept thread state, by thread. A few hundred rows at most: the Inbox's own size. */
export async function threadStates(db: Queryable): Promise<Map<string, InboxThread>> {
  const rows = await db.select().from(inboxThreads);
  return new Map(rows.map((r) => [r.thread, r]));
}

export interface ThreadChange {
  /** An email, or null to leave it with nobody. */
  assignee?: string | null;
  status?: InboxStatus;
  /** Until when; null wakes it. */
  snoozeUntil?: Date | null;
}

/** Keep a change to one thread's team state; fields left out keep theirs. */
export async function setThread(
  db: Queryable,
  thread: string,
  change: ThreadChange,
  by: string,
  now = new Date(),
): Promise<InboxThread> {
  const set = {
    ...(change.assignee === undefined ? {} : { assignee: change.assignee?.toLowerCase() ?? null }),
    ...(change.status === undefined ? {} : { status: change.status, statusAt: now }),
    // A snooze counts from now: only a message after it wakes the thread.
    ...(change.snoozeUntil === undefined ? {} : { snoozeUntil: change.snoozeUntil, statusAt: now }),
    updatedBy: by.toLowerCase(),
    updatedAt: now,
  };
  const [row] = await db
    .insert(inboxThreads)
    .values({ thread, ...set })
    .onConflictDoUpdate({ target: inboxThreads.thread, set })
    .returning();
  if (!row) throw new Error(`thread ${thread} was not kept`);
  return row;
}

/** One thread's kept state, or none. */
export async function threadState(db: Queryable, thread: string): Promise<InboxThread | null> {
  const [row] = await db.select().from(inboxThreads).where(sql`${inboxThreads.thread} = ${thread}`);
  return row ?? null;
}
