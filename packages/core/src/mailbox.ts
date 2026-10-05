/**
 * A Gmail inbox Wren reads, by search: whole messages, or headers alone. Two ways in: a Workspace
 * inbox through the service account's domain-wide delegation, or a Google account autobrowse
 * holds consent for (a personal Gmail), read only through its `gmail` site. The books read bills
 * through it; the Watch reads the rest.
 */
import type { SiteClient } from "./content/index.js";
import { decodeEncodedWords, parseAddr } from "./mail.js";

/** One message's headers and Gmail's preview line; never its body. */
export interface MailMeta {
  id: string;
  threadId: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  /** Gmail's preview of the body, entities decoded. */
  snippet: string;
  at: Date;
}

export interface Mailbox {
  /** The address, as records keep it. */
  readonly address: string;
  /** Every message id a Gmail search matches. */
  search(query: string): Promise<string[]>;
  /** The whole RFC 5322 message. */
  raw(id: string): Promise<Uint8Array>;
  meta(id: string): Promise<MailMeta>;
}

/** What the delegated Gmail client offers (channel-email's `GmailClient` fits). */
export interface DelegatedGmail {
  listMessages(
    sender: string,
    query: string,
    opts?: { pageToken?: string | null; maxResults?: number },
  ): Promise<[string[], string | null]>;
  getRaw(sender: string, messageId: string): Promise<Uint8Array>;
  getMetadata(sender: string, messageId: string, headers: readonly string[]): Promise<unknown>;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};

/** Gmail's message object (format=metadata) as `MailMeta`. */
export function metaOf(raw: unknown): MailMeta {
  const m = raw as {
    id: string;
    threadId: string;
    snippet?: string;
    internalDate?: string;
    payload?: { headers?: Array<{ name: string; value: string }> };
  };
  const header = (name: string) =>
    decodeEncodedWords(m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "");
  const [fromName, fromAddress] = parseAddr(header("from"));
  return {
    id: m.id,
    threadId: m.threadId,
    fromName,
    fromAddress: fromAddress.toLowerCase(),
    subject: header("subject"),
    snippet: (m.snippet ?? "").replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, e: string) => ENTITIES[e] ?? "",
    ),
    at: new Date(Number(m.internalDate ?? 0)),
  };
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
    meta: async (id) => metaOf(await gmail.getMetadata(address, id, ["From", "Subject"])),
  };
}

/**
 * A Google account autobrowse holds consent for (a personal Gmail), read-only
 * through the `gmail` site. Ids go in the path, never as a template parameter.
 */
export function siteMailbox(sites: SiteClient, address: string): Mailbox {
  const message = <T>(id: string, format: string) =>
    sites.call<T>("gmail", "GET", `/gmail/v1/users/me/messages/${id}`, { id, format }, address);
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
      const { raw } = await message<{ raw: string }>(id, "raw");
      return new Uint8Array(Buffer.from(raw, "base64url"));
    },
    // Every header: one array parameter may not survive the facade's query.
    meta: async (id) => metaOf(await message(id, "metadata")),
  };
}

/** An address matches a sender that is the whole address or its domain (or a parent domain). */
export function senderMatches(address: string, sender: string): boolean {
  const a = address.toLowerCase();
  const s = sender.toLowerCase();
  if (s.includes("@")) return a === s;
  const domain = a.split("@")[1] ?? "";
  return domain === s || domain.endsWith(`.${s}`);
}
