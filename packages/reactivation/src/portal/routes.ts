import type { Need } from "@wren/core/access";

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
  run: "read",
  work: "read",
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
} as const satisfies Record<string, Need>;
export type PortalRoute = keyof typeof PORTAL_ROUTES;
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
];
