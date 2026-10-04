/**
 * `Transport` over SMTP for an inbox with its own login (roster `transport = "smtp"`).
 * The bytes are `buildMime`'s. After the send a copy goes in Sent over IMAP, unless
 * the server filed one itself, so `find` can answer reconcile by our Message-ID.
 *
 * What each failure means:
 *   connect, TLS, greeting, login             refused, inbox sidelined
 *   MAIL FROM, DATA or the message refused    refused, inbox sidelined
 *   RCPT TO refused                           refused, this message only
 *   connection lost once the envelope began   ambiguous: the bytes may be out
 * An ambiguous send on a server that files no Sent copy itself is never found, so
 * reconcile fails it after the grace: check the mailbox before re-arming it.
 */
import { createHash } from "node:crypto";
import type { ImapFlow } from "imapflow";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import {
  imapClient,
  inFolder,
  type Login,
  type Mailbox,
  specialFolder,
  withImap,
} from "./mailboxes.js";
import { buildMime } from "./mime.js";
import {
  type OutgoingEmail,
  type SendReceipt,
  type Transport,
  TransportAmbiguous,
  TransportRefused,
} from "./transport.js";

const SENT = "\\Sent";

/** TLS on 465, STARTTLS required elsewhere. */
function smtpConnection(login: Login): SMTPConnection {
  return new SMTPConnection({
    host: login.host,
    port: login.port,
    secure: login.port === 465,
    requireTLS: login.port !== 465,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/** A thread handle from the thread's first Message-ID: stable across sends and finds, and fits `thread_id`. */
export const threadOf = (rootMessageId: string): string =>
  `t-${createHash("sha256").update(rootMessageId).digest("hex").slice(0, 32)}`;

const firstId = (header: string | undefined): string | undefined =>
  /<[^>]+>/.exec(header ?? "")?.[0];

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? `${err.message} (${code})` : err.message;
}

/** The failure table above. `begun` = the envelope was on its way. */
function failure(err: unknown, begun: boolean, email: OutgoingEmail): Error {
  const what = `smtp: ${email.fromAddress} sending ${email.messageId}: ${describe(err)}`;
  const { code, command } = err as { code?: unknown; command?: unknown };
  if (!begun) return new TransportRefused(what, { senderLevel: true, cause: err });
  // The recipient refused, or the client found the envelope bad before writing it.
  if (command === "RCPT TO" || (code === "EENVELOPE" && command === "API")) {
    return new TransportRefused(what, { cause: err });
  }
  // The server answered no (or the size check did): nothing was delivered.
  if (code === "EENVELOPE" || code === "EMESSAGE") {
    return new TransportRefused(what, { senderLevel: true, cause: err });
  }
  return new TransportAmbiguous(what, { cause: err });
}

export interface SmtpTransportOptions {
  /** Test seams: the connections for a login. */
  smtp?: (login: Login) => SMTPConnection;
  imap?: (login: Login) => ImapFlow;
}

interface Filed {
  providerId: string;
  internalDate: Date | null;
  root: string | undefined;
}

export class SmtpTransport implements Transport {
  readonly name = "smtp";
  private readonly smtp: (login: Login) => SMTPConnection;
  private readonly imap: (login: Login) => ImapFlow;

  constructor(
    private readonly mailbox: Mailbox,
    opts: SmtpTransportOptions = {},
  ) {
    this.smtp = opts.smtp ?? smtpConnection;
    this.imap = opts.imap ?? imapClient;
  }

  async send(email: OutgoingEmail): Promise<SendReceipt> {
    let mime: Buffer;
    try {
      mime = buildMime(email);
    } catch (err) {
      throw new TransportRefused(
        `smtp: message ${email.messageId} is not sendable: ${describe(err)}`,
        {
          cause: err,
        },
      );
    }
    const conn = this.smtp(this.mailbox.smtp);
    const { user, pass } = this.mailbox.smtp;
    let begun = false;
    try {
      // A dropped socket mid-login only emits 'error', so one listener rejects every step.
      await new Promise<void>((resolve, reject) => {
        conn.on("error", reject);
        conn.connect((err) => {
          if (err) return reject(err);
          conn.login({ user, pass }, (err) => {
            if (err) return reject(err);
            begun = true;
            conn.send({ from: email.fromAddress, to: [email.to] }, mime, (err) =>
              err ? reject(err) : resolve(),
            );
          });
        });
      });
    } catch (err) {
      conn.close();
      throw failure(err, begun, email);
    }
    conn.quit();
    // The mail is out: a Sent copy that fails to file must not turn this into a failure.
    const filed = await this.file(email, mime).catch(() => null);
    return {
      messageId: email.messageId,
      providerId: filed?.providerId ?? "unfiled",
      threadId:
        email.threadId || threadOf(email.references?.[0] ?? email.inReplyTo ?? email.messageId),
      internalDate: filed?.internalDate ?? null,
    };
  }

  /** Throws when the mailbox cannot be read or has no Sent folder: that is no verdict. */
  async find(_sender: string, messageId: string): Promise<SendReceipt | null> {
    const found = await withImap(this.imap(this.mailbox.imap), async (client) =>
      lookup(client, await sentFolder(client), messageId),
    );
    if (found === null) return null;
    return {
      messageId,
      providerId: found.providerId,
      threadId: threadOf(found.root ?? messageId),
      internalDate: found.internalDate,
    };
  }

  /** Our copy in Sent: the server's own when it filed one, else appended. */
  private file(email: OutgoingEmail, mime: Buffer): Promise<Filed | null> {
    return withImap(this.imap(this.mailbox.imap), async (client) => {
      const sent = await sentFolder(client);
      const found = await lookup(client, sent, email.messageId);
      if (found !== null) return found;
      const appended = await client.append(sent, mime, ["\\Seen"]);
      if (!appended || appended.uid === undefined) return null;
      return {
        providerId: `${appended.uidValidity}:${appended.uid}`,
        internalDate: null,
        root: undefined,
      };
    });
  }
}

async function sentFolder(client: ImapFlow): Promise<string> {
  const path = await specialFolder(client, SENT);
  if (path === null) throw new Error("imap: the mailbox has no Sent folder");
  return path;
}

/** Our Message-ID in `folder` (IMAP SEARCH HEADER), with what reconcile needs. */
function lookup(client: ImapFlow, folder: string, messageId: string): Promise<Filed | null> {
  return inFolder(client, folder, async (uidValidity) => {
    const uids = await client.search({ header: { "message-id": messageId } }, { uid: true });
    const uid = uids ? uids[0] : undefined;
    if (uid === undefined) return null;
    const msg = await client.fetchOne(
      String(uid),
      { uid: true, internalDate: true, headers: ["references", "in-reply-to"] },
      { uid: true },
    );
    const head = msg ? (msg.headers?.toString("utf8") ?? "") : "";
    const refs = /^references:([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)/im.exec(head)?.[1];
    const parent = /^in-reply-to:(.*)$/im.exec(head)?.[1];
    return {
      providerId: `${uidValidity}:${uid}`,
      internalDate: msg && msg.internalDate !== undefined ? new Date(msg.internalDate) : null,
      root: firstId(refs) ?? firstId(parent),
    };
  });
}
