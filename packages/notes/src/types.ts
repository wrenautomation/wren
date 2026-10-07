/** Notes' shared words: no imports, so the web bundles it alone. */

export const KINDS = ["note", "dump"] as const;
export type NoteKind = (typeof KINDS)[number];

export const VIA = ["person", "agent"] as const;
export type Via = (typeof VIA)[number];

/** Everyone in the workspace, or only those named. */
export const GENERAL = ["private", "workspace"] as const;
export type General = (typeof GENERAL)[number];

/** A share's role, lowest first. */
export const ROLES = ["view", "comment", "edit"] as const;
export type ShareRole = (typeof ROLES)[number];
/** What a viewer holds on a note: a share's role, or owner. */
export type Role = ShareRole | "owner";

export const VERSION_KINDS = ["auto", "named", "restore", "import"] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

/** Editor JSON (ProseMirror's shape): what `body` holds. */
export interface NoteJson {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NoteJson[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** An agent's author id: `agent:<name>`. */
export const AGENT = "agent:";
export const isAgent = (who: string | null | undefined): boolean => !!who?.startsWith(AGENT);

/** Body JSON for a note with nothing in it. */
export const EMPTY: NoteJson = { type: "doc", content: [{ type: "paragraph" }] };

/** The Yjs names in each note's doc. */
export const Y_BODY = "default";
export const Y_TITLE = "title";

/** Largest Yjs update one call takes (a pasted chapter, base64 included). */
export const UPDATE_MAX = 4 * 1024 * 1024;

/** A comment's range: Yjs relative positions (`Y.relativePositionToJSON`) of its two ends. */
export interface CommentAnchor {
  from: unknown;
  to: unknown;
}

/** Suggest mode's marks: added and removed text, each with who and when (to the minute). */
export const SUGGEST_ADD = "suggestAdd";
export const SUGGEST_DEL = "suggestDel";

/** A comment's longest body, and the quote it keeps. */
export const COMMENT_MAX = 10_000;
export const QUOTE_MAX = 500;
