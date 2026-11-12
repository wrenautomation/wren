import type { Need, RouteApps } from "@wren/core/access";

/** CanonConsole's handlers and what each needs. Wren's team only. Type imports only. */
export const CANON_CONSOLE_ROUTES = {
  references: "wren:team",
  reference: "wren:team",
} as const satisfies Record<string, Need>;
export const CANON_CONSOLE_APPS = { "*": "canon" } as const satisfies RouteApps<
  typeof CANON_CONSOLE_ROUTES
>;
// read only in v1: edits stay in Canon through the CLI (designs/2026-11-12-canon-references.md)
export const CANON_CONSOLE_WRITES: readonly (keyof typeof CANON_CONSOLE_ROUTES)[] = [];
