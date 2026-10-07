import type { Need, RouteApps } from "@wren/core/access";

/**
 * LearnConsole's handlers and what each needs: the edge Worker opens only these. Wren's own
 * learning, so its team only. Type imports only.
 */
export const LEARN_CONSOLE_ROUTES = {
  save: "wren:team",
  follow: "wren:team",
  tell: "wren:team",
  unfollow: "wren:team",
  browse: "wren:team",
  rail: "wren:team",
  home: "wren:team",
  sources: "wren:team",
  mark: "wren:team",
  open: "wren:team",
  progress: "wren:team",
  move: "wren:team",
  tag: "wren:team",
  collectionAdd: "wren:team",
  collectionEdit: "wren:team",
  collectionDrop: "wren:team",
  readAgain: "wren:team",
  toSop: "wren:team",
  search: "wren:team",
  item: "wren:team",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): the Learn app. */
export const LEARN_CONSOLE_APPS = { "*": "learn" } as const satisfies RouteApps<
  typeof LEARN_CONSOLE_ROUTES
>;
export const LEARN_CONSOLE_WRITES: readonly (keyof typeof LEARN_CONSOLE_ROUTES)[] = [
  "save",
  "follow",
  "tell",
  "unfollow",
  "mark",
  "open",
  "progress",
  "move",
  "tag",
  "collectionAdd",
  "collectionEdit",
  "collectionDrop",
  "readAgain",
  "toSop",
];
