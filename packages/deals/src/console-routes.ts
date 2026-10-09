import type { Need, RouteApps } from "@wren/core/access";

/**
 * DealsConsole's handlers (`console.ts`) and what each needs: the owner's deals, read by whoever
 * may see that client (or Wren's own); every change is an act in Opportunities. The edge Worker
 * opens only these and refuses the writes on the demo. Type imports only, so the Worker bundles
 * it alone.
 */
export const DEALS_CONSOLE_ROUTES = {
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  recordsEdit: "act",
  recordsUndo: "act",
  board: "read",
  create: "act",
  edit: "act",
  assign: "act",
  remove: "act",
  move: "act",
  won: "act",
  lost: "act",
  pipelineSave: "act",
  pipelineDrop: "act",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type; the rest are Opportunities. */
export const DEALS_CONSOLE_APPS = {
  "*": "deals",
  recordsTypes: null,
  recordsList: null,
  recordsGet: null,
  recordsExport: null,
  recordsStats: null,
} as const satisfies RouteApps<typeof DEALS_CONSOLE_ROUTES>;
export type DealsConsoleRoute = keyof typeof DEALS_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const DEALS_CONSOLE_WRITES: readonly DealsConsoleRoute[] = [
  "recordsEdit",
  "recordsUndo",
  "create",
  "edit",
  "assign",
  "remove",
  "move",
  "won",
  "lost",
  "pipelineSave",
  "pipelineDrop",
];
