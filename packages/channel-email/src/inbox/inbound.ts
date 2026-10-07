/**
 * Classify one inbound message: bounce, auto-reply, unsubscribe, receipt, reply.
 *
 * The mailbox is the source of truth and the harness never infers a thread
 * outcome — this module is the reading step: raw RFC 5322 bytes in, one
 * `Inbound` verdict out. Pure and dependency-free (our own MIME reader plus
 * the HTML-to-text reader): no database, no network, no Gmail client, no LLM.
 * The sync that turns verdicts into `thread_events`, stops and suppressions
 * owns all of that; keeping the judgement pure is what makes it testable
 * against real `.eml` shapes.
 *
 * `InboundKind`/`InboundBounceClass` mirror the schema's `ThreadEventKind`/
 * `BounceClass` by value but are their own types: classification is a reading
 * of the wire format and must not acquire a dependency on the storage
 * vocabulary (the sync maps one to the other in one line).
 *
 * Precedence is fixed and ordered — bounce, receipt, auto-reply, unsubscribe,
 * else reply. Two orderings are load-bearing:
 *   - `Action: delivered` in a delivery report is a *receipt*, not a bounce,
 *     even when the sender is mailer-daemon@ — the report is read before the
 *     sender heuristic ever runs;
 *   - an out-of-office that happens to say "please remove me" is an auto-reply,
 *     never an unsubscribe. Machines do not opt out.
 *
 * Everything is evidence-first: a class is only asserted when the message says
 * so. An unrecognised bounce with no status code is SOFT (suppresses nothing)
 * rather than a guessed HARD.
 */

import { getAddresses, type MimePart, parseAddr, parseDate, parseMessage } from "@wren/core/mail";
import { readPage } from "@wren/research/fetch";

export const SNIPPET_MAX_CHARS = 300;
/** The reply text kept on the event for the disposition classifier: long enough for any real answer, short enough that a pasted contract is not a prompt. */
export const TEXT_MAX_CHARS = 4000;
export const DIAGNOSTIC_MAX_CHARS = 300;
/** An unsubscribe is a *short* message. Above this, the words are a conversation. */
export const UNSUBSCRIBE_MAX_WORDS = 25;

export const INBOUND_KINDS = ["reply", "bounce", "auto_reply", "unsubscribe", "receipt"] as const;
/** What an inbound message is. RECEIPT covers read/delivery receipts, which the sync keeps as notes. */
export type InboundKind = (typeof INBOUND_KINDS)[number];

/** Permanence of a bounce: HARD suppresses the address, SOFT is recorded and nothing else. */
export type InboundBounceClass = "hard" | "soft";

export type MatchedBy = "in_reply_to" | "references" | "embedded_original";

/** The verdict on one inbound message, plus the identity evidence the sync needs to attach it. */
export interface Inbound {
  readonly kind: InboundKind;
  readonly bounceClass: InboundBounceClass | null;
  readonly bouncedAddress: string | null;
  /** Enhanced status code, e.g. "5.1.1". */
  readonly bounceStatus: string | null;
  readonly diagnostic: string | null;
  /** The inbound's own Message-ID. */
  readonly messageId: string | null;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  /** For reports: the Message-ID of OUR message, read out of the embedded original headers. */
  readonly originalMessageId: string | null;
  readonly matchedMessageId: string | null;
  readonly matchedBy: MatchedBy | null;
  readonly fromAddress: string | null;
  readonly fromName: string | null;
  readonly subject: string | null;
  readonly date: Date | null;
  readonly autoSubmitted: string | null;
  /** Any auto-reply signal fired, whatever the kind. */
  readonly isAuto: boolean;
  readonly snippet: string | null;
  /** The reply's own words, quoted thread stripped, whitespace collapsed, capped at TEXT_MAX_CHARS. */
  readonly text: string | null;
}

// --------------------------------------------------------------------------
// Message-ID handling

const ANGLE_ADDR = /<[^<>]+>/g;

/** Message-IDs compare without their angle brackets, surrounding space or case. */
export function normalizeMessageId(value: string): string {
  return value
    .trim()
    .replace(/^[<>]+|[<>]+$/g, "")
    .trim()
    .toLowerCase();
}

/** Every `<id>` in a header value, in order; a bare unbracketed id is accepted as one. */
export function messageIds(raw: string | null): string[] {
  if (!raw) return [];
  const found = [...raw.matchAll(ANGLE_ADDR)].map((m) => m[0]);
  if (found.length) return found;
  const token = collapse(raw);
  return token ? [token] : [];
}

function collapse(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

// --------------------------------------------------------------------------
// Header access

function header(msg: MimePart, name: string): string | null {
  const value = msg.get(name);
  if (value === null) return null;
  const text = collapse(value);
  return text || null;
}

/** Every addr-spec in the named headers, lowercased. */
function addressesIn(msg: MimePart, ...names: string[]): Set<string> {
  const values: string[] = [];
  for (const name of names) values.push(...msg.getAllRaw(name));
  return new Set(
    getAddresses(values)
      .map(([, addr]) => addr.toLowerCase())
      .filter(Boolean),
  );
}

// --------------------------------------------------------------------------
// Body text: the message's own new words

/** Candidate body parts, skipping attachments and never descending into `message/*`. */
function* textParts(part: MimePart): IterableIterator<MimePart> {
  if (part.maintype === "message") return;
  if (part.maintype === "multipart") {
    for (const sub of part.parts) yield* textParts(sub);
    return;
  }
  if ((part.type === "text/plain" || part.type === "text/html") && !part.isAttachment()) yield part;
}

/** The raw readable body — text/plain preferred, else HTML with its tags stripped. Quoting is left in. */
export function bodyText(msg: MimePart): string {
  let plain: MimePart | null = null;
  let html: MimePart | null = null;
  for (const part of textParts(msg)) {
    if (part.type === "text/plain") plain = plain ?? part;
    else html = html ?? part;
  }
  if (plain) return plain.text();
  if (html) return readPage(html.text()).text;
  return "";
}

// Attribution lines that open a quoted original. "On <date> <someone> wrote:"
// wraps across lines in Gmail, so the check joins a small window of following
// lines before looking for "wrote:".
const ON_WROTE_LOOKAHEAD = 3;
const QUOTE_HEADERS = [
  /^-{2,}\s*original message\s*-{2,}/i,
  /^-{2,}\s*forwarded message\s*-{2,}/i,
  /^begin forwarded message\s*:?\s*$/i,
  /^from:\s/i,
  /^_{5,}\s*$/, // Outlook's divider, which precedes its From:
];
// RFC 3676 signature delimiter. Cutting here keeps signatures out of snippets
// and out of the unsubscribe word count.
const SIGNATURE = /^--\s*$/;

// "On <date>, <name> wrote:" in the languages clients reply in: the line's first word, then the
// verb within the lookahead.
const ATTRIBUTIONS: readonly [lead: RegExp, verb: RegExp][] = [
  [/^on\b/i, /\bwrote\s*:/i],
  [/^le\b/i, /\ba écrit\s*:/i],
  [/^am\b/i, /\bschrieb\b/i],
  [/^el\b/i, /\bescribió\s*:/i],
  [/^em\b/i, /\bescreveu\s*:/i],
  [/^il\b/i, /\bha scritto\s*:/i],
  [/^op\b/i, /\bschreef\b/i],
];

function isQuoteStart(lines: readonly string[], index: number): boolean {
  const line = (lines[index] ?? "").trim();
  if (QUOTE_HEADERS.some((pattern) => pattern.test(line))) return true;
  const said = ATTRIBUTIONS.find(([lead]) => lead.test(line));
  if (!said) return false;
  return said[1].test(lines.slice(index, index + ON_WROTE_LOOKAHEAD).join(" "));
}

/** The message's OWN new text: quoted lines and everything from the first attribution line onward removed. */
export function ownText(msg: MimePart): string {
  return stripQuoted(bodyText(msg));
}

/** `ownText` for a body already read (classify reads it once). */
export function stripQuoted(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const stripped = (lines[index] ?? "").trim();
    if (stripped.startsWith(">")) continue;
    if (SIGNATURE.test(stripped) || isQuoteStart(lines, index)) break;
    kept.push(lines[index] ?? "");
  }
  return collapse(kept.join(" "));
}

function clip(text: string | null | undefined, limit: number): string | null {
  if (!text) return null;
  const collapsed = collapse(text);
  return collapsed.slice(0, limit).trimEnd() || null;
}

// --------------------------------------------------------------------------
// Bounces

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const ENHANCED_STATUS = /\b([45])\.\d{1,3}\.\d{1,3}\b/;
const SMTP_HARD = /\b(?:550|552|553|554)\b/;
const SMTP_SOFT = /\b(?:421|450|451|452)\b/;
const DAEMON_LOCALPARTS = new Set(["mailer-daemon", "mailer_daemon", "postmaster"]);
const DAEMON_NAMES = ["mailer-daemon", "mail delivery subsystem", "mail delivery system"];
// Subjects that announce a bounce on their own, for MTAs that send a plain NDR with no report part.
const BOUNCE_SUBJECT_PREFIXES = [
  "undeliverable",
  "delivery status notification (failure)",
  "undelivered mail returned to sender",
  "mail delivery failed",
  "delivery has failed",
  "returned mail",
];
const DELAY_MARKERS = ["delay", "delayed", "warning", "still trying", "not yet delivered"];
const FAILED_ACTIONS = new Set(["failed"]);
const DELAYED_ACTIONS = new Set(["delayed"]);
const DELIVERED_ACTIONS = new Set(["delivered", "relayed", "expanded"]);

interface Bounce {
  readonly bounceClass: InboundBounceClass;
  readonly address: string | null;
  readonly status: string | null;
  readonly diagnostic: string | null;
}

/** What a delivery report said: a bounce, or a delivery (a receipt). */
interface Report {
  readonly bounce: Bounce | null;
  readonly delivered: boolean;
}

function reportParts(msg: MimePart, subtype: string): MimePart[] {
  const wanted = `message/${subtype}`;
  return [...msg.walk()].filter((part) => part.type === wanted);
}

/** `Final-Recipient: rfc822; nobody@example.com` -> `nobody@example.com`. */
function recipientAddress(value: string | null): string | null {
  if (!value) return null;
  const semicolon = value.indexOf(";");
  const text = (semicolon >= 0 ? value.slice(semicolon + 1) : value)
    .trim()
    .replace(/^[<>]+|[<>]+$/g, "")
    .trim()
    .toLowerCase();
  return text || null;
}

/**
 * Parse an RFC 3464 report. A failed recipient outranks a delayed one, and a
 * report whose recipients all succeeded is a delivery receipt, not a bounce.
 */
function readDeliveryReport(msg: MimePart): Report {
  const parts = reportParts(msg, "delivery-status");
  if (!parts.length) return { bounce: null, delivered: false };
  let failed: Bounce | null = null;
  let delayed: Bounce | null = null;
  let delivered = false;
  for (const part of parts) {
    for (const block of part.parts) {
      const action = (header(block, "Action") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
      const status = header(block, "Status");
      const address = recipientAddress(
        header(block, "Final-Recipient") ?? header(block, "Original-Recipient"),
      );
      const diagnostic = clip(header(block, "Diagnostic-Code"), DIAGNOSTIC_MAX_CHARS);
      // The status class decides when there is one: Gmail's last NDR after two days of
      // failed connects is `Action: failed` + `Status: 4.4.1`, a dead MX, not a bad
      // address. Only a 5.x.x (or a failure with no code) is the kind that costs reputation.
      const klass = (status ?? "").charAt(0);
      const isHard = klass === "5" || (FAILED_ACTIONS.has(action) && klass !== "4");
      const isSoft = klass === "4" || DELAYED_ACTIONS.has(action);
      if (isHard && failed === null) failed = { bounceClass: "hard", address, status, diagnostic };
      else if (isSoft && delayed === null)
        delayed = { bounceClass: "soft", address, status, diagnostic };
      else if (DELIVERED_ACTIONS.has(action)) delivered = true;
    }
  }
  const bounce = failed ?? delayed;
  return { bounce, delivered: delivered && bounce === null };
}

function isDispositionNotification(msg: MimePart): boolean {
  if ((msg.param("report-type") ?? "").trim().toLowerCase() === "disposition-notification")
    return true;
  return reportParts(msg, "disposition-notification").length > 0;
}

function looksLikeDaemon(fromAddress: string | null, fromName: string | null): boolean {
  const local = (fromAddress ?? "").split("@", 1)[0]?.toLowerCase() ?? "";
  if (local && DAEMON_LOCALPARTS.has(local)) return true;
  const name = (fromName ?? "").toLowerCase();
  return DAEMON_NAMES.some((marker) => name.includes(marker));
}

/** The NDRs that arrive without a report part: Exchange's "Undeliverable:", sendmail's "Returned mail", anything from a mailer-daemon. */
function heuristicBounce(
  msg: MimePart,
  opts: {
    fromAddress: string | null;
    fromName: string | null;
    subject: string | null;
    body: string;
  },
): Bounce | null {
  const loweredSubject = (opts.subject ?? "").trim().toLowerCase();
  const subjectSaysBounce = BOUNCE_SUBJECT_PREFIXES.some((p) => loweredSubject.startsWith(p));
  if (!subjectSaysBounce && !looksLikeDaemon(opts.fromAddress, opts.fromName)) return null;

  const body = opts.body;
  const loweredBody = body.toLowerCase();
  const enhanced = ENHANCED_STATUS.exec(body);
  const status = enhanced ? enhanced[0] : null;
  const saysDelay =
    loweredBody.includes("delayed") || DELAY_MARKERS.some((m) => loweredSubject.includes(m));
  let bounceClass: InboundBounceClass;
  if (enhanced) bounceClass = enhanced[1] === "5" ? "hard" : "soft";
  else if (SMTP_HARD.test(body)) bounceClass = "hard";
  else if (SMTP_SOFT.test(body) || saysDelay) bounceClass = "soft";
  // Nothing in the message states permanence — only the subject or the sender
  // said "bounce" at all. SOFT records it and suppresses nothing: an Exchange
  // NDR carrying no code is as often a transient relay failure as a dead
  // address, and guessing HARD would burn a live address on a guess.
  else bounceClass = "soft";

  const exclude = addressesIn(msg, "From", "To", "Cc", "Delivered-To", "Return-Path");
  const address =
    recipientAddress(header(msg, "X-Failed-Recipients")) ?? addressInText(body, exclude);
  return { bounceClass, address, status, diagnostic: reasonLine(body) };
}

/** The first address in the body that is neither a correspondent of this message nor a daemon. */
function addressInText(text: string, exclude: ReadonlySet<string>): string | null {
  for (const match of text.matchAll(EMAIL_IN_TEXT)) {
    const address = match[0].toLowerCase().replace(/\.+$/, "");
    if (exclude.has(address)) continue;
    if (DAEMON_LOCALPARTS.has(address.split("@", 1)[0] ?? "")) continue;
    return address;
  }
  return null;
}

/** An NDR's diagnostic: the first paragraph quoting a status code, else the first paragraph. */
function reasonLine(body: string): string | null {
  const paragraphs = body
    .split(/\n\s*\n/)
    .filter((chunk) => chunk.trim())
    .map((chunk) => collapse(chunk));
  for (const paragraph of paragraphs) {
    if ([ENHANCED_STATUS, SMTP_HARD, SMTP_SOFT].some((p) => p.test(paragraph))) {
      return clip(paragraph, DIAGNOSTIC_MAX_CHARS);
    }
  }
  return paragraphs.length ? clip(paragraphs[0], DIAGNOSTIC_MAX_CHARS) : null;
}

// --------------------------------------------------------------------------
// Auto-replies

const SUBJECT_PREFIX = /^\s*(?:re|fwd|fw|aw|wg)\s*:\s*/i;
const AUTO_HEADERS = [
  "X-Autoreply",
  "X-Autorespond",
  "X-Auto-Response-Suppress",
  "X-Autoreply-From",
];
const AUTO_PRECEDENCE = new Set(["auto_reply", "auto-reply", "bulk", "junk"]);
const AUTO_SUBJECT =
  /automatic reply|auto-?\s?reply|out of (?:the )?office|\booo\b|away from (?:the|my) office|on leave|on vacation|on holiday|parental leave|maternity leave|currently away|i am away|i'm away|i will be out/i;
// Only when it IS the whole subject: "Thank you for your email" alone is an
// autoresponder; "Thank you for your email about the pilot" is a person.
const AUTO_SUBJECT_ALONE = /^thank you for your (?:email|message)[.!]?$/i;

/** Drop leading Re:/Fwd:/FW:/AW:/WG: so subject rules see the real subject. */
export function stripSubjectPrefixes(subject: string): string {
  let text = subject.trim();
  for (;;) {
    const shortened = text.replace(SUBJECT_PREFIX, "");
    if (shortened === text) return text;
    text = shortened;
  }
}

function autoSignal(msg: MimePart, subject: string | null, autoSubmitted: string | null): boolean {
  if (autoSubmitted && (autoSubmitted.split(";", 1)[0] ?? "").trim().toLowerCase() !== "no") {
    return true;
  }
  if (AUTO_HEADERS.some((name) => msg.has(name))) return true;
  const precedence = (header(msg, "Precedence") ?? "").trim().toLowerCase();
  if (AUTO_PRECEDENCE.has(precedence)) return true;
  if (!subject) return false;
  const stripped = stripSubjectPrefixes(subject);
  return AUTO_SUBJECT.test(stripped) || AUTO_SUBJECT_ALONE.test(stripped);
}

// --------------------------------------------------------------------------
// Unsubscribes

const UNSUBSCRIBE_TEXT =
  /unsubscribe|remove me|take me off|opt me out|opt[ -]?out|stop emailing|stop sending|do not contact|don't contact|do not email|don't email|no longer wish|not interested in receiving|please remove|delete my (?:email|address|contact)/i;
const UNSUBSCRIBE_SUBJECTS = new Set(["unsubscribe", "remove", "opt out", "opt-out", "stop"]);

/** Curly apostrophes are what mail clients actually send; "don't" must match either one. */
function normalizeQuotes(text: string): string {
  return text.replace(/’/g, "'").replace(/‘/g, "'");
}

function isUnsubscribe(text: string, subject: string | null): boolean {
  if (subject && UNSUBSCRIBE_SUBJECTS.has(stripSubjectPrefixes(subject).trim().toLowerCase())) {
    return true;
  }
  const normalized = normalizeQuotes(text);
  if (normalized.split(/\s+/).filter(Boolean).length > UNSUBSCRIBE_MAX_WORDS) return false;
  return UNSUBSCRIBE_TEXT.test(normalized);
}

// --------------------------------------------------------------------------
// Threading

/**
 * OUR Message-ID as a report carries it: the embedded original's own
 * Message-ID first (the reliable form), else a `text/rfc822-headers` part,
 * else an Original-Message-ID field on any part.
 */
function embeddedOriginalId(msg: MimePart): string | null {
  for (const part of reportParts(msg, "rfc822")) {
    for (const block of part.parts) {
      const found = messageIds(header(block, "Message-ID"));
      if (found.length) return found[0] as string;
    }
  }
  for (const part of msg.walk()) {
    if (part.type !== "text/rfc822-headers") continue;
    const headers = parseMessage(part.text());
    const found = messageIds(header(headers, "Message-ID"));
    if (found.length) return found[0] as string;
  }
  for (const part of msg.walk()) {
    for (const name of ["Original-Message-ID", "X-Original-Message-ID"]) {
      const found = messageIds(header(part, name));
      if (found.length) return found[0] as string;
    }
  }
  return null;
}

function matchOurs(
  ourMessageIds: Iterable<string>,
  opts: {
    inReplyTo: string | null;
    references: readonly string[];
    originalMessageId: string | null;
  },
): [string | null, MatchedBy | null] {
  const ours = new Map<string, string>();
  for (const value of ourMessageIds) if (value) ours.set(normalizeMessageId(value), value);
  if (!ours.size) return [null, null];
  const candidates: Array<[string, MatchedBy]> = [];
  if (opts.inReplyTo) candidates.push([opts.inReplyTo, "in_reply_to"]);
  for (const reference of opts.references) candidates.push([reference, "references"]);
  if (opts.originalMessageId) candidates.push([opts.originalMessageId, "embedded_original"]);
  for (const [value, source] of candidates) {
    const match = ours.get(normalizeMessageId(value));
    if (match !== undefined) return [match, source];
  }
  return [null, null];
}

// --------------------------------------------------------------------------
// The verdict

/** Classify one raw inbound message. Pure: same bytes, same verdict. */
export function classify(
  raw: Uint8Array | string,
  opts: { ourMessageIds?: Iterable<string> } = {},
): Inbound {
  const msg = parseMessage(raw);

  const [rawName, rawAddress] = parseAddr(msg.getRaw("From") ?? "");
  const fromAddress = rawAddress.toLowerCase() || null;
  const fromName = rawName.trim() || null;
  const subject = header(msg, "Subject");
  const autoSubmitted = header(msg, "Auto-Submitted");

  const inReplyTo = messageIds(header(msg, "In-Reply-To"))[0] ?? null;
  const references = messageIds(header(msg, "References"));
  const messageId = messageIds(header(msg, "Message-ID"))[0] ?? null;
  const originalMessageId = embeddedOriginalId(msg);
  const [matchedMessageId, matchedBy] = matchOurs(opts.ourMessageIds ?? [], {
    inReplyTo,
    references,
    originalMessageId,
  });

  const body = bodyText(msg);
  const text = stripQuoted(body);
  const isAuto = autoSignal(msg, subject, autoSubmitted);

  let kind: InboundKind = "reply";
  let bounce: Bounce | null = null;
  const report = readDeliveryReport(msg);
  if (report.bounce !== null) {
    kind = "bounce";
    bounce = report.bounce;
  } else if (report.delivered || isDispositionNotification(msg)) {
    kind = "receipt";
  } else {
    bounce = heuristicBounce(msg, { fromAddress, fromName, subject, body });
    if (bounce !== null) kind = "bounce";
    else if (isAuto) kind = "auto_reply";
    else if (isUnsubscribe(text, subject)) kind = "unsubscribe";
  }

  return {
    kind,
    bounceClass: bounce?.bounceClass ?? null,
    bouncedAddress: bounce?.address ?? null,
    bounceStatus: bounce?.status ?? null,
    diagnostic: bounce?.diagnostic ?? null,
    messageId,
    inReplyTo,
    references,
    originalMessageId,
    matchedMessageId,
    matchedBy,
    fromAddress,
    fromName,
    subject,
    date: parseDate(header(msg, "Date")),
    autoSubmitted,
    isAuto,
    snippet: clip(text, SNIPPET_MAX_CHARS),
    text: clip(text, TEXT_MAX_CHARS),
  };
}
