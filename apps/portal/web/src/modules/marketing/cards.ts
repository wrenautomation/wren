/**
 * Marketing's lists as cards (Rows / Cards in a list's bar): what each card puts first. The
 * rest of Marketing's lists read their cards from their columns.
 */
import type { CardSpec } from "@wren/ui";

/** A draft: its picture or video, its site and state, its words, then format and time. */
export const DRAFT_CARD: CardSpec = {
  mark: "platform",
  badge: "state",
  body: "text",
  facts: ["format", "stage", "scheduled", "created"],
  media: "wide",
};

/**
 * What waits on a yes: what it is, then what we would send (our reply, else the post's words),
 * where it goes and when. A queue he works through, so a phone opens it as cards.
 */
export const APPROVAL_CARD: CardSpec = {
  mark: "platform",
  badge: "kind",
  body: ["draft", "body"],
  facts: ["state", "postTitle", "place", "sendAt", "held", "due"],
  media: "wide",
  phone: "cards",
};

/**
 * Engage: the thread or post first, the reply we drafted under it (else their words), who and
 * where, when it is due, and whether a stranger sees it. His daily queue, so a phone opens it as
 * cards.
 */
export const ENGAGE_CARD: CardSpec = {
  title: ["postTitle", "who"],
  mark: "platform",
  badge: "state",
  body: ["draft", "body"],
  facts: ["who", "place", "body", "due", "held", "proof"],
  phone: "cards",
};

/** Waiting on you: who wrote and how, what they said, our draft reply, and how long ago. */
export const INBOX_CARD: CardSpec = {
  mark: "platform",
  badge: "type",
  body: "body",
  facts: ["postTitle", "draft", "assignee", "at"],
};

/** A comment on our posts: who and where, what they said, our draft answer. */
export const COMMENT_CARD: CardSpec = {
  mark: "platform",
  badge: "state",
  body: "body",
  facts: ["postTitle", "sort", "draft", "at"],
};

/** A client's To approve: the same, with who picked it. */
export const ASKED_REPLY_CARD: CardSpec = {
  badge: "kind",
  facts: ["why", "sendAt", "held", "account", "at"],
};

/** A recording: its cover, its state, its render and Shorts. */
export const VIDEO_CARD: CardSpec = {
  badge: "state",
  facts: ["render", "shorts", "updated"],
  media: "wide",
};

/** A post that went out: its picture, its site, and how it did. */
export const POST_CARD: CardSpec = {
  mark: "platform",
  badge: "format",
  facts: ["published", "views", "engagement", "clicks"],
  media: "wide",
};
