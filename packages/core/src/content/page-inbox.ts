/**
 * A Facebook Page's inbox (Messenger, or its Instagram), as autobrowse `meta GET
 * /{pageId}/conversations` reads it with the Page's own token. One parser for both readers: a
 * client's DMs (`readDms`) and the look for a private reply we sent from a comment
 * (designs/2026-10-16-maybe-sent.md, `private:`).
 */
import { CLOCK_SLACK_MS, type Seen, type SeenMessage, sameWords, unclear } from "../maybe-sent.js";

/** Messages per conversation read each time. */
export const PAGE_INBOX_TAIL = 10;

/** The request: newest conversations first, each with its last few messages. */
export const pageInboxQuery = (platform: "facebook" | "instagram", limit = 25) => ({
  platform: platform === "instagram" ? "instagram" : "messenger",
  fields: `participants,updated_time,messages.limit(${PAGE_INBOX_TAIL}){id,message,from,created_time}`,
  limit,
});

export interface PageThread {
  /** The person on the other side: the platform's id for them, and how they show. */
  them: { id: string; handle: string; name: string | null };
  /** When the conversation last moved, ISO; null when Graph sent none. */
  updatedAt: string | null;
  /** Oldest first, those with words only. */
  messages: SeenMessage[];
  /** Older messages than these exist in the conversation. */
  more: boolean;
}

export interface PageInbox {
  /** Newest first. */
  threads: PageThread[];
  /** No conversation older than these exists: the read is the whole inbox. */
  full: boolean;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const listOf = (v: unknown) => ((v as { data?: Json[] } | undefined)?.data ?? []) as Json[];
const hasNext = (v: unknown) => !!(v as { paging?: { next?: unknown } } | undefined)?.paging?.next;

/** The read's answer; `self` is the Page's id (Messenger) or its Instagram account's. */
export function pageInboxOf(body: unknown, self: string): PageInbox {
  const threads = listOf(body).flatMap((conv): PageThread[] => {
    const them = listOf(conv.participants).find((p) => String(p.id) !== self);
    if (!them) return [];
    const messages = listOf(conv.messages).map((m) => ({
      id: String(m.id),
      text: String(m.message ?? ""),
      at: String(m.created_time ?? ""),
      mine: String((m.from as Json | undefined)?.id ?? "") === self,
    }));
    return [
      {
        them: {
          id: String(them.id),
          handle: str(them.username) ?? String(them.id),
          name: str(them.name) ?? str(them.username),
        },
        updatedAt: str(conv.updated_time),
        messages: messages.filter((m) => m.text).reverse(),
        more: hasNext(conv.messages),
      },
    ];
  });
  return { threads, full: !hasNext(body) };
}

const same = (a: string | null, b: string) =>
  !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Our private reply to `to` (their handle on Instagram, their name on Facebook): found in their
 * conversation; absent when every message of it was read, or no conversation with them is in an
 * inbox read that reaches back past `since` (a conversation our reply was in moved after it);
 * else unclear. Meta allows one private reply per comment, so a wrong absent sends nothing twice.
 */
export function seenPrivateReply(
  inbox: PageInbox,
  q: { to: string; text: string; since: string; url?: string | null },
): Seen {
  const thread = inbox.threads.find((t) => same(t.them.handle, q.to) || same(t.them.name, q.to));
  const floor = new Date(q.since).getTime() - CLOCK_SLACK_MS;
  const before = (at: string | null | undefined) => !!at && new Date(at).getTime() < floor;
  if (thread) {
    // Only words sent since the send began: the same words sent them earlier are another send.
    const hit = [...thread.messages]
      .reverse()
      .find((m) => m.mine && !before(m.at) && sameWords(m.text, q.text));
    if (hit) return { kind: "found", ref: hit.id, at: hit.at || null, url: q.url ?? null };
    if (!thread.more || before(thread.messages[0]?.at)) return { kind: "absent" };
    return unclear("their conversation as read does not reach back to the send");
  }
  if (inbox.full) return { kind: "absent" };
  if (before(inbox.threads.at(-1)?.updatedAt)) return { kind: "absent" };
  return unclear(
    "no conversation with them in the inbox as read, and it does not reach back to the send",
  );
}
