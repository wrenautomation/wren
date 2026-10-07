import type { Need, RouteApps } from "@wren/core/access";

/**
 * WatchConsole's handlers and what each needs: the edge Worker opens only these. William's own
 * mail, so admins only (`team` is theirs alone). Type imports only.
 */
export const WATCH_CONSOLE_ROUTES = {
  done: "wren:team",
  undone: "wren:team",
  hide: "wren:team",
  show: "wren:team",
  sort: "wren:team",
  addRule: "wren:team",
  removeRule: "wren:team",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): the Inbox. */
export const WATCH_CONSOLE_APPS = { "*": "inbox" } as const satisfies RouteApps<
  typeof WATCH_CONSOLE_ROUTES
>;
export const WATCH_CONSOLE_WRITES: readonly (keyof typeof WATCH_CONSOLE_ROUTES)[] = [
  "done",
  "undone",
  "hide",
  "show",
  "sort",
  "addRule",
  "removeRule",
];
