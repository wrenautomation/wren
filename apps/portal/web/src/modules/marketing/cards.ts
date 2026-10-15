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

/** What waits on a yes: what it is, its words, and when it goes. */
export const APPROVAL_CARD: CardSpec = {
  mark: "platform",
  badge: "kind",
  body: "body",
  facts: ["state", "postTitle", "sendAt", "held", "due"],
  media: "wide",
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
