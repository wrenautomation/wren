/** The portal API's handlers: the service serves these, the edge Worker opens only these. No imports, so the Worker bundles it alone. */
export const PORTAL_ROUTES = [
  "overview",
  "health",
  "person",
  "raw",
  "emails",
  "replies",
  "approve",
  "skip",
  "book",
  "setup",
  "run",
  "work",
  "recordsTypes",
  "recordsList",
  "recordsGet",
  "recordsExport",
] as const;
export type PortalRoute = (typeof PORTAL_ROUTES)[number];
/** The ones that change a list: never cached, never on the demo. */
export const PORTAL_WRITES: readonly PortalRoute[] = ["approve", "skip", "book"];
