import type { Need, RouteApps } from "@wren/core/access";

/**
 * The portal API's handlers and what each needs (`@wren/core/access`): the service serves these
 * behind the guard, the edge Worker opens only these. Type imports only, so the Worker bundles
 * it alone.
 */
export const PORTAL_ROUTES = {
  overview: "read",
  person: "read",
  emails: "read",
  approve: "act",
  unapprove: "act",
  skip: "act",
  book: "act",
  unbook: "act",
  change: "act",
  called: "act",
  uncalled: "act",
  settle: "act",
  // Loading a file adds people to the list: its owner's call, not any member's.
  importPreview: "manage",
  importRun: "manage",
  run: "read",
  work: "read",
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): Reactivation's emails; records check each type. */
export const PORTAL_APPS = {
  "*": { app: "reactivation", channel: "email" },
  overview: "reactivation",
  person: "reactivation",
  importPreview: "people",
  importRun: "people",
  run: "reactivation",
  work: null,
  recordsTypes: null,
  recordsList: null,
  recordsGet: null,
  recordsExport: null,
  recordsStats: null,
} as const satisfies RouteApps<typeof PORTAL_ROUTES>;
type PortalRoute = keyof typeof PORTAL_ROUTES;
/** The ones that change a list: never cached, never on the demo. */
export const PORTAL_WRITES: readonly PortalRoute[] = [
  "approve",
  "unapprove",
  "skip",
  "book",
  "unbook",
  "change",
  "called",
  "uncalled",
  "settle",
  "importPreview",
  "importRun",
];

/**
 * The Import page's file: up to this many bytes and people in one go. The rows are the tight one:
 * a load is one transaction, and 1,000 people is about 20 s here and a few thousand locks.
 */
export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 1000;
/**
 * The largest request the edge takes on the routes that carry a file (the others keep its 16 KB):
 * the file as base64, and the columns. Well under the 6 MB a Lambda invoke takes.
 */
export const PORTAL_MAX_BODY: Readonly<Record<string, number>> = {
  importPreview: Math.ceil((IMPORT_MAX_BYTES * 4) / 3) + 16 * 1024,
  importRun: Math.ceil((IMPORT_MAX_BYTES * 4) / 3) + 16 * 1024,
};
