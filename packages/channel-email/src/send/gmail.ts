/**
 * Gmail over domain-wide delegation: the wire under the send tick.
 * `GmailClient` is dumb transport (bytes in, provider objects out, loud
 * `GmailApiError` on any non-2xx, fetch failures passed through untouched).
 * `GmailTransport` is the only place that decides what a failure *means*:
 * whether the request left the socket (`TransportAmbiguous` → reconcile
 * decides) or definitively did not (`TransportRefused` → re-armable).
 */
import {
  type FetchLike,
  GMAIL_MODIFY_SCOPE,
  GMAIL_SEND_SCOPE,
  loadServiceAccountKey,
  type ServiceAccountKey,
  ServiceAccountKeyError,
  serviceAccountToken,
  TokenRefreshError,
  type TokenSupplier,
} from "./google-auth.js";
import { buildMime } from "./mime.js";
import {
  type OutgoingEmail,
  type SendReceipt,
  type Transport,
  TransportAmbiguous,
  TransportRefused,
} from "./transport.js";

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
/** What the outbox needs end to end: send, then read the same mailbox back. */
export const SEND_AND_READ_SCOPES: readonly string[] = [GMAIL_SEND_SCOPE, GMAIL_MODIFY_SCOPE];

/** A non-2xx from the Gmail API. The bearer travels in a header, so the excerpt is safe to print. */
export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    readonly bodyExcerpt: string,
    readonly sender: string,
  ) {
    super(`gmail HTTP ${status} for ${sender}: ${bodyExcerpt}`);
    this.name = "GmailApiError";
  }
}

function excerptOf(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (message !== undefined) return String(message).slice(0, 200);
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}

export type Json = Record<string, unknown>;

export interface GmailClientOptions {
  /** Path of the service-account JSON key; read lazily, only when a real token is minted. */
  keyPath?: string;
  key?: ServiceAccountKey;
  fetch?: FetchLike;
  scopes?: readonly string[];
  /** Seam for tests: the sender address → its bearer supplier. */
  tokenFactory?: (sender: string) => TokenSupplier;
}

/** One plain message: sign-in codes, client mail. */
export interface PlainMail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Plain mail from a role address (portal@) through a mailbox allowed to send as
 * it. Not the outbox: no ledger, no reconcile, nothing to thread.
 */
export function plainMailer(
  gmail: GmailClient,
  o: { mailbox: string; from: string; name: string },
): (m: PlainMail) => Promise<void> {
  return async (m) => {
    const mime = buildMime({
      fromAddress: o.from,
      fromName: o.name,
      to: m.to,
      subject: m.subject,
      replySubject: null,
      body: m.text,
      messageId: `<${crypto.randomUUID()}@${o.from.split("@")[1]}>`,
    });
    await gmail.sendRaw(o.mailbox, mime);
  };
}

/** Gmail publishes only to a topic in the API client's own project: the service account's. */
export const gmailPushTopic = (clientEmail: string): string =>
  `projects/${clientEmail.split("@")[1]?.split(".")[0]}/topics/gmail-push`;

/**
 * Gmail REST for one service-account key, acting as many senders. One token
 * supplier is cached per sender (never the bearer string): it refreshes
 * itself on expiry, so a long loop mints one exchange per inbox per hour.
 */
export class GmailClient {
  private readonly fetch: FetchLike;
  private readonly tokenFactory: (sender: string) => TokenSupplier;
  private readonly tokens = new Map<string, TokenSupplier>();

  constructor(opts: GmailClientOptions) {
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    const scopes = opts.scopes ?? SEND_AND_READ_SCOPES;
    let key = opts.key ?? null;
    this.tokenFactory =
      opts.tokenFactory ??
      ((sender) => {
        if (key === null) {
          if (!opts.keyPath)
            throw new ServiceAccountKeyError(
              "GmailClient needs a key, a keyPath or a tokenFactory",
            );
          key = loadServiceAccountKey(opts.keyPath);
        }
        return serviceAccountToken(key, { scopes, subject: sender, fetch: this.fetch });
      });
  }

  private supplier(sender: string): TokenSupplier {
    let supplier = this.tokens.get(sender);
    if (!supplier) {
      supplier = this.tokenFactory(sender);
      this.tokens.set(sender, supplier);
    }
    return supplier;
  }

  /** Mint (or refresh) this sender's token without sending anything. */
  async ensureToken(sender: string): Promise<void> {
    await this.supplier(sender)();
  }

  private async request(
    method: "GET" | "POST",
    sender: string,
    path: string,
    opts: { params?: Record<string, string | string[]>; json?: Json } = {},
  ): Promise<Json> {
    const url = new URL(`${GMAIL_API}${path}`);
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
    }
    const token = await this.supplier(sender)();
    const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` } };
    if (opts.json !== undefined) {
      init.headers = { ...init.headers, "content-type": "application/json" };
      init.body = JSON.stringify(opts.json);
    }
    const response = await this.fetch(url.toString(), init);
    const text = await response.text();
    if (response.status >= 400) throw new GmailApiError(response.status, excerptOf(text), sender);
    return JSON.parse(text) as Json;
  }

  /** POST one RFC 5322 message as `sender`; `threadId` files it inside that conversation. */
  sendRaw(sender: string, mime: Buffer, threadId?: string | null): Promise<Json> {
    const json: Json = { raw: mime.toString("base64url") };
    if (threadId) json.threadId = threadId;
    return this.request("POST", sender, "/messages/send", { json });
  }

  /** `{id, threadId, internalDate}` for OUR Message-ID in this mailbox, or null. */
  async findByMessageId(
    sender: string,
    messageId: string,
  ): Promise<{ id: string; threadId: string; internalDate: string | null } | null> {
    const listed = await this.request("GET", sender, "/messages", {
      params: { q: `rfc822msgid:${messageId.trim().replace(/^<|>$/g, "")}`, maxResults: "1" },
    });
    const messages = (listed.messages as Array<{ id: string }> | undefined) ?? [];
    const first = messages[0];
    if (!first) return null;
    let found: Json;
    try {
      found = await this.request("GET", sender, `/messages/${first.id}`, {
        params: { format: "metadata", metadataHeaders: ["Message-ID"] },
      });
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 404) return null;
      throw err;
    }
    return {
      id: String(found.id),
      threadId: String(found.threadId),
      internalDate: found.internalDate === undefined ? null : String(found.internalDate),
    };
  }

  /** One page of message ids for a Gmail search plus the next page token. */
  async listMessages(
    sender: string,
    query: string,
    opts: { pageToken?: string | null; maxResults?: number; includeSpamTrash?: boolean } = {},
  ): Promise<[string[], string | null]> {
    const params: Record<string, string> = { q: query, maxResults: String(opts.maxResults ?? 100) };
    if (opts.pageToken) params.pageToken = opts.pageToken;
    if (opts.includeSpamTrash) params.includeSpamTrash = "true";
    const data = await this.request("GET", sender, "/messages", { params });
    const messages = (data.messages as Array<{ id: string }> | undefined) ?? [];
    return [
      messages.map((m) => m.id),
      typeof data.nextPageToken === "string" ? data.nextPageToken : null,
    ];
  }

  /** The API's own object for one message, headers only. */
  getMetadata(sender: string, messageId: string, headers: readonly string[]): Promise<Json> {
    return this.request("GET", sender, `/messages/${messageId}`, {
      params: { format: "metadata", metadataHeaders: [...headers] },
    });
  }

  /** Gmail pushes this inbox's changes to `topicName` (Pub/Sub); returns when the watch lapses (ms). */
  async watch(sender: string, topicName: string): Promise<number> {
    const r = await this.request("POST", sender, "/watch", {
      json: { topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" },
    });
    return Number(r.expiration);
  }

  /** The full RFC 5322 message as bytes. */
  async getRaw(sender: string, messageId: string): Promise<Buffer> {
    const data = await this.request("GET", sender, `/messages/${messageId}`, {
      params: { format: "raw" },
    });
    return Buffer.from(String(data.raw), "base64url");
  }
}

// Nothing left the socket: the connection was never made. Undici reports
// these as the `code` of a `fetch failed` TypeError's cause.
const NEVER_LEFT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function errorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** True when a fetch failure means the request never reached the server. */
export function neverLeft(err: unknown): boolean {
  const code = errorCode(err);
  return code !== null && NEVER_LEFT_CODES.has(code);
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = errorCode(err);
    return code ? `${err.name}: ${err.message} (${code})` : `${err.name}: ${err.message}`;
  }
  return String(err);
}

/** `Transport` over `GmailClient`: builds the MIME, sends it, and decides what each failure means. */
export class GmailTransport implements Transport {
  readonly name = "gmail";
  constructor(private readonly client: GmailClient) {}

  async send(email: OutgoingEmail): Promise<SendReceipt> {
    // Minting first keeps auth failures out of the ambiguous class.
    try {
      await this.client.ensureToken(email.fromAddress);
    } catch (err) {
      if (err instanceof ServiceAccountKeyError || err instanceof TokenRefreshError) {
        throw new TransportRefused(
          `gmail: ${email.fromAddress} could not be authorized: ${err.message}`,
          {
            senderLevel: true,
            cause: err,
          },
        );
      }
      // The token endpoint, not Gmail: the network is the fault, not this inbox.
      throw new TransportRefused(
        `gmail: token endpoint unreachable for ${email.fromAddress}: ${describe(err)}`,
        { cause: err },
      );
    }

    let mime: Buffer;
    try {
      mime = buildMime(email);
    } catch (err) {
      throw new TransportRefused(
        `gmail: message ${email.messageId} is not sendable: ${(err as Error).message}`,
        {
          cause: err,
        },
      );
    }

    let response: Json;
    try {
      response = await this.client.sendRaw(email.fromAddress, mime, email.threadId);
    } catch (err) {
      if (err instanceof GmailApiError) throw fromApiError(err);
      if (neverLeft(err)) {
        throw new TransportRefused(
          `gmail: could not reach the API for ${email.fromAddress}: ${describe(err)}`,
          {
            cause: err,
          },
        );
      }
      // Timeouts, resets, a 2xx whose body will not parse: the bytes may have arrived.
      throw new TransportAmbiguous(
        `gmail: response lost sending ${email.messageId} as ${email.fromAddress}: ${describe(err)}`,
        { cause: err },
      );
    }

    const providerId = response.id;
    const threadId = response.threadId;
    if (typeof providerId !== "string" || typeof threadId !== "string") {
      // Gmail accepted it and we cannot read the handles back: sent, so ambiguous.
      throw new TransportAmbiguous(
        `gmail: unreadable accept for ${email.messageId}: missing id/threadId`,
      );
    }
    return { messageId: email.messageId, providerId, threadId, internalDate: null };
  }

  /** A `GmailApiError` or fetch failure propagates: "the mailbox says no" and "did not answer" differ. */
  async find(sender: string, messageId: string): Promise<SendReceipt | null> {
    const found = await this.client.findByMessageId(sender, messageId);
    if (found === null) return null;
    return {
      messageId,
      providerId: found.id,
      threadId: found.threadId,
      internalDate: found.internalDate === null ? null : new Date(Number(found.internalDate)),
    };
  }
}

/** Gmail's status → what the outbox may do about it. */
function fromApiError(err: GmailApiError): Error {
  if (err.status >= 500) return new TransportAmbiguous(err.message, { cause: err });
  if (err.status === 401 || err.status === 403 || err.status === 429) {
    return new TransportRefused(err.message, { senderLevel: true, cause: err });
  }
  return new TransportRefused(err.message, { cause: err });
}
