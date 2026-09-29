/** The portal API's handlers: the service serves these, the edge Worker opens only these. No imports, so the Worker bundles it alone. */
export const PORTAL_ROUTES = ["me", "overview", "health", "people", "person", "raw"] as const;
export type PortalRoute = (typeof PORTAL_ROUTES)[number];
