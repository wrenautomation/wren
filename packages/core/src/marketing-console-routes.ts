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
  draftFunnel: "act",
  draftSlides: "act",
  promote: "act",
  // The Inbox on the client's own threads (designs/2026-10-07-inbox-reply.md): InboxDesk checks
  // `act` on the thread's channel, and `effect` and the approver before a reply sends.
  inboxReply: "act",
  inboxAsk: "act",
  inboxSuggest: "act",
  inboxNote: "act",
  inboxAssign: "act",
  inboxTake: "act",
  inboxStatus: "act",
  inboxSnooze: "act",
  inboxApprove: "act",
  inboxDrop: "act",
  // Auto-reply per channel: InboxDesk checks `manage` to change it.
  inboxAuto: "read",
  inboxAutoSet: "read",
  // Client reports (designs/2026-10-09-client-reports.md): owners and admins.
  reports: "manage",
  reportSave: "manage",
  reportDelete: "manage",
  reportRun: "manage",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type; a verdict is Marketing's. */
export const MARKETING_CONSOLE_APPS = {
  "*": null,
  approveDraft: "marketing",
  rejectDraft: "marketing",
  redraft: "marketing",
  draftFields: "marketing",
  draftAttach: "marketing",
  draftFunnel: "marketing",
  draftSlides: "marketing",
  promote: "marketing",
  inboxReply: "marketing",
  inboxAsk: "marketing",
  inboxSuggest: "marketing",
  inboxNote: "marketing",
  inboxAssign: "marketing",
  inboxTake: "marketing",
  inboxStatus: "marketing",
  inboxSnooze: "marketing",
  inboxApprove: "marketing",
  inboxDrop: "marketing",
  inboxAuto: "marketing",
  inboxAutoSet: "marketing",
  reports: "marketing",
  reportSave: "marketing",
  reportDelete: "marketing",
  reportRun: "marketing",
} as const satisfies RouteApps<typeof MARKETING_CONSOLE_ROUTES>;
export type MarketingConsoleRoute = keyof typeof MARKETING_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const MARKETING_CONSOLE_WRITES: readonly MarketingConsoleRoute[] = [
  "approveDraft",
  "rejectDraft",
  "redraft",
  "draftFields",
  "draftAttach",
  "draftFunnel",
  "draftSlides",
  "promote",
  "inboxReply",
  "inboxAsk",
  "inboxSuggest",
  "inboxNote",
  "inboxAssign",
  "inboxTake",
  "inboxStatus",
  "inboxSnooze",
  "inboxApprove",
  "inboxDrop",
  "inboxAutoSet",
  "reportSave",
  "reportDelete",
  "reportRun",
];
