/**
 * A Facebook Page's inbox (Messenger, or its Instagram), as autobrowse `meta GET
 * /{pageId}/conversations` reads it with the Page's own token. The client's DM reader
 * (`readDms`) parses it.
 */

/** Messages per conversation read each time. */
export const PAGE_INBOX_TAIL = 10;

/** The request: newest conversations first, each with its last few messages. */
export const pageInboxQuery = (platform: "facebook" | "instagram", limit = 25) => ({
  platform: platform === "instagram" ? "instagram" : "messenger",
  fields: `participants,updated_time,messages.limit(${PAGE_INBOX_TAIL}){id,message,from,created_time}`,
  limit,
});

/** One message of a conversation as a read shows it. */
export interface PageMessage {
  id: string;
  text: string;
  at: string;
  /** Sent by the account that read it. */
  mine: boolean;
}

export interface PageThread {
  /** The person on the other side: the platform's id for them, and how they show. */
  them: { id: string; handle: string; name: string | null };
  /** When the conversation last moved, ISO; null when Graph sent none. */
  updatedAt: string | null;
  /** Oldest first, those with words only. */
  messages: PageMessage[];
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
