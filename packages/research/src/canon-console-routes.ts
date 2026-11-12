import type { Need, RouteApps } from "@wren/core/access";

/** CanonConsole's handlers and what each needs. Wren's team only. Type imports only. */
export const CANON_CONSOLE_ROUTES = {
  references: "wren:team",
  reference: "wren:team",
  // the Add box (designs/2026-11-12-canon-references.md D4): asks go in a queue a drain files
  adds: "wren:team",
  add: "wren:team",
  retry: "wren:team",
  upload: "wren:team",
} as const satisfies Record<string, Need>;
export const CANON_CONSOLE_APPS = { "*": "canon" } as const satisfies RouteApps<
  typeof CANON_CONSOLE_ROUTES
>;
// edits to a record stay in Canon through the CLI; the page only asks for an add
export const CANON_CONSOLE_WRITES: readonly (keyof typeof CANON_CONSOLE_ROUTES)[] = [
  "add",
  "retry",
  "upload",
];
