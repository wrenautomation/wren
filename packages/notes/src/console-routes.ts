import type { Need, RouteApps } from "@wren/core/access";

/**
 * NotesConsole's handlers and what each needs: the edge Worker opens only these. Every route is
 * in the workspace's Notes app (Wren's, or the named client's); each handler then checks the
 * note's own role (`access.ts`). Type imports only.
 */
export const NOTES_CONSOLE_ROUTES = {
  home: "read",
  open: "read",
  // A browser's sync: reads with "read"; an edit in it needs the note's edit role and `act`, a
  // suggestion its comment role and `comment`.
  sync: "read",
  versions: "read",
  version: "read",
  compare: "read",
  backlinks: "read",
  people: "read",
  file: "read",
  settings: "read",
  comments: "read",
  mentions: "read",
  // Your own mentions, read without opening them: a write about you only, as a star is.
  mentionsRead: "read",
  mentionsUnread: "read",
  star: "read",
  comment: "comment",
  commentEdit: "comment",
  commentDelete: "comment",
  resolve: "comment",
  append: "act",
  drive: "act",
  create: "act",
  capture: "act",
  rename: "act",
  restore: "act",
  nameVersion: "act",
  share: "act",
  general: "act",
  transfer: "act",
  archive: "act",
  move: "act",
  train: "act",
  upload: "act",
  workspaceTrain: "manage",
} as const satisfies Record<string, Need>;

export const NOTES_CONSOLE_APPS = { "*": "notes" } as const satisfies RouteApps<
  typeof NOTES_CONSOLE_ROUTES
>;

/** Refused on the demo and under View as. */
export const NOTES_CONSOLE_WRITES: readonly (keyof typeof NOTES_CONSOLE_ROUTES)[] = [
  "mentionsRead",
  "mentionsUnread",
  "star",
  "comment",
  "commentEdit",
  "commentDelete",
  "resolve",
  "append",
  "drive",
  "create",
  "capture",
  "rename",
  "restore",
  "nameVersion",
  "share",
  "general",
  "transfer",
  "archive",
  "move",
  "train",
  "upload",
  "workspaceTrain",
];
