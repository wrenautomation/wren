/**
 * The apps a client connects (designs/2026-10-09-connectors.md): where each signs in, what it
 * reads, and how its token endpoint wants the app's keys. Read-only scopes only. No imports:
 * the portal's Worker reads it.
 */
export const CONNECTOR_APPS = ["hubspot", "quickbooks", "jobber"] as const;
export type ConnectorApp = (typeof CONNECTOR_APPS)[number];

export interface AppSpec {
  label: string;
  authorize: string;
  token: string;
  /** Asked for in the link; Jobber's are set on its developer app, so none. */
  scopes: string[];
  /** How the token endpoint takes the app's id and secret. */
  auth: "body" | "basic";
  /** What the page says it reads. */
  reads: string;
  /** What it tells workflows. */
  fires: string;
}

export const APPS: Record<ConnectorApp, AppSpec> = {
  hubspot: {
    label: "HubSpot",
    authorize: "https://app.hubspot.com/oauth/authorize",
    token: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.companies.read"],
    auth: "body",
    reads: "Contacts, with their company, owner and last contact.",
    fires: "A contact added.",
  },
  quickbooks: {
    label: "QuickBooks",
    authorize: "https://appcenter.intuit.com/connect/oauth2",
    token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    auth: "basic",
    reads: "Customers and invoices.",
    fires: "A customer added, an invoice paid.",
  },
  jobber: {
    label: "Jobber",
    authorize: "https://api.getjobber.com/api/oauth/authorize",
    token: "https://api.getjobber.com/api/oauth/token",
    scopes: [],
    auth: "body",
    reads: "Clients and jobs.",
    fires: "A client added, a job done.",
  },
};

export const isConnectorApp = (v: unknown): v is ConnectorApp =>
  (CONNECTOR_APPS as readonly unknown[]).includes(v);

/** The key store's names for Wren's developer app: `CONNECTOR_HUBSPOT_ID`, `..._SECRET`. */
export const appKeyName = (app: ConnectorApp, part: "ID" | "SECRET") =>
  `CONNECTOR_${app.toUpperCase()}_${part}`;
