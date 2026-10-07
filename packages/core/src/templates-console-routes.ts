import type { Need, RouteApps } from "./access.js";

/**
 * TemplatesConsole's handlers and what each needs: the edge Worker opens only these. Wren's own
 * Library, so Wren's team; each handler checks again at the template's app and channel
 * (`templateAt`). Type imports only.
 */
export const TEMPLATES_CONSOLE_ROUTES = {
  list: "wren:read",
  detail: "wren:read",
  preview: "wren:read",
  save: "wren:act",
  publish: "wren:act",
  approve: "wren:act",
  decline: "wren:act",
  restore: "wren:act",
  reset: "wren:act",
  move: "wren:act",
  renameFolder: "wren:act",
} as const satisfies Record<string, Need>;
/**
 * The handler checks: each template's own app and channel once it has the ref, so a login with
 * `act` on Outbound's email edits email copy without the Library. Folders are the Library's.
 */
export const TEMPLATES_CONSOLE_APPS = {
  "*": null,
  move: "library",
  renameFolder: "library",
} as const satisfies RouteApps<typeof TEMPLATES_CONSOLE_ROUTES>;
export const TEMPLATES_CONSOLE_WRITES: readonly (keyof typeof TEMPLATES_CONSOLE_ROUTES)[] = [
  "save",
  "publish",
  "approve",
  "decline",
  "restore",
  "reset",
  "move",
  "renameFolder",
];
