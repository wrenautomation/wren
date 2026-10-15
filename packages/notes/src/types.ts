/** Notes' shared words: no imports, so the web bundles it alone. */

export const KINDS = ["note", "dump", "task"] as const;
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * An owner as people say it, the one place that decides: `agent:claude` is "Claude"; a person is
 * their address, or with `first` just their first name ("will@firm.com" is "Will"). Faces,
 * filters, the List, the Timeline and the CLI all read it, and the wren mark marks an agent.
 */
export function ownerName(who: string | null | undefined, first = false): string {
  if (!who) return "";
  if (isAgent(who)) return cap(who.slice(AGENT.length));
  if (!first) return who;
  const local = who.split("@")[0] ?? who;
  return cap(local.split(/[._-]/)[0] ?? local);
}

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

// ---- Boards (designs/2026-10-14-boards.md) ----

/** A board's column: `done` ones close the cards that land in them. */
export interface BoardColumn {
  id: string;
  name: string;
  done: boolean;
}

/** The columns a new board starts with. */
export const DEFAULT_COLUMNS: readonly BoardColumn[] = [
  { id: "todo", name: "To do", done: false },
  { id: "doing", name: "Doing", done: false },
  { id: "done", name: "Done", done: true },
];
export const DEFAULT_BOARD = "Work";

/** What a `task_moves` row records. */
export const MOVE_KINDS = ["create", "move", "assign", "close", "reopen"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

/** A card's line in the Timeline, in plain words ("moved it to Doing"). */
export function moveWords(
  m: { kind: MoveKind; to: string | null; assignee: string | null; why: string | null },
  nameOfPerson: (who: string) => string = (w) => w,
): string {
  const to = m.to ?? "";
  const why = m.why ? `: ${m.why}` : "";
  switch (m.kind) {
    case "create":
      return `made it in ${to}`;
    case "move":
      return `moved it to ${to}${why}`;
    case "assign":
      return m.assignee
        ? `gave it to ${nameOfPerson(m.assignee)}${why}`
        : `took the owner off${why}`;
    case "close":
      return `closed it${to ? ` (${to})` : ""}${why}`;
    case "reopen":
      return `reopened it${to ? ` in ${to}` : ""}${why}`;
  }
}
