/**
 * A reply from the Inbox (designs/2026-10-07-inbox-reply.md): Send or Ask to send, then the
 * channel's own path. Every check that path runs still runs; this only decides who says yes.
 */
import {
  type Approver,
  can,
  isChannel,
  mayApprove,
  type Target,
  type Who,
  WREN,
} from "@wren/core/access";
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

/**
 * The `sends` part a reply answers under: mail to a client's own mailbox under `mail.triage`, the
 * part that reads it in; every other channel by `SENDS_PART`.
 */
export const partOf = (o: Pick<ReplyOption, "channel" | "from">): string =>
  o.from ? MAIL_PART : SENDS_PART[o.channel];

/** The part a client's connected mailboxes read and reply under. */
export const MAIL_PART = "mail.triage";

/** How long a reply may run. */
export const REPLY_MAX = 4000;

export interface Gate {
  mode: "send" | "ask";
  /** Why it asks; null when it sends. */
  why: string | null;
}

/** The app a thread sits in, for access checks: the Inbox is Marketing's record. */
export const INBOX_APP = "marketing";

/**
 * The access channel (`ACCESS_CHANNELS`) a reply goes out on: texts are `sms`, email `email`, a
 * DM or comment its platform. Null when the platform is none we name.
 */
export function accessChannel(channel: InboxChannel, platform: string | null): string | null {
  if (channel === "text") return "sms";
  if (channel === "email") return "email";
  return isChannel(platform) ? platform : null;
}

/** Where this viewer's grants are checked for a reply: the client (or Wren), Marketing, the channel. */
const targetOf = (client: string, channel: string | null): Target => ({
  client,
  app: INBOX_APP,
  channel,
});

/**
 * Send now, or ask for a yes first. The viewer needs `effect` on the reply's channel. Wren's own
 * threads then send. A client's ask while its sends for that part are off, or when its approver
 * setting says someone else says yes: `wren` is Wren's team, `client` its own people, `either`
 * both.
 */
export function replyGate(o: {
  channel: InboxChannel;
  platform?: string | null;
  /** The `sends` part, when not the channel's own (`partOf`). */
  part?: string;
  client: Pick<Client, "id" | "sends" | "approver"> | null;
  who: Who;
}): Gate {
  const at = targetOf(o.client?.id ?? WREN, accessChannel(o.channel, o.platform ?? null));
  if (!can(o.who, "effect", at))
    return { mode: "ask", why: "You can't send. Someone who can says yes." };
  if (!o.client) return { mode: "send", why: null };
  if (!sendsOn(o.client, o.part ?? SENDS_PART[o.channel]))
    return { mode: "ask", why: "Sends are off for this client." };
  const approver = (o.client.approver ?? "wren") as Approver;
  if (!mayApprove(o.who, o.client.id, approver))
    return {
      mode: "ask",
      why:
        approver === "client"
          ? "The client approves its own sends."
          : approver === "wren"
            ? "Wren approves these sends."
            : "You can't approve for this client.",
    };
  return { mode: "send", why: null };
}

/**
 * May this viewer work a client's thread on this channel: assign, note, close, ask? `act` at the
 * client, in Marketing, on the thread's channel.
 */
export const mayWork = (who: Who, client: string, channel: string | null): boolean =>
  can(who, "act", targetOf(client, channel));

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
  /** Mail to a client's mailbox (`watch.mail`): answer in its thread, from that mailbox. */
  mail(mailId: number, body: string): Promise<void>;
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
      if (t.startsWith("invite:")) return sender.invite(n(t.slice(7)), body);
      if (t.startsWith("mail:")) return sender.mail(n(t.slice(5)), body);
      return sender.email(n(t.slice(t.indexOf(":") + 1)), body);
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
