/**
 * The inbound sync: read every fleet mailbox, attach what belongs to us, act on it.
 *
 * The mailbox is the source of truth and the harness never infers a thread
 * outcome. `inbound.ts` is the pure reading of one message; this module is
 * everything that reading touches: which enrollment a message belongs to, the
 * `thread_events` row that records it, the stop and the suppression that
 * follow, and the per-sender cursor that makes a re-run cheap.
 *
 * Three properties hold the design together:
 *
 * - **Append-only and idempotent.** One `thread_events` row per Gmail message
 *   id, enforced by `uq_thread_events_gmail_id` and by `ON CONFLICT DO NOTHING`
 *   on every insert — a concurrent sync that loses the race gets no row back,
 *   counts `already_seen`, and *does not act*. A re-sync therefore re-applies
 *   no stop, which is what makes the one-day cursor overlap free of consequence.
 * - **Evidence before action.** The event is written first; the stop and the
 *   suppression name it (`event {id}`) in their detail, and all three commit in
 *   one transaction per message.
 * - **One inbox's trouble is not the fleet's.** A reader failure on one message
 *   is a `read_errors` count and the walk continues; a failure listing a whole
 *   mailbox is a `sender_errors` count and the *next* sender is still synced.
 *
 * **Matching.** In order: our Message-ID in `In-Reply-To`, then in
 * `References`, then Gmail's own `threadId`, then a report's embedded original
 * headers, then the `From` address against an enrollment's `to_email`. The
 * From-only match is accepted for any kind: that address is ours by
 * construction — it is an enrollment's `to_email`, and warmup, test and
 * personal mail in these inboxes are none of our business.
 *
 * **Where it reads.** Gmail's listing hides SPAM and TRASH unless asked, and
 * it spam-files exactly the mail this loop exists to find: NDRs from unusual
 * MTAs, and one-line "unsubscribe" replies. The sync asks for them explicitly.
 *
 * **Whose failure it is.** A hard DSN that names an address other than the one
 * we mailed does not stop or suppress anything. See `bounceDetail` and `act`.
 */

import { parseAddr } from "@wren/core/mail";
import { atomic, type Db, type Queryable } from "@wren/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { SharedSuppressions } from "../guards.js";
import {
  type BounceClass,
  type DispositionSource,
  type Enrollment,
  enrollments,
  inboxSyncs,
  type Message,
  type MessageState,
  messages,
  type ReplyDisposition,
  type StopReason,
  type ThreadEvent,
  type ThreadEventKind,
  threadEvents,
} from "../schema.js";
import { PlainDate } from "../send/dates.js";
import { recordStop, stopCompany } from "../send/deliver.js";
import { ensureSuppression } from "../send/suppress.js";
import { awayUntil } from "./away.js";
import {
  classify,
  type Inbound,
  type InboundBounceClass,
  type InboundKind,
  normalizeMessageId,
} from "./inbound.js";

/**
 * The cheap read: exactly the headers the classification and the match need,
 * so the sync never pulls a body it has no use for. Stored verbatim on the
 * event as the evidence behind its verdict.
 */
export const METADATA_HEADERS = [
  "Message-ID",
  "In-Reply-To",
  "References",
  "From",
  "Subject",
  "Date",
  "Auto-Submitted",
  "X-Autoreply",
  "X-Autorespond",
  "X-Auto-Response-Suppress",
  "Precedence",
  "Content-Type",
  "X-Failed-Recipients",
] as const;

// Sent mail, drafts and Hangouts are ours or not mail at all; everything else is a candidate.
const QUERY = (epochSeconds: number) => `after:${epochSeconds} -in:sent -in:draft -in:chats`;
const PAGE_SIZE = 100;

// A threadId match only counts against a message we actually put on the wire
// (or tried to): a DRAFT sharing a thread id would be a Gmail accident.
const THREAD_STATES: readonly MessageState[] = ["sent", "unknown", "sending"];

const DAEMON_LOCALPARTS = new Set(["mailer-daemon", "mailer_daemon", "postmaster"]);

const KIND: Readonly<Record<InboundKind, ThreadEventKind>> = {
  reply: "reply",
  bounce: "bounce",
  auto_reply: "auto_reply",
  unsubscribe: "unsubscribe",
  // A read receipt is not a thread outcome and has no vocabulary of its own;
  // it is filed as the operator's NOTE kind with detail="receipt".
  receipt: "note",
};

const BOUNCE_CLASS: Readonly<Record<InboundBounceClass, BounceClass>> = {
  hard: "hard",
  soft: "soft",
};

export const SYNC_COUNTERS = [
  "listed",
  "already_seen",
  "unrelated",
  "matched",
  "matched_by_in_reply_to",
  "matched_by_references",
  "matched_by_thread",
  "matched_by_embedded_original",
  "matched_by_from",
  "replies",
  "bounces_hard",
  "bounces_soft",
  "auto_replies",
  "unsubscribes",
  "receipts",
  "stopped_bounce",
  "stopped_opt_out",
  "stopped_reply",
  "held_away",
  "suppressed_post_finish",
  "bounce_address_mismatch",
  "read_errors",
  "sender_errors",
] as const;
export type SyncCounter = (typeof SYNC_COUNTERS)[number];
export type SyncCounts = Record<SyncCounter, number>;

export interface SyncStats extends SyncCounts {
  senders: number;
  per_sender: Record<string, SyncCounts>;
}

function counts(): SyncCounts {
  return Object.fromEntries(SYNC_COUNTERS.map((key) => [key, 0])) as SyncCounts;
}

const CLASS_COUNTER: Readonly<Record<Exclude<InboundKind, "bounce">, SyncCounter>> = {
  reply: "replies",
  auto_reply: "auto_replies",
  unsubscribe: "unsubscribes",
  receipt: "receipts",
};

/** The provider's message object, read defensively: shapes are Gmail's, not ours. */
export type MessageMetadata = Record<string, unknown>;

/** The read half of a mailbox. `GmailClient` satisfies this structurally; tests hand the sync an in-memory fake. */
export interface InboxReader {
  listMessages(
    sender: string,
    query: string,
    opts: { pageToken?: string | null; maxResults?: number; includeSpamTrash?: boolean },
  ): Promise<[string[], string | null]>;
  getMetadata(
    sender: string,
    messageId: string,
    headers: readonly string[],
  ): Promise<MessageMetadata>;
  getRaw(sender: string, messageId: string): Promise<Uint8Array>;
}

// --------------------------------------------------------------------------
// Reading the provider's object

type Headers = Readonly<Record<string, string>>;

/** `payload.headers` as a lowercase-keyed map with whitespace collapsed: providers disagree about `Message-ID` vs `Message-Id`. */
function normalizedHeaders(metadata: MessageMetadata): Headers {
  const headers: Record<string, string> = {};
  const payload = metadata.payload;
  const entries =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { headers?: unknown }).headers)
      ? ((payload as { headers: unknown[] }).headers as unknown[])
      : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { name, value } = entry as { name?: unknown; value?: unknown };
    const key = String(name ?? "").trim();
    if (!key || value === null || value === undefined) continue;
    headers[key.toLowerCase()] = String(value).split(/\s+/).filter(Boolean).join(" ");
  }
  return headers;
}

/** The subset we asked for, under its canonical spelling — what lands in `thread_events.headers`. */
function storedHeaders(headers: Headers): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const name of METADATA_HEADERS) {
    const value = headers[name.toLowerCase()];
    if (value !== undefined) stored[name] = value;
  }
  return stored;
}

/** Gmail's `internalDate` (epoch milliseconds, as a string). */
function internalMs(metadata: MessageMetadata): number | null {
  const raw = metadata.internalDate;
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) && String(raw).trim() !== "" ? Math.trunc(value) : null;
}

function fromAddressOf(headers: Headers): string | null {
  const [, address] = parseAddr(headers.from ?? "");
  return address.trim().toLowerCase() || null;
}

const ANGLE_ADDR = /<[^<>]+>/g;

/** Every `<id>` in a header value; bare tokens count too, and `References` is whitespace separated. */
function headerIds(raw: string | undefined): string[] {
  if (!raw) return [];
  const found = [...raw.matchAll(ANGLE_ADDR)].map((m) => m[0]);
  return found.length ? found : raw.split(/\s+/).filter(Boolean);
}

// --------------------------------------------------------------------------
// Matching an inbound message to one of our sends

export type MatchSource = "in_reply_to" | "references" | "thread" | "embedded_original" | "from";

/** Whose thread this message belongs to, and how we know. */
interface Match {
  enrollment: Enrollment;
  /** The send it answers, when the match named one; null for a From-only match. */
  message: Message | null;
  matchedBy: MatchSource;
  /** Set when the DSN branch already pulled the body, so it is not fetched twice. */
  raw: Uint8Array | null;
}

/** One of our sends named by any of these Message-IDs, compared normalized. */
async function messageByIds(db: Queryable, ids: readonly string[]): Promise<Message | null> {
  const wanted = new Set<string>();
  for (const value of ids) {
    const normalized = normalizeMessageId(value);
    if (normalized) {
      wanted.add(normalized);
      wanted.add(`<${normalized}>`);
    }
  }
  if (!wanted.size) return null;
  const [row] = await db
    .select()
    .from(messages)
    .where(inArray(sql`lower(${messages.messageId})`, [...wanted]))
    .orderBy(desc(messages.id))
    .limit(1);
  return row ?? null;
}

/** The latest of our sends in this provider thread — the step a reply in the thread is answering. */
async function messageByThread(
  db: Queryable,
  threadId: string | null,
  states: readonly MessageState[] | null,
): Promise<Message | null> {
  if (!threadId) return null;
  const where = states
    ? and(eq(messages.threadId, threadId), inArray(messages.state, [...states]))
    : eq(messages.threadId, threadId);
  const [row] = await db.select().from(messages).where(where).orderBy(desc(messages.id)).limit(1);
  return row ?? null;
}

/** The most recent enrollment we opened to this address, in any state. */
async function enrollmentByAddress(db: Queryable, address: string): Promise<Enrollment | null> {
  const [row] = await db
    .select()
    .from(enrollments)
    .where(eq(sql`lower(${enrollments.toEmail})`, address))
    .orderBy(desc(enrollments.id))
    .limit(1);
  return row ?? null;
}

async function enrollmentOf(db: Queryable, message: Message): Promise<Enrollment> {
  const [row] = await db.select().from(enrollments).where(eq(enrollments.id, message.enrollmentId));
  if (!row)
    throw new Error(
      `message ${message.id} names enrollment ${message.enrollmentId}, which is gone`,
    );
  return row;
}

/** Worth pulling the body to look for embedded original headers: a daemon sender or an RFC 3464 report envelope. */
function looksLikeReport(headers: Headers): boolean {
  const address = fromAddressOf(headers) ?? "";
  if (DAEMON_LOCALPARTS.has(address.split("@", 1)[0] ?? "")) return true;
  return (headers["content-type"] ?? "").toLowerCase().includes("multipart/report");
}

/** The ordered match. A reader failure here propagates: the caller counts it as a read error. */
async function match(
  db: Queryable,
  opts: {
    reader: InboxReader;
    sender: string;
    gmailId: string;
    headers: Headers;
    threadId: string | null;
  },
): Promise<Match | null> {
  const { headers, threadId } = opts;
  let message = await messageByIds(db, headerIds(headers["in-reply-to"]));
  if (message) {
    return {
      enrollment: await enrollmentOf(db, message),
      message,
      matchedBy: "in_reply_to",
      raw: null,
    };
  }
  message = await messageByIds(db, headerIds(headers.references));
  if (message) {
    return {
      enrollment: await enrollmentOf(db, message),
      message,
      matchedBy: "references",
      raw: null,
    };
  }
  message = await messageByThread(db, threadId, THREAD_STATES);
  if (message) {
    return { enrollment: await enrollmentOf(db, message), message, matchedBy: "thread", raw: null };
  }

  let raw: Uint8Array | null = null;
  if (looksLikeReport(headers)) {
    // A DSN names our message inside its embedded original headers and
    // nowhere else; that costs a body fetch, which is why only report shapes
    // pay it. Classified without `ourMessageIds` here — we do not know the
    // enrollment yet — and classified again once we do, off the same bytes.
    raw = await opts.reader.getRaw(opts.sender, opts.gmailId);
    const report = classify(raw);
    message = await messageByIds(db, [report.originalMessageId ?? ""]);
    if (message) {
      return {
        enrollment: await enrollmentOf(db, message),
        message,
        matchedBy: "embedded_original",
        raw,
      };
    }
    // Some MTAs report without quoting the original at all; Gmail still files
    // the DSN in our thread, in whatever state the send reached.
    message = await messageByThread(db, threadId, null);
    if (message) {
      return { enrollment: await enrollmentOf(db, message), message, matchedBy: "thread", raw };
    }
  }

  const address = fromAddressOf(headers);
  if (address) {
    const enrollment = await enrollmentByAddress(db, address);
    if (enrollment) return { enrollment, message: null, matchedBy: "from", raw };
  }
  return null;
}

// --------------------------------------------------------------------------
// Writing the evidence and acting on it

/**
 * The diagnostic kept on a bounce event, and whether the DSN names a
 * different address than the one we mailed.
 *
 * A report about another recipient (a forwarder's own dead target, a
 * distribution list member, a misdirected NDR) is *evidence* about this
 * thread, never a promise about that address: we never mailed it, so we never
 * suppress it, and nothing has been said against the address we DID mail, so
 * its thread is not stopped either. A DSN that names no recipient at all is
 * not a mismatch: unnamed is assumed to be ours.
 */
function bounceDetail(inbound: Inbound, toEmail: string): [string | null, boolean] {
  const reported = (inbound.bouncedAddress ?? "").trim().toLowerCase();
  const mailed = toEmail.trim().toLowerCase();
  const mismatch = reported !== "" && reported !== mailed;
  const parts: string[] = [];
  if (inbound.bounceStatus) parts.push(`status ${inbound.bounceStatus}`);
  if (mismatch) {
    parts.push(`DSN names ${reported}, we mailed ${mailed} — not suppressed, thread continues`);
  } else if (reported) parts.push(`reported ${reported}`);
  if (inbound.diagnostic) parts.push(inbound.diagnostic);
  return [parts.join("; ") || null, mismatch];
}

/**
 * Insert the evidence row, or null when another writer got there first. The
 * unique index on `gmail_id` is what makes "first insert wins" a database fact
 * rather than a check-then-write race: two syncs of the same inbox cannot both
 * act on one message.
 */
async function writeEvent(
  db: Queryable,
  opts: {
    match: Match;
    inbound: Inbound;
    headers: Headers;
    gmailId: string;
    threadId: string | null;
    receivedAt: Date;
    detail: string | null;
    runId: string | null;
  },
): Promise<ThreadEvent | null> {
  const { match: m, inbound } = opts;
  const [event] = await db
    .insert(threadEvents)
    .values({
      enrollmentId: m.enrollment.id,
      inReplyToMessageId: m.message?.id ?? null,
      kind: KIND[inbound.kind],
      bounceClass: inbound.bounceClass ? BOUNCE_CLASS[inbound.bounceClass] : null,
      gmailId: opts.gmailId,
      gmailThreadId: opts.threadId,
      fromAddress: inbound.fromAddress ?? fromAddressOf(opts.headers),
      subject: inbound.subject,
      snippet: inbound.snippet,
      // Only a human reply is ever classified; a bounce's body is the DSN, already read.
      bodyText: inbound.kind === "reply" ? inbound.text : null,
      headers: storedHeaders(opts.headers),
      detail: opts.detail,
      receivedAt: opts.receivedAt,
      runId: opts.runId,
    })
    .onConflictDoNothing()
    .returning();
  return event ?? null;
}

/**
 * The do-not-contact half. An ACTIVE enrollment is stopped (which writes the
 * suppression for its `to_email`); a finished or already-stopped one has no
 * state left to change, so the promise is recorded directly. A bounce or an
 * opt-out after the last step is exactly as binding as one during it.
 */
async function stopOrSuppress(
  db: Queryable,
  opts: {
    enrollment: Enrollment;
    reason: StopReason;
    detail: string;
    event: ThreadEvent;
    counts: SyncCounts;
    stoppedKey: SyncCounter;
    now: Date;
    shared: SharedSuppressions | null;
  },
): Promise<void> {
  const { enrollment, reason, detail, event, shared } = opts;
  if (enrollment.state === "active") {
    await recordStop(db, enrollment, reason, { detail, now: opts.now, shared });
    opts.counts[opts.stoppedKey] += 1;
    return;
  }
  await ensureSuppression(
    db,
    enrollment.toEmail,
    reason,
    { thread_event_id: event.id, enrollment_id: enrollment.id, reason, detail },
    shared,
  );
  opts.counts.suppressed_post_finish += 1;
}

/**
 * What each class does. An auto-reply that names a return day holds the next
 * step until then; soft bounces, other auto-replies and receipts do nothing.
 */
async function act(
  db: Queryable,
  opts: {
    enrollment: Enrollment;
    inbound: Inbound;
    event: ThreadEvent;
    counts: SyncCounts;
    mismatch: boolean;
    away: PlainDate | null;
    now: Date;
    shared: SharedSuppressions | null;
  },
): Promise<void> {
  const { enrollment, inbound, event, counts: c, away, now, shared } = opts;
  if (away !== null) {
    if (enrollment.state !== "active") return;
    // The latest return day wins: an older auto-reply synced late never shortens a hold.
    const held = await db
      .update(enrollments)
      .set({ awayUntil: away.toString() })
      .where(
        and(
          eq(enrollments.id, enrollment.id),
          sql`(${enrollments.awayUntil} IS NULL OR ${enrollments.awayUntil} < ${away.toString()})`,
        ),
      )
      .returning({ id: enrollments.id });
    c.held_away += held.length;
  } else if (inbound.kind === "bounce") {
    if (inbound.bounceClass !== "hard") return;
    // The DSN failed a DIFFERENT address than the one we mailed: no stop, no
    // suppression, and the thread carries on. The event still stands as
    // evidence and still counts in `send_health` and the kill switch.
    if (opts.mismatch) return;
    await stopOrSuppress(db, {
      enrollment,
      reason: "bounce",
      detail: `bounce ${inbound.bounceStatus ?? "hard"} (event ${event.id})`,
      event,
      counts: c,
      stoppedKey: "stopped_bounce",
      now,
      shared,
    });
  } else if (inbound.kind === "unsubscribe") {
    await stopOrSuppress(db, {
      enrollment,
      reason: "opt_out",
      detail: `unsubscribe from ${inbound.fromAddress ?? "unknown"} (event ${event.id})`,
      event,
      counts: c,
      stoppedKey: "stopped_opt_out",
      now,
      shared,
    });
  } else if (inbound.kind === "reply") {
    // Company-scoped: a human answering from anywhere in the firm stops every
    // live thread into it. Zero stopped is a normal outcome.
    c.stopped_reply += await stopCompany(db, {
      companyId: enrollment.companyId,
      reason: "reply",
      detail: `reply from ${inbound.fromAddress ?? "unknown"} (event ${event.id})`,
      now,
      shared,
    });
  }
}

// --------------------------------------------------------------------------
// The sync

/** Which of a listed page's ids are already stored: one query per page, not per message. */
async function alreadyStored(db: Queryable, gmailIds: string[]): Promise<Set<string>> {
  if (gmailIds.length === 0) return new Set();
  const rows = await db
    .select({ gmailId: threadEvents.gmailId })
    .from(threadEvents)
    .where(inArray(threadEvents.gmailId, gmailIds));
  return new Set(rows.flatMap((r) => (r.gmailId === null ? [] : [r.gmailId])));
}

/**
 * Where this sender's listing starts. A first sync reaches back
 * `firstSyncLookbackMs`; every later one re-lists a day of already-seen mail,
 * because the overlap is cheap and dedup by `gmail_id` makes it free of
 * consequence. The lookback is also the floor: a cursor from months ago does
 * not make one run re-read a year of mail.
 */
export function since(
  cursorMs: number,
  opts: { now: Date; firstSyncLookbackMs: number; overlapMs: number },
): Date {
  const floor = opts.now.getTime() - opts.firstSyncLookbackMs;
  if (!cursorMs) return new Date(floor);
  return new Date(Math.max(cursorMs - opts.overlapMs, floor));
}

/**
 * One inbound message, end to end, in its own transaction. Returns its
 * `internalDate` in milliseconds when we read it (the cursor's input), null
 * when it was skipped as already seen.
 */
async function handleMessage(
  db: Db,
  opts: {
    reader: InboxReader;
    sender: string;
    gmailId: string;
    now: Date;
    runId: string | null;
    counts: SyncCounts;
    shared: SharedSuppressions | null;
  },
): Promise<number | null> {
  const { reader, sender, gmailId, now, counts: c } = opts;
  const metadata = await reader.getMetadata(sender, gmailId, METADATA_HEADERS);
  const headers = normalizedHeaders(metadata);
  const threadId = typeof metadata.threadId === "string" ? metadata.threadId : null;
  const seenMs = internalMs(metadata);

  return atomic(db, async (tx) => {
    const m = await match(tx, { reader, sender, gmailId, headers, threadId });
    if (m === null) {
      // Warmup traffic, fleet test mail, personal mail: not ours, not stored,
      // and no body ever fetched for it.
      c.unrelated += 1;
      return seenMs;
    }
    c.matched += 1;
    c[`matched_by_${m.matchedBy}`] += 1;

    const raw = m.raw ?? (await reader.getRaw(sender, gmailId));
    const ours = (
      await tx
        .select({ messageId: messages.messageId })
        .from(messages)
        .where(eq(messages.enrollmentId, m.enrollment.id))
    )
      .map((row) => row.messageId)
      .filter((id): id is string => !!id);
    const inbound = classify(raw, { ourMessageIds: ours });

    const receivedAt = seenMs !== null ? new Date(seenMs) : (inbound.date ?? now);
    const away =
      inbound.kind === "auto_reply"
        ? awayUntil(
            `${inbound.subject ?? ""}\n${inbound.text ?? ""}`,
            PlainDate.utcDayOf(receivedAt),
          )
        : null;

    let detail: string | null = null;
    let mismatch = false;
    if (inbound.kind === "bounce") [detail, mismatch] = bounceDetail(inbound, m.enrollment.toEmail);
    else if (inbound.kind === "receipt") detail = "receipt";
    else if (away !== null) detail = `away until ${away}`;

    const event = await writeEvent(tx, {
      match: m,
      inbound,
      headers,
      gmailId,
      threadId,
      receivedAt,
      detail,
      runId: opts.runId,
    });
    if (event === null) {
      // Another sync of the same inbox inserted this message between our
      // check and our write. Their run acts on it; ours does not.
      c.already_seen += 1;
      return seenMs;
    }

    if (inbound.kind === "bounce") {
      c[inbound.bounceClass === "hard" ? "bounces_hard" : "bounces_soft"] += 1;
      if (mismatch) c.bounce_address_mismatch += 1;
    } else {
      c[CLASS_COUNTER[inbound.kind]] += 1;
    }

    await act(tx, {
      enrollment: m.enrollment,
      inbound,
      event,
      counts: c,
      mismatch,
      away,
      now,
      shared: opts.shared,
    });
    return seenMs;
  });
}

export interface SyncInboxOptions {
  reader: InboxReader;
  senders: readonly string[];
  now: Date;
  runId?: string | null;
  /** A first sync reaches back this far (default 30 days). */
  firstSyncLookbackMs?: number;
  /** Every later sync re-lists this much already-seen mail (default 1 day). */
  overlapMs?: number;
  /** Where a read or listing failure goes; the walk continues either way. */
  onWarn?: (message: string, err: unknown) => void;
  /** A client's inboxes: their opt-outs and bounces also land on main's list. */
  shared?: SharedSuppressions | null;
}

export const DAY_MS = 86_400_000;

/**
 * Read every sender's mailbox from its cursor forward, record what belongs to
 * us, and act on it.
 *
 * Senders are walked in the given order and each one's cursor commits on its
 * own: a crash loses at most the inbox in flight, and re-running resumes from
 * the cursors already committed. Returns the fleet's counts plus `per_sender`,
 * each sender's own copy (also written to `inbox_syncs.stats`).
 */
export async function syncInbox(db: Db, opts: SyncInboxOptions): Promise<SyncStats> {
  const { reader, now } = opts;
  const runId = opts.runId ?? null;
  const firstSyncLookbackMs = opts.firstSyncLookbackMs ?? 30 * DAY_MS;
  const overlapMs = opts.overlapMs ?? DAY_MS;
  const warn = opts.onWarn ?? (() => {});
  const overall: SyncStats = { ...counts(), senders: 0, per_sender: {} };

  for (const sender of opts.senders) {
    const c = counts();
    overall.per_sender[sender] = c;
    overall.senders += 1;

    const cursor = await cursorRow(db, sender);
    const start = since(cursor.cursorMs, { now, firstSyncLookbackMs, overlapMs });
    const query = QUERY(Math.floor(start.getTime() / 1000));

    let newestMs: number | null = null;
    let listingFailed = false;
    let pageToken: string | null = null;
    for (;;) {
      let ids: string[];
      try {
        // Spam and Trash included on purpose: Gmail spam-files NDRs from
        // unusual MTAs and terse unsubscribes. Acting twice on one message is
        // impossible either way.
        [ids, pageToken] = await reader.listMessages(sender, query, {
          pageToken,
          maxResults: PAGE_SIZE,
          includeSpamTrash: true,
        });
      } catch (err) {
        // A paused, suspended or throttled inbox must not stop the rest of the fleet.
        warn(`inbox sync: listing ${sender} failed`, err);
        c.sender_errors += 1;
        listingFailed = true;
        break;
      }
      // Every sync re-lists a day of seen mail: skip it before any Gmail read.
      const stored = await alreadyStored(db, ids);
      for (const gmailId of ids) {
        c.listed += 1;
        if (stored.has(gmailId)) {
          c.already_seen += 1;
          continue;
        }
        let seenMs: number | null;
        try {
          seenMs = await handleMessage(db, {
            reader,
            sender,
            gmailId,
            now,
            runId,
            counts: c,
            shared: opts.shared ?? null,
          });
        } catch (err) {
          warn(`inbox sync: reading ${sender}/${gmailId} failed`, err);
          c.read_errors += 1;
          continue;
        }
        if (seenMs !== null && (newestMs === null || seenMs > newestMs)) newestMs = seenMs;
      }
      if (!pageToken) break;
    }

    // Never backwards, and never at all after a listing failure: Gmail lists
    // newest first, so advancing past a page we never got would skip that
    // page's mail permanently.
    const patch: { cursorMs?: number; syncedAt?: Date; stats: SyncCounts } = { stats: { ...c } };
    if (!listingFailed) {
      if (newestMs !== null && newestMs > cursor.cursorMs) patch.cursorMs = newestMs;
      patch.syncedAt = now;
    }
    await db.update(inboxSyncs).set(patch).where(eq(inboxSyncs.sender, sender));
    for (const key of SYNC_COUNTERS) overall[key] += c[key];
  }
  return overall;
}

async function cursorRow(db: Db, sender: string): Promise<{ cursorMs: number }> {
  const [existing] = await db.select().from(inboxSyncs).where(eq(inboxSyncs.sender, sender));
  if (existing) return { cursorMs: existing.cursorMs || 0 };
  await db.insert(inboxSyncs).values({ sender, cursorMs: 0 }).onConflictDoNothing();
  return { cursorMs: 0 };
}

// --------------------------------------------------------------------------
// The operator's own entries

/**
 * Record a reply that never reached the mailbox — a phone call back, a
 * LinkedIn message, a forward from a colleague — and stop the company for it,
 * exactly as a synced reply would. An operator entering a reply by hand has
 * read it, so `disposition_source` is OPERATOR from the start. It carries no
 * `gmail_id`, which is why the idempotence index is partial.
 */
export async function recordOperatorReply(
  db: Queryable,
  opts: {
    enrollment: Enrollment;
    disposition: ReplyDisposition;
    note: string | null;
    fromAddress: string | null;
    now: Date;
    runId?: string | null;
  },
): Promise<ThreadEvent> {
  const [event] = await db
    .insert(threadEvents)
    .values({
      enrollmentId: opts.enrollment.id,
      kind: "reply",
      disposition: opts.disposition,
      dispositionSource: "operator",
      classifiedAt: opts.now,
      fromAddress: opts.fromAddress,
      detail: opts.note,
      receivedAt: opts.now,
      runId: opts.runId ?? null,
    })
    .returning();
  if (!event) throw new Error("thread_events insert returned no row");
  await stopCompany(db, {
    companyId: opts.enrollment.companyId,
    reason: "reply",
    detail: `operator-recorded reply (event ${event.id})`,
    now: opts.now,
  });
  return event;
}

/**
 * Put (or correct) the one mutable label on an append-only event.
 *
 * Only a human reply carries a disposition: out-of-office is a KIND, and so is
 * a bounce or an unsubscribe. Labelling one of those "not interested" would
 * read a machine's answer as a person's, so it throws rather than writing a
 * row the CHECK would take.
 */
export async function labelEvent(
  db: Queryable,
  opts: {
    event: ThreadEvent;
    disposition: ReplyDisposition;
    now: Date;
    source?: DispositionSource;
  },
): Promise<void> {
  const { event } = opts;
  if (event.kind !== "reply") {
    throw new Error(
      `thread event ${event.id} is a ${event.kind}, not a reply — only a human reply carries a disposition`,
    );
  }
  await db
    .update(threadEvents)
    .set({
      disposition: opts.disposition,
      dispositionSource: opts.source ?? "operator",
      classifiedAt: opts.now,
    })
    .where(eq(threadEvents.id, event.id));
}
