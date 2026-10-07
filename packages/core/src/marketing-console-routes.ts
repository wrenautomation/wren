import type { Need, RouteApps } from "./access.js";

/**
 * MarketingConsole's handlers (`@wren/content/restate`) and what each needs: a client's Marketing
 * numbers from its own database, once `marketing.stats` is installed. Wren's own Marketing is the
 * console's. A draft's verdict also needs the client's approver (`mayApprove`), which the handler
 * checks. Type imports only, so the Worker bundles it alone.
 */
export const MARKETING_CONSOLE_ROUTES = {
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  approveDraft: "act",
  rejectDraft: "act",
  redraft: "act",
  draftFields: "act",
  draftAttach: "act",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type; a verdict is Marketing's. */
export const MARKETING_CONSOLE_APPS = {
  "*": null,
  approveDraft: "marketing",
  rejectDraft: "marketing",
  redraft: "marketing",
  draftFields: "marketing",
  draftAttach: "marketing",
} as const satisfies RouteApps<typeof MARKETING_CONSOLE_ROUTES>;
export type MarketingConsoleRoute = keyof typeof MARKETING_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const MARKETING_CONSOLE_WRITES: readonly MarketingConsoleRoute[] = [
  "approveDraft",
  "rejectDraft",
  "redraft",
  "draftFields",
  "draftAttach",
];
