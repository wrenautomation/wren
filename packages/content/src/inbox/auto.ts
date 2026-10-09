/**
 * Auto-reply (designs/2026-10-09-auto-reply.md): what happens when someone writes in, per
 * channel. Suggest drafts a reply at once and it waits in To approve; Auto is held, so it does
 * the same and says so. Off does nothing.
 */
import type { Queryable } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import {
  AUTO_REPLY_MODES,
  type AutoReplyMode,
  autoReplies,
  INBOX_CHANNELS,
  type InboxChannel,
  inboxReplies,
} from "../schema.js";
import { optionsOf, partyOf, type ReplyOption, timelineOf } from "./conversation.js";

/** Who an asked reply drafted on arrival is by. */
export const AUTO_BY = "auto";
/** How long after a message the draft waits, so a burst of messages reads as one. */
export const AUTO_SETTLE_MS = 60_000;
/** Why an Auto channel's draft waits anyway, until William says go. */
export const AUTO_HELD = "Auto is held: nothing sends on its own yet.";

/** Each channel's mode; a channel with no row is Suggest. */
export async function autoModes(db: Queryable): Promise<Record<InboxChannel, AutoReplyMode>> {
  const rows = await db.select().from(autoReplies);
  const out = Object.fromEntries(INBOX_CHANNELS.map((c) => [c, "suggest"])) as Record<
    InboxChannel,
    AutoReplyMode
  >;
  for (const r of rows) out[r.channel] = r.mode;
  return out;
}

export async function setAutoMode(
  db: Queryable,
  channel: string,
  mode: string,
  by: string,
): Promise<void> {
  if (!(INBOX_CHANNELS as readonly string[]).includes(channel))
    throw new Error(`no channel ${channel}`);
  if (!(AUTO_REPLY_MODES as readonly string[]).includes(mode)) throw new Error(`no mode ${mode}`);
  await db
    .insert(autoReplies)
    .values({ channel: channel as InboxChannel, mode: mode as AutoReplyMode, updatedBy: by })
    .onConflictDoUpdate({
      target: autoReplies.channel,
      set: { mode: mode as AutoReplyMode, updatedBy: by, updatedAt: sql`now()` },
    });
}

/** What a reply the spine heard is, as an Inbox thread; null when there is none to answer. */
export async function threadOfReply(
  db: Queryable,
  channel: "email" | "sms" | "dm" | "comment",
  id: number,
): Promise<string | null> {
  if (channel === "comment") return `comment:${id}`;
  if (channel === "sms") return `text:${id}`;
  if (channel === "dm") return `dm:${id}`;
  const [r] = (await db.execute(
    sql`select id from thread_events where enrollment_id = ${id} and kind = 'reply'
      order by coalesce(received_at, created_at) desc, id desc limit 1`,
  )) as unknown as Array<{ id: number }>;
  return r ? `reply:${r.id}` : null;
}

/** The thread's own channel as the Inbox names it. */
export const inboxChannelOf = (channel: "email" | "sms" | "dm" | "comment"): InboxChannel =>
  channel === "sms" ? "text" : channel;

/** "STOP", "unsubscribe": a last message that only opts out gets no reply. */
const OPT_OUT =
  /^\s*(stop|stopall|stop all|unsubscribe|cancel|end|quit|opt ?out|revoke|remove me)\W*$/i;

/**
 * Whether to draft for this thread now, and on which option; else why not. Skips a thread with a
 * reply already waiting, one we answered after their last message, an opt-out, and a channel
 * that can't take a reply.
 */
export async function draftable(
  db: Queryable,
  thread: string,
): Promise<{ option: ReplyOption; who: string | null } | { skip: string }> {
  const p = await partyOf(db, thread);
  if (!p) return { skip: "the thread is gone" };
  const [waiting] = await db
    .select({ id: inboxReplies.id })
    .from(inboxReplies)
    .where(and(eq(inboxReplies.thread, thread), eq(inboxReplies.state, "waiting")))
    .limit(1);
  if (waiting) return { skip: "a reply already waits" };
  const said = (await timelineOf(db, p)).filter(
    (e) => e.direction !== "note" && e.channel !== "touch" && e.channel !== "booking",
  );
  const last = said.at(-1);
  if (last?.direction !== "in") return { skip: "we answered already" };
  if (OPT_OUT.test(last.body)) return { skip: "they opted out" };
  const option = (await optionsOf(db, p)).find((o) => o.own);
  if (!option) return { skip: "no way to answer here" };
  if (option.off) return { skip: option.off };
  return { option, who: p.who };
}
