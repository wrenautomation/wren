/**
 * Gmail over domain-wide delegation: the send tick's side of it. The wire (`GmailClient`,
 * `GmailApiError`) lives in autobrowse (`@wrenautomation/autobrowse/google`); wren's
 * `GmailClient` is that wire with a time limit on every call.
 * `GmailTransport` is the only place that decides what a failure *means*:
 * whether the request left the socket (`TransportAmbiguous` → reconcile
 * decides) or definitively did not (`TransportRefused` → re-armable).
 */

import { timedFetch } from "@wren/core/fetch-limit";
import {
  GmailApiError,
  type GmailClientOptions,
  GmailClient as GmailWire,
  type Json,
  ServiceAccountKeyError,
  TokenRefreshError,
} from "@wrenautomation/autobrowse/google";
import MailComposer from "nodemailer/lib/mail-composer";
import { buildMime } from "./mime.js";
import {
  type OutgoingEmail,
  type SendReceipt,
  type Transport,
  TransportAmbiguous,
  TransportRefused,
} from "./transport.js";

/** One Gmail call, a raw message with attachments included. A send cut here reads as unsure, never as unsent. */
export const GMAIL_LIMIT_MS = 2 * 60_000;

/**
 * The piece's Gmail wire with wren's limit: every Gmail call, the token exchange too, is cut at
 * `GMAIL_LIMIT_MS`, since a hung one would hold a step.
 */
export class GmailClient extends GmailWire {
  constructor(opts: GmailClientOptions) {
    super({
      keyEnv: "WREN_GOOGLE_SERVICE_ACCOUNT",
      ...opts,
      fetch: timedFetch(GMAIL_LIMIT_MS, opts.fetch ?? ((input, init) => fetch(input, init))),
    });
  }
}

/** One plain message: sign-in codes, client mail. */
export interface PlainMail {
  to: string;
  subject: string;
  text: string;
  headers?: readonly (readonly [string, string])[];
  /** Its Message-ID, when the caller keeps it (marketing mail, for bounces); else one is minted. */
  messageId?: string;
  /** Files sent with it: an invoice's PDF. */
  attachments?: readonly MailFile[];
}

/** One attached file. */
interface MailFile {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

/**
 * A message with files, through nodemailer's composer (multipart is its job, not ours): the
 * plain path keeps `buildMime`, which writes text only.
 */
function mimeWithFiles(
  o: { from: string; name: string },
  m: PlainMail & { attachments: readonly MailFile[] },
  messageId: string,
): Promise<Buffer> {
  const mail = new MailComposer({
    from: { name: o.name, address: o.from },
    to: m.to,
    subject: m.subject,
    text: m.text,
    messageId,
    ...(m.headers ? { headers: m.headers.map(([key, value]) => ({ key, value })) } : {}),
    attachments: m.attachments.map((f) => ({
      filename: f.filename,
      contentType: f.contentType,
      content: Buffer.from(f.content),
    })),
  });
  return new Promise((resolve, reject) =>
    mail.compile().build((err, out) => (err ? reject(err) : resolve(out))),
  );
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
    const messageId = m.messageId ?? `<${crypto.randomUUID()}@${o.from.split("@")[1]}>`;
    const mime = m.attachments?.length
      ? await mimeWithFiles(o, { ...m, attachments: m.attachments }, messageId)
      : buildMime({
          fromAddress: o.from,
          fromName: o.name,
          to: m.to,
          subject: m.subject,
          replySubject: null,
          body: m.text,
          messageId,
          ...(m.headers ? { headers: m.headers } : {}),
        });
    await gmail.sendRaw(o.mailbox, mime);
  };
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
function neverLeft(err: unknown): boolean {
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
