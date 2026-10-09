import type { Need, RouteApps } from "@wren/core/access";

/**
 * DocumentsConsole's handlers (`console.ts`) and what each needs: a client's documents and
 * templates, read by whoever may see that client; writing, sending and approving are acts in
 * Documents (approving also checks the client's approver). The edge Worker opens only these and
 * refuses the writes on the demo. Type imports only, so the Worker bundles it alone.
 */
export const DOCUMENTS_CONSOLE_ROUTES = {
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  templates: "read",
  pdf: "read",
  create: "act",
  update: "act",
  send: "act",
  approve: "act",
  decline: "act",
  void: "act",
  remind: "act",
  duplicate: "act",
  templateSave: "act",
  templateArchive: "act",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type; the rest are Documents. */
export const DOCUMENTS_CONSOLE_APPS = {
  "*": "documents",
  recordsTypes: null,
  recordsList: null,
  recordsGet: null,
  recordsExport: null,
  recordsStats: null,
} as const satisfies RouteApps<typeof DOCUMENTS_CONSOLE_ROUTES>;
export type DocumentsConsoleRoute = keyof typeof DOCUMENTS_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const DOCUMENTS_CONSOLE_WRITES: readonly DocumentsConsoleRoute[] = [
  "create",
  "update",
  "send",
  "approve",
  "decline",
  "void",
  "remind",
  "duplicate",
  "templateSave",
  "templateArchive",
];
