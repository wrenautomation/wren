/** The portal API's handlers: the service serves these, the edge Worker opens only these. No imports, so the Worker bundles it alone. */
export const PORTAL_ROUTES = [
  "overview",
  "person",
  "emails",
  "approve",
  "unapprove",
  "skip",
  "book",
  "unbook",
  "change",
  "called",
  "uncalled",
  "run",
  "work",
  "recordsTypes",
  "recordsList",
  "recordsGet",
  "recordsExport",
  "recordsStats",
] as const;
export type PortalRoute = (typeof PORTAL_ROUTES)[number];
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
];
