/**
 * A draft by kind (designs/2026-10-06-content-desk.md, 3 and 4; 2026-11-02-starling.md, R3): the
 * text William finishes before it goes out, read with what Claude needs beside it and written to
 * the field the console edits. Keyed by the Inbox prefix (`draft:12`, `comment:3`, `thread:t3_x`).
 * The owning package writes each kind (outbound its threads, posts and DMs; conversations its
 * comments; inbound its own posts); the app composes them for `draftDesk`.
 */
import type { Queryable } from "@wren/db";

/** What `wren drafts list --type` names: a post is an Inbox `draft:`. */
export const DRAFT_TYPES = ["post", "comment", "thread", "dm", "invite", "onpost"] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

export interface DraftItem {
  /** What it is, for the prompt: "LinkedIn post", "Reddit comment answer". */
  what: string;
  platform?: string;
  /** One line for a list: the post's title, who commented. */
  title: string;
  draft: string | null;
  /** Its platform's cap on the draft. */
  max: number;
  /** Whether the draft can still change: waiting on William, not sent. */
  open: boolean;
  /** What Claude reads beside it: the post, the comment, the thread. */
  context: string;
  /** The platform's playbook and comments SOP; "" = none. */
  guide: string;
  /** His last 5 edits of this kind as a prompt block (`readDraft` adds it); "" = none. */
  edits?: string;
  /** A comment: what it answers, to pick his past decisions closest to it. */
  about?: string;
  /** A comment: his past sent and turned-down comments as a prompt block (`readDraft`); "" = none. */
  examples?: string;
}

export interface Waiting {
  item: string;
  type: DraftType;
  title: string;
  draft: string | null;
  at: Date;
}

export interface DraftKind {
  type: DraftType;
  /** The records whose edits teach this kind (content desk, 6): a DM reply and a first message are one. */
  edits: readonly string[];
  read: (db: Queryable, id: string) => Promise<DraftItem | null>;
  /** The same field the console edits; throws when it can't (sent, over the cap). */
  write: (db: Queryable, id: string, text: string | null) => Promise<void>;
  /** Drafts waiting on William, newest first. */
  waiting: (db: Queryable, limit: number) => Promise<Waiting[]>;
  /** The text's version, when the page's Approve names one (a post). */
  version?: (text: string) => string;
}

/** Each kind by its Inbox prefix. */
export type DraftKinds = Record<string, DraftKind>;

/** The draft a read or write asked for is gone: the page's words for it. */
export const GONE = "That draft isn't here any more. Reload the page to see what's left.";

const SITE: Record<string, string> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  youtube: "YouTube",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  threads: "Threads",
  google_business: "Business Profile",
};
/** A platform's name as a draft's `what` and title say it. */
export const siteName = (p: string) => SITE[p] ?? p;

/** "Label: value" blocks, the empty ones left out. */
export const factsBlock = (pairs: [string, unknown][]) =>
  pairs
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}:\n${String(v)}`)
    .join("\n\n");
