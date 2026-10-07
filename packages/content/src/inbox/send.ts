/**
 * A reply from the Inbox (designs/2026-10-07-inbox-reply.md): Send or Ask to send, then the
 * channel's own path. Every check that path runs still runs; this only decides who says yes.
 */
import { type Approver, can, mayApprove, type Who, WREN } from "@wren/core/access";
import { type Client, sendsOn } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { and, desc, eq } from "drizzle-orm";
import { type InboxChannel, type InboxReply, inboxReplies } from "../schema.js";
import { optionsOf, partyOf, type ReplyOption } from "./conversation.js";

/** The client's `sends` part each channel answers under (`sendsOn`). */
export const SENDS_PART: Record<InboxChannel, string> = {
  dm: "reach.outreach",
  comment: "content.posting",
  email: "follow_up",
  text: "follow_up",
};

/** How long a reply may run. */
export const REPLY_MAX = 4000;

export interface Gate {
  mode: "send" | "ask";
  /** Why it asks; null when it sends. */
  why: string | null;
}

/**
 * Send now, or ask for a yes first. Wren's own threads send for anyone holding `effect`. A
 * client's ask while its sends for that part are off, while the client approves its own, or
 * when this viewer may not approve for it.
 */
export function replyGate(o: {
  channel: InboxChannel;
  client: Pick<Client, "id" | "sends" | "approver"> | null;
  who: Who;
}): Gate {
  const at = o.client?.id ?? WREN;
  if (!can(o.who, "effect", at))
    return { mode: "ask", why: "You can't send. Someone who can says yes." };
  if (!o.client) return { mode: "send", why: null };
  if (!sendsOn(o.client, SENDS_PART[o.channel]))
    return { mode: "ask", why: "Sends are off for this client." };
  const approver = (o.client.approver ?? "wren") as Approver;
  if (approver === "client") return { mode: "ask", why: "The client approves its own sends." };
  if (!mayApprove(o.who, o.client.id, approver))
    return { mode: "ask", why: "You can't approve for this client." };
  return { mode: "send", why: null };
}

/**
 * The option a reply names, checked against the thread's own list: a caller can't point a reply
 * at someone else's contact. Throws why it can't go.
 */
export async function pickOption(
  db: Queryable,
  thread: string,
  channel: InboxChannel,
  target: string,
): Promise<ReplyOption> {
  const p = await partyOf(db, thread);
  if (!p) throw new Error("that thread is gone");
  const o = (await optionsOf(db, p)).find((x) => x.channel === channel && x.target === target);
  if (!o) throw new Error("they can't be reached there from this thread");
  if (o.off) throw new Error(o.off);
  return o;
}

/** Words fit to send: trimmed, not empty, not too long. Throws why not. */
export function replyWords(body: unknown): string {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw new Error("the reply is empty");
  if (text.length > REPLY_MAX) throw new Error(`a reply runs ${REPLY_MAX} characters`);
  return text;
}

/**
 * Each channel's existing send path. The worker's calls Restate (`ReachDesk.reply`,
 * `SmsDesk.reply`, `ReachDesk.answerComment`, `Disposition.approve` or `.reply`); tests pass a
 * fake. Each throws what its path refused.
 */
export interface ReplySender {
  dm(contactId: number, body: string): Promise<void>;
  text(contactId: number, body: string): Promise<void>;
  comment(commentId: number, body: string): Promise<void>;
  /** An open call invite: approve it with these words (it books its time too). */
  invite(inviteId: number, body: string): Promise<void>;
  /** An email with no open invite: answer in its thread. */
  email(threadEventId: number, body: string): Promise<void>;
}

/** Send `body` on `option`'s path. */
export async function sendOn(sender: ReplySender, option: ReplyOption, body: string) {
  const t = option.target;
  const n = (s: string) => {
    const v = Number(s);
    if (!Number.isInteger(v)) throw new Error(`bad target ${t}`);
    return v;
  };
  switch (option.channel) {
    case "dm":
      return sender.dm(n(t), body);
    case "text":
      return sender.text(n(t), body);
    case "comment":
      return sender.comment(n(t), body);
    case "email":
      return t.startsWith("invite:")
        ? sender.invite(n(t.slice(7)), body)
        : sender.email(n(t.slice(t.indexOf(":") + 1)), body);
  }
}

/** Keep a reply that waits on a yes: To approve lists it as `reply:<id>`. */
export async function askReply(
  db: Queryable,
  o: {
    thread: string;
    option: ReplyOption;
    body: string;
    who: string | null;
    by: string;
    why: string | null;
  },
): Promise<InboxReply> {
  const [row] = await db
    .insert(inboxReplies)
    .values({
      thread: o.thread,
      channel: o.option.channel,
      target: o.option.target,
      who: o.who,
      body: o.body,
      why: o.why,
      askedBy: o.by.toLowerCase(),
    })
    .returning();
  if (!row) throw new Error("the reply was not kept");
  return row;
}

/** One asked reply still waiting, or why not. */
export async function waitingReply(db: Queryable, id: number): Promise<InboxReply> {
  const [row] = await db.select().from(inboxReplies).where(eq(inboxReplies.id, id));
  if (!row) throw new Error(`no reply ${id}`);
  if (row.state !== "waiting") throw new Error(`that reply was ${row.state} already`);
  return row;
}

/**
 * Settle an asked reply: sent, dropped or failed, by whom. Only a waiting one moves, so a second
 * Approve finds it settled and stops.
 */
export async function settleReply(
  db: Queryable,
  id: number,
  state: "sent" | "dropped" | "failed",
  by: string,
  detail: string | null = null,
  now = new Date(),
): Promise<boolean> {
  const done = await db
    .update(inboxReplies)
    .set({ state, detail, decidedBy: by.toLowerCase(), decidedAt: now })
    .where(and(eq(inboxReplies.id, id), eq(inboxReplies.state, "waiting")))
    .returning({ id: inboxReplies.id });
  return done.length > 0;
}

/** Replies waiting on a yes, newest first: To approve's `reply` rows. */
export function waitingReplies(db: Queryable, limit = 500) {
  return db
    .select()
    .from(inboxReplies)
    .where(eq(inboxReplies.state, "waiting"))
    .orderBy(desc(inboxReplies.askedAt))
    .limit(limit);
}

/** A claimed reply whose send was refused: failed, with why. */
export async function failReply(db: Queryable, id: number, detail: string): Promise<void> {
  await db.update(inboxReplies).set({ state: "failed", detail }).where(eq(inboxReplies.id, id));
}
