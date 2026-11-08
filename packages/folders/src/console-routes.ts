import type { Need, RouteApps } from "@wren/core/access";

/** FoldersConsole's handlers. Wren's team only. Type imports only. */
export const FOLDERS_CONSOLE_ROUTES = {
  tree: "wren:team",
  make: "wren:team",
  rename: "wren:team",
  move: "wren:team",
  drop: "wren:team",
  file: "wren:team",
} as const satisfies Record<string, Need>;
/** No one app: every list shows the tree; wren:team holds it. */
export const FOLDERS_CONSOLE_APPS = { "*": null } as const satisfies RouteApps<
  typeof FOLDERS_CONSOLE_ROUTES
>;
export const FOLDERS_CONSOLE_WRITES: readonly (keyof typeof FOLDERS_CONSOLE_ROUTES)[] = [
  "make",
  "rename",
  "move",
  "drop",
  "file",
];
