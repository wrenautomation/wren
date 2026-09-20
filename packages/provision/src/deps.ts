/** What the domain steps need from the world. Built once in the worker; faked in tests. */
import type { CloudflareClient } from "./clients/cloudflare.js";
import type { SignatureClient } from "./clients/gmail-signature.js";
import type { GoogleAdminClient } from "./clients/google-admin.js";
import type { Availability } from "./clients/rdap.js";
import type { Reloader } from "./clients/reload.js";
import type { RosterStore, SecretStore } from "./clients/roster.js";

export interface DkimRecord {
  /** "google._domainkey" */
  name: string;
  /** "v=DKIM1; k=rsa; p=…" */
  value: string;
}

/**
 * The browser legs autobrowse serves as the Restate service `browser`. Each
 * is one call; the host maps its terminal errors to `NeedsHuman`.
 */
export interface BrowserLegs {
  buy(input: { domain: string }): Promise<{ priceText: string | null }>;
  dkimGenerate(input: { domain: string }): Promise<DkimRecord>;
  dkimStart(input: { domain: string }): Promise<"started" | "already">;
  warmup(input: { email: string }): Promise<"enrolled" | "already">;
}

/** The per-inbox loops; `SendScheduler` and `InboxScheduler` in the worker. */
export interface Loops {
  start(address: string): Promise<{ send: boolean; inbox: boolean }>;
}

export interface Deps {
  cloudflare: CloudflareClient;
  google: GoogleAdminClient;
  signatures: SignatureClient;
  roster: RosterStore;
  secrets: SecretStore;
  reloader: Reloader;
  loops: Loops;
  browser: BrowserLegs;
  availability: (domain: string) => Promise<Availability>;
  dmarcRua: string | null;
  /** How long to keep asking Google to see a TXT before a person gets the wheel. */
  dnsWaitMs?: number;
}
