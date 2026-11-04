import type { Need, RouteApps } from "./access.js";

/**
 * MarketingConsole's handlers (`@wren/starling-inbound/restate`) and what each needs: a client's Marketing
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
  draftUpload: "act",
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
  // An unsure send's settle (designs/2026-10-16-maybe-sent.md): the client's approver only.
  sendSettle: "act",
  // Auto-reply per channel: InboxDesk checks `manage` to change it.
  inboxAuto: "read",
  inboxAutoSet: "read",
  // Client reports (designs/2026-10-09-client-reports.md): owners and admins.
  reports: "manage",
  reportSave: "manage",
  reportDelete: "manage",
  reportRun: "manage",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type; drafts are Content's, replies Inbox's, reports Map's. */
export const MARKETING_CONSOLE_APPS = {
  "*": null,
  approveDraft: "content",
  rejectDraft: "content",
  redraft: "content",
  draftFields: "content",
  draftUpload: "content",
  draftAttach: "content",
  draftFunnel: "content",
  draftSlides: "content",
  promote: "content",
  inboxReply: "inbox",
  inboxAsk: "inbox",
  inboxSuggest: "inbox",
  inboxNote: "inbox",
  inboxAssign: "inbox",
  inboxTake: "inbox",
  inboxStatus: "inbox",
  inboxSnooze: "inbox",
  inboxApprove: "inbox",
  inboxDrop: "inbox",
  sendSettle: "inbox",
  inboxAuto: "inbox",
  inboxAutoSet: "inbox",
  reports: "map",
  reportSave: "map",
  reportDelete: "map",
  reportRun: "map",
} as const satisfies RouteApps<typeof MARKETING_CONSOLE_ROUTES>;
type MarketingConsoleRoute = keyof typeof MARKETING_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const MARKETING_CONSOLE_WRITES: readonly MarketingConsoleRoute[] = [
  "approveDraft",
  "rejectDraft",
  "redraft",
  "draftFields",
  "draftUpload",
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
  "sendSettle",
  "inboxAutoSet",
  "reportSave",
  "reportDelete",
  "reportRun",
];

/**
 * The portal flag that opens Post now on a client's drafts (a yes that posts on the next pass,
 * not the next slot): the button needs it, and so does `approveDraft` with `now`. Seeded by
 * migration on for the app reviewers' test client only.
 */
export const POST_NOW = "post_now";
