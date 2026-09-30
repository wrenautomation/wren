import type { SiteClient } from "@wren/core/content";
import type { MailSpec, VendorSpec } from "./chart.js";

/** One inbox the books read bills from, by Gmail search. */
export interface Mailbox {
  /** The address, as documents record it. */
  readonly address: string;
  /** Every message id a Gmail search matches. */
  search(query: string): Promise<string[]>;
  /** The whole RFC 5322 message. */
  raw(id: string): Promise<Uint8Array>;
}

/** What the delegated Gmail client offers (channel-email's `GmailClient` fits). */
export interface DelegatedGmail {
  listMessages(
    sender: string,
    query: string,
    opts?: { pageToken?: string | null; maxResults?: number },
  ): Promise<[string[], string | null]>;
  getRaw(sender: string, messageId: string): Promise<Uint8Array>;
}

/** A Workspace inbox read through the service account's domain-wide delegation. */
export function delegatedMailbox(gmail: DelegatedGmail, address: string): Mailbox {
  return {
    address,
    async search(query) {
      const ids: string[] = [];
      let pageToken: string | null = null;
      do {
        const [page, next]: [string[], string | null] = await gmail.listMessages(address, query, {
          pageToken,
          maxResults: 100,
        });
        ids.push(...page);
        pageToken = next;
      } while (pageToken);
      return ids;
    },
    raw: (id) => gmail.getRaw(address, id),
  };
}

/**
 * A Google account autobrowse holds consent for (a personal Gmail), read-only
 * through the `gmail` site. Ids go in the path, never as a template parameter.
 */
export function siteMailbox(sites: SiteClient, address: string): Mailbox {
  return {
    address,
    async search(query) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const page = await sites.call<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
          "gmail",
          "GET",
          "/gmail/v1/users/me/messages",
          { q: query, maxResults: 100, ...(pageToken ? { pageToken } : {}) },
          address,
        );
        ids.push(...(page.messages ?? []).map((m) => m.id));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return ids;
    },
    async raw(id) {
      const message = await sites.call<{ raw: string }>(
        "gmail",
        "GET",
        `/gmail/v1/users/me/messages/${id}`,
        { id, format: "raw" },
        address,
      );
      return new Uint8Array(Buffer.from(message.raw, "base64url"));
    },
  };
}

const quoted = (term: string) => (/\s/.test(term) ? `"${term}"` : term);

/** One vendor's billing mail as a Gmail search clause. */
export function mailClause(mail: MailSpec): string {
  const from = mail.from.map((f) => `from:${f}`);
  const sender = from.length === 1 ? (from[0] as string) : `(${from.join(" OR ")})`;
  if (!mail.subject?.length) return sender;
  return `${sender} subject:(${mail.subject.map(quoted).join(" OR ")})`;
}

/** Every known vendor's billing mail since a day, as one search. */
export function billingQuery(vendorSpecs: readonly VendorSpec[], since: string): string {
  const after = since.replaceAll("-", "/");
  return `after:${after} {${vendorSpecs.map((v) => `(${mailClause(v.mail)})`).join(" ")}}`;
}

/** An address matches a sender entry that is the whole address or its domain (or a parent domain). */
function fromMatches(address: string, sender: string): boolean {
  const a = address.toLowerCase();
  const s = sender.toLowerCase();
  if (s.includes("@")) return a === s;
  const domain = a.split("@")[1] ?? "";
  return domain === s || domain.endsWith(`.${s}`);
}

/** The vendor a message came from, by the same rules the search used; null when none. */
export function vendorFor(
  vendorSpecs: readonly VendorSpec[],
  fromAddress: string,
  subject: string,
): VendorSpec | null {
  const s = subject.toLowerCase();
  for (const v of vendorSpecs) {
    if (!v.mail.from.some((f) => fromMatches(fromAddress, f))) continue;
    if (!v.mail.subject?.length || v.mail.subject.some((w) => s.includes(w.toLowerCase())))
      return v;
  }
  return null;
}
