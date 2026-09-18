/**
 * The transport contract: what a way-to-actually-send must offer (§4).
 *
 * Sending is the one irreversible act in the system, so the contract is
 * written around the two questions the outbox walk has to answer after a
 * failure (I11.1–I11.2): did the request leave? `TransportRefused` says no
 * (the message goes FAILED and is re-armable); `TransportAmbiguous` says the
 * answer was lost after the bytes left (UNKNOWN; only reconcile may move it).
 * And: can we find it again? Every send carries OUR RFC 5322 Message-ID,
 * minted by the caller before the send and never by a transport, and
 * `find()` looks it up in the sender's mailbox (I11.7).
 *
 * `ConsoleTransport` implements the same contract over an in-memory mailbox:
 * the permanent dry run, and the fixture every outbox test sends through.
 */
import { randomUUID } from "node:crypto";

/** One message, fully addressed, ready for the wire. */
export interface OutgoingEmail {
  readonly fromAddress: string;
  readonly fromName: string | null;
  readonly to: string;
  /** null = rides the thread named by inReplyTo/threadId; the wire gets `Re: {replySubject}`. */
  readonly subject: string | null;
  /** The opener's subject, carried on every follow-up. */
  readonly replySubject: string | null;
  readonly body: string;
  /** OURS, minted by the caller before the send (I11.1). */
  readonly messageId: string;
  readonly inReplyTo?: string | null;
  readonly references?: readonly string[];
  /** The provider's own thread id, so a follow-up lands *in* the thread (I11.6). */
  readonly threadId?: string | null;
  /** Full header value, composed by the caller (C-D3). */
  readonly listUnsubscribe?: string | null;
  /** The authored rich form of the sign-off already in `body`; used only when it matches. */
  readonly signatureHtml?: string | null;
  /** This message's open-tracking pixel (C-D12), already built by `buildPixelUrl`. */
  readonly pixelUrl?: string | null;
}

/** What came back: our id, plus the provider's handles on it. */
export interface SendReceipt {
  readonly messageId: string;
  readonly providerId: string;
  readonly threadId: string;
  readonly internalDate: Date | null;
}

/**
 * The request never left, or the provider definitively rejected it. Nothing
 * was delivered, so the message is safe to re-arm. `senderLevel` means the
 * whole inbox is unusable (token refused, 401/403, 429): the walk sidelines
 * that sender for the rest of the tick (§6).
 */
export class TransportRefused extends Error {
  readonly senderLevel: boolean;
  constructor(message: string, opts: { senderLevel?: boolean; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "TransportRefused";
    this.senderLevel = opts.senderLevel ?? false;
  }
}

/**
 * The request left the socket and the answer was lost. The message MAY have
 * been delivered, so it is never re-armed by hand; only reconcile, asking the
 * mailbox for our Message-ID, may decide (I11.2).
 */
export class TransportAmbiguous extends Error {
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "TransportAmbiguous";
  }
}

/** A way to actually send, and to look a send back up afterwards. */
export interface Transport {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendReceipt>;
  /** Our Message-ID as the sender's mailbox knows it, or null. Used by reconcile. */
  find(sender: string, messageId: string): Promise<SendReceipt | null>;
}

/** The Subject header as it goes on the wire; a riding step with no opener subject still gets "Re:". */
export function renderedSubject(email: OutgoingEmail): string {
  if (email.subject !== null) return email.subject;
  return email.replySubject ? `Re: ${email.replySubject}` : "Re:";
}

// --- the HTML twin (N-D5 amended) ------------------------------------------

const DELIMITER = "--";
// A bare domain on its own line, or that domain with a plain path: the one
// thing in a signature that becomes a link. No scheme, no query, no fragment.
const BARE_DOMAIN = /^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[a-z0-9-]+)*$/i;
const PAGE_SLOT = "{page}";
const PLAIN_PATH = /^(?:\/[a-z0-9-]+)+$/;

/** One signature form with its `{page}` slot filled; anything but a plain path or "" is refused. */
export function fillPage(form: string, page: string): string {
  if (page && !PLAIN_PATH.test(page)) {
    throw new Error(`a lander page is a plain path like '/agencies', not ${JSON.stringify(page)}`);
  }
  return form.replaceAll(PAGE_SLOT, page);
}

const STYLE_BODY = "font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222";
const STYLE_SIGNATURE_NAME = "font-weight:bold";
const STYLE_SIGNATURE_LINK = "color:#888;text-decoration:underline";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Blank-line-separated blocks become <p>, single newlines <br>. */
function paragraphs(text: string): string {
  const out: string[] = [];
  for (const block of text.replace(/^\n+|\n+$/g, "").split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    out.push(`<p>${block.split("\n").map(escapeHtml).join("<br>\n")}</p>`);
  }
  return out.join("\n");
}

/** A sign-off styled from its plain text alone: first line bold, a bare domain a muted link. */
function derivedSignatureHtml(lines: readonly string[]): string {
  const rendered: string[] = [];
  let seenName = false;
  for (const line of lines) {
    const text = escapeHtml(line);
    if (line === DELIMITER) rendered.push(text);
    else if (BARE_DOMAIN.test(line)) {
      rendered.push(`<a href="https://${text}" style="${STYLE_SIGNATURE_LINK}">${text}</a>`);
    } else if (!seenName) {
      seenName = true;
      rendered.push(`<span style="${STYLE_SIGNATURE_NAME}">${text}</span>`);
    } else rendered.push(text);
  }
  return `<p>${rendered.join("<br>\n")}</p>`;
}

const TAG = /<[^>]+>/g;
const BREAK = /<br\s*\/?>|<\/p\s*>|<\/div\s*>|<\/tr\s*>/gi;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * The words a reader actually sees, markup removed and entities resolved:
 * the function that decides whether an HTML part and a plain part agree.
 */
export function visibleText(html: string): string {
  const text = unescapeHtml(html.replace(BREAK, "\n").replace(TAG, ""));
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l)
    .join("\n");
}

// The one remote resource a message may reference (C-D12): https, our host,
// our path shape, nothing else.
const PIXEL_URL = /^https:\/\/[a-z0-9.-]+\/p\/[A-Za-z0-9_-]{16,64}\.gif$/;

/** The pixel URL for a token, or null when either half is missing (tracking off). */
export function buildPixelUrl(
  base: string | null | undefined,
  token: string | null | undefined,
): string | null {
  if (!base || !token) return null;
  const url = `${base.replace(/\/+$/, "")}/p/${token}.gif`;
  if (!PIXEL_URL.test(url)) {
    throw new Error(`refusing to embed a pixel URL of this shape: ${JSON.stringify(url)}`);
  }
  return url;
}

/** A 1x1 that loads. Not display:none: several clients decline to fetch what they are told not to draw. */
function pixelTag(url: string): string {
  return `<img src="${escapeHtml(url)}" width="1" height="1" alt="" style="border:0;width:1px;height:1px">`;
}

/**
 * The HTML twin of a plain-text body: a rendering of it, never separate
 * content. Strip the tags and the plain part comes back. Everything from the
 * last `--` line on is the sign-off; `signatureHtml` is used only when its
 * visible text matches those lines. `pixel` is the last thing in the part.
 */
export function toHtml(body: string, signatureHtml?: string | null, pixel?: string | null): string {
  const lines = body.split("\n");
  let cut: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.trimEnd() === DELIMITER) {
      cut = i;
      break;
    }
  }
  let inner: string;
  if (cut === null) {
    inner = paragraphs(body);
  } else {
    const message = paragraphs(lines.slice(0, cut).join("\n"));
    const block = lines
      .slice(cut)
      .filter((l) => l.trim())
      .map((l) => l.trimEnd());
    const signature =
      signatureHtml && visibleText(signatureHtml) === block.join("\n")
        ? `<p>${signatureHtml.trim()}</p>`
        : derivedSignatureHtml(block);
    inner = message ? `${message}\n${signature}` : signature;
  }
  const tail = pixel ? `\n${pixelTag(pixel)}` : "";
  return `<div style="${STYLE_BODY}">\n${inner}\n</div>${tail}`;
}

// --- the console ------------------------------------------------------------

export interface ConsoleTransportOptions {
  write?: (line: string) => void;
  /** Raise *before* the message is recorded: nothing left. */
  refuse?: (email: OutgoingEmail) => Error | null;
  /** Record the message and *then* raise: it left, the answer was lost. */
  ambiguousAfter?: (email: OutgoingEmail) => boolean;
  /** A mailbox that will not answer raises, never quietly says no. */
  findFails?: Error | null;
}

/**
 * Prints instead of sending: the permanent dry run, and the fixture every
 * outbox test sends through. Sent mail lands in an in-memory `mailbox` keyed
 * by fromAddress, so `find()` answers the question Gmail's `rfc822msgid:`
 * search does and the whole reconcile path runs without a network.
 */
export class ConsoleTransport implements Transport {
  readonly name = "console";
  readonly mailbox = new Map<string, Array<{ email: OutgoingEmail; receipt: SendReceipt }>>();
  private sent = 0;
  private readonly write: (line: string) => void;
  private readonly refuse: ConsoleTransportOptions["refuse"];
  private readonly ambiguousAfter: ConsoleTransportOptions["ambiguousAfter"];
  private readonly findFails: Error | null;

  constructor(opts: ConsoleTransportOptions = {}) {
    this.write = opts.write ?? ((line) => console.log(line));
    this.refuse = opts.refuse;
    this.ambiguousAfter = opts.ambiguousAfter;
    this.findFails = opts.findFails ?? null;
  }

  async send(email: OutgoingEmail): Promise<SendReceipt> {
    const refusal = this.refuse?.(email) ?? null;
    if (refusal !== null) throw refusal;
    const subject = renderedSubject(email);
    const riding = email.subject === null ? " (rides thread)" : "";
    const sender = email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress;
    this.write(`--- to ${email.to} | ${subject}${riding}`);
    this.write(`    from ${sender}`);
    if (email.inReplyTo) this.write(`    in-reply-to ${email.inReplyTo}`);
    this.write(email.body);
    this.write("");

    this.sent += 1;
    const receipt: SendReceipt = {
      messageId: email.messageId,
      providerId: `console-${this.sent}`,
      threadId: email.threadId || `t-${randomUUID().replaceAll("-", "")}`,
      internalDate: new Date(),
    };
    const box = this.mailbox.get(email.fromAddress) ?? [];
    box.push({ email, receipt });
    this.mailbox.set(email.fromAddress, box);
    if (this.ambiguousAfter?.(email)) {
      throw new TransportAmbiguous(
        `console: response lost after sending ${email.messageId} (injected)`,
      );
    }
    return receipt;
  }

  async find(sender: string, messageId: string): Promise<SendReceipt | null> {
    if (this.findFails !== null) throw this.findFails;
    for (const { receipt } of this.mailbox.get(sender) ?? []) {
      if (receipt.messageId === messageId) return receipt;
    }
    return null;
  }
}
