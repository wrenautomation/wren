/**
 * The send tick: one paced walk of the outbox.
 *
 * `sendDue` is not a daemon and not a queue drain. It asks "what may leave
 * right now?", sends that, and returns a stats table saying what it did and,
 * when it did nothing, why. Everything it needs is recomputed from the outbox
 * and the clock on every call, so a crash costs at most one message.
 *
 * Intent before act: the record of the attempt is committed BEFORE the
 * transport is called — APPROVED → SENDING with our own Message-ID and
 * `attemptedAt`, in its own transaction — and only then the send. A process
 * that dies mid-call leaves a SENDING row reconcile can resolve.
 *
 * Ambiguity is a state, not a retry: a refusal means nothing left (FAILED,
 * re-armable); anything else means the bytes MAY have arrived (UNKNOWN, only
 * reconcile may move it). An unexpected exception is classed as ambiguous.
 *
 * Follow-ups before openers, always. One send per enrollment per tick.
 *
 * The walk reads stops, suppressions and sender pauses — never inbound
 * evidence. What a reply or a bounce meant was decided by the sync or a human
 * and written as a stop or a suppression before this code ever runs.
 */
import { randomUUID } from "node:crypto";
import { companies, type Suppression } from "@wren/core";
import type { Calendar } from "@wren/core/calendar";
import type { Db, Queryable } from "@wren/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  max,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { activeSuppressions } from "../guards.js";
import { pyReprStr } from "../outreach/pyrepr.js";
import {
  type Enrollment,
  enrollments,
  type Message,
  type MessageState,
  messages,
  type StopReason,
  senderPauses,
  verifications,
} from "../schema.js";
import { transitionEnrollment, transitionMessage } from "../state.js";
import { CALL_TIMES, fillCallTimes, LOOKAHEAD_MS } from "./call-times.js";
import { addBusinessDays, PlainDate } from "./dates.js";
import type { SendPolicy } from "./policy.js";
import { IN_FLIGHT, reconcile } from "./reconcile.js";
import { type Rng, systemRng } from "./rng.js";
import { ensureSuppression } from "./suppress.js";
import {
  buildPixelUrl,
  fillPage,
  type OutgoingEmail,
  type SendReceipt,
  type Transport,
  TransportAmbiguous,
  TransportRefused,
} from "./transport.js";
import { assertInstant, canonicalZone } from "./tz.js";

/** States a step can still be sent from — and the only states a stop may skip. */
export const LIVE = ["draft", "approved", "failed"] as const satisfies readonly MessageState[];
const isLive = (state: MessageState) => (LIVE as readonly MessageState[]).includes(state);
const isInFlight = (state: MessageState) => (IN_FLIGHT as readonly MessageState[]).includes(state);

const SUPPRESSION_STOP: Readonly<Record<string, StopReason>> = Object.freeze({
  opt_out: "opt_out",
  bounce: "bounce",
  complaint: "complaint",
  manual: "manual",
});

/** Every key a tick reports, always present: a tick that sent nothing says why. */
export const STAT_KEYS = [
  "sent",
  "failed",
  "ambiguous",
  "finished",
  "waiting",
  "waiting_away",
  "awaiting_approval",
  "awaiting_retry",
  "awaiting_reconcile",
  "skipped_no_thread",
  "stopped_suppressed",
  "stopped_undeliverable",
  "stopped_cooldown",
  "window_closed",
  "lead_window_waiting",
  "senders_paused",
  "sender_not_on_roster",
  "senders_capped",
  "gap_waiting",
  "openers_capped",
  "raced",
  "sender_errors",
  "reconciled_sent",
  "reconciled_failed",
  "reconcile_pending",
  "reconcile_errors",
  "reconcile_transport_mismatch",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type SendStats = Record<StatKey, number>;

export function emptySendStats(): SendStats {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as SendStats;
}

export type NameMap = Readonly<Record<string, string | null>>;
export type StringMap = Readonly<Record<string, string>>;

export interface SendDueOptions {
  transport: Transport;
  policy: SendPolicy;
  now?: Date;
  /** Seeds the per-inbox gap draw, so a tick is reproducible. */
  rng?: Rng;
  limit?: number | null;
  runId?: string | null;
  fromNames?: NameMap | null;
  signatureHtml?: StringMap | null;
  pages?: StringMap | null;
  pixelBaseUrl?: string | null;
  /** Where `{call.times}` finds open times. Absent, or failing, the email says "early next week". */
  calendar?: Calendar | null;
  /**
   * The fleet the caller is willing to send from: the roster's active
   * addresses. An enrollment pinned to an inbox no longer here is counted
   * `sender_not_on_roster`. null = no roster opinion, every pin allowed.
   */
  senders?: readonly string[] | null;
  reconcileFirst?: boolean;
}

interface Candidate {
  enrollment: Enrollment;
  messages: Message[];
  message: Message;
  anchor: Message | null;
}

const messagesOf = (db: Queryable, enrollmentId: number): Promise<Message[]> =>
  db
    .select()
    .from(messages)
    .where(eq(messages.enrollmentId, enrollmentId))
    .orderBy(asc(messages.step));

/** `messagesOf` for many enrollments in one query, each list in step order. */
async function messagesOfAll(db: Queryable, ids: number[]): Promise<Map<number, Message[]>> {
  const out = new Map<number, Message[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(messages)
    .where(inArray(messages.enrollmentId, ids))
    .orderBy(asc(messages.enrollmentId), asc(messages.step));
  for (const m of rows) {
    const list = out.get(m.enrollmentId);
    if (list) list.push(m);
    else out.set(m.enrollmentId, [m]);
  }
  return out;
}

/** The `steps[].day` list pinned on the enrollment at compose. */
function snapshotDays(enrollment: Enrollment): number[] {
  const snapshot = enrollment.sequenceSnapshot as { steps?: unknown };
  const steps = snapshot?.steps;
  if (!Array.isArray(steps)) {
    throw new Error(`enrollment ${enrollment.id} has no steps in its sequence snapshot`);
  }
  return steps.map((step, i) => {
    const day = (step as { day?: unknown })?.day;
    if (typeof day !== "number") {
      throw new Error(`enrollment ${enrollment.id}: step ${i} of the snapshot has no day`);
    }
    return day;
  });
}

/** One tick of the outbox. Returns the stats table (`STAT_KEYS`). */
export async function sendDue(db: Db, opts: SendDueOptions): Promise<SendStats> {
  const { transport, policy } = opts;
  const now = assertInstant(opts.now ?? new Date());
  const rng = opts.rng ?? systemRng;
  const limit = opts.limit ?? null;
  const stats = emptySendStats();

  if (opts.reconcileFirst ?? true) {
    const counts = await reconcile(db, { transport, policy, now });
    stats.reconciled_sent = counts.reconciled_sent;
    stats.reconciled_failed = counts.reconciled_failed;
    stats.reconcile_pending = counts.pending;
    stats.reconcile_errors = counts.errors;
    stats.reconcile_transport_mismatch = counts.transport_mismatch;
  }

  if (!policy.windowOpen(now)) {
    // Outside the window there is no such thing as a due message.
    stats.window_closed = 1;
    return stats;
  }

  // Sender → who paused it: a kill-switch pause does not stop a niche the switch is off for.
  const paused = new Map(
    (
      await db
        .select({ sender: senderPauses.sender, source: senderPauses.source })
        .from(senderPauses)
        .where(sql`${senderPauses.liftedAt} IS NULL`)
    ).map((r) => [r.sender, r.source]),
  );
  const fleet = opts.senders == null ? null : new Set(opts.senders.map((a) => a.toLowerCase()));
  const {
    sentToday,
    openersToday: openersAtStart,
    nicheOpeners,
  } = await todaysSends(db, policy, now);
  let openersToday = openersAtStart;
  const lastSentPerSender = await lastSendPerSender(db);

  // Classify every ACTIVE enrollment into at most one due message, under
  // FOR UPDATE SKIP LOCKED so an overlapping tick skips what this one walks.
  const { followups, openers } = await db.transaction(async (tx) => {
    const followups: Candidate[] = [];
    const openers: Candidate[] = [];
    const rows = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.state, "active"))
      .orderBy(asc(enrollments.id))
      .for("update", { skipLocked: true });
    // Two reads for the whole walk, not two per enrollment.
    const byEnrollment = await messagesOfAll(
      tx,
      rows.map((e) => e.id),
    );
    const addresses = rows.flatMap((e) => byEnrollment.get(e.id)?.[0]?.toEmail ?? []);
    const suppressed = await activeSuppressions(tx, addresses);
    const invalid = await invalidNow(tx, addresses);
    for (const enrollment of rows) {
      const msgs = byEnrollment.get(enrollment.id) ?? [];
      const due = await nextDue(tx, enrollment, msgs, now, stats, suppressed, invalid, policy);
      if (due === null) continue;
      const candidate: Candidate = { enrollment, messages: msgs, ...due };
      if (due.anchor === null) openers.push(candidate);
      else followups.push(candidate);
    }
    return { followups, openers };
  });

  const candidates = [...followups, ...openers];
  const leadZones = await leadZonesFor(
    db,
    new Set(candidates.map((c) => c.enrollment.companyId)),
    policy,
  );

  // An inbox that just refused at the sender level is unusable for the rest
  // of this tick: one bad token must not become fifty FAILED rows.
  const sidelined = new Set<string>();
  const openTimes = onceOpenTimes(opts.calendar ?? null, now);
  for (const candidate of candidates) {
    const { enrollment, message, anchor } = candidate;
    if (limit !== null && stats.sent >= limit) break;
    if (!policy.leadWindowOpen(now, leadZones.get(enrollment.companyId) ?? null)) {
      // Held for the lead's afternoon; takes nothing from its inbox.
      stats.lead_window_waiting += 1;
      continue;
    }
    const sender = enrollment.sender;
    const pausedBy = paused.get(sender);
    if (
      pausedBy !== undefined &&
      !(pausedBy === "kill_switch" && !policy.killSwitchOn(enrollment.niche))
    ) {
      stats.senders_paused += 1;
      continue;
    }
    if (fleet !== null && !fleet.has(sender.toLowerCase())) {
      stats.sender_not_on_roster += 1;
      continue;
    }
    if (sidelined.has(sender)) continue; // counted as a sender_error where it happened
    if ((sentToday.get(sender) ?? 0) >= policy.perInboxCap(now)) {
      stats.senders_capped += 1;
      continue;
    }
    const lastSent = lastSentPerSender.get(sender) ?? null;
    if (lastSent !== null && now < policy.earliestNextSend(lastSent, sentToday.get(sender) ?? 0)) {
      stats.gap_waiting += 1;
      continue;
    }
    const opening = anchor === null;
    const nicheCap = policy.nicheOpenerCap(enrollment.niche);
    if (
      opening &&
      ((policy.newOpenersPerDay !== null && openersToday >= policy.newOpenersPerDay) ||
        (nicheCap !== null && (nicheOpeners.get(enrollment.niche) ?? 0) >= nicheCap))
    ) {
      stats.openers_capped += 1;
      continue;
    }
    const conflict = await cooldownConflict(db, enrollment, policy, now);
    if (conflict !== null) {
      await db.transaction((tx) => stopForCooldown(tx, enrollment, message, conflict, now));
      stats.stopped_cooldown += 1;
      continue;
    }
    const outcome = await sendOne(db, candidate, {
      transport,
      policy,
      now,
      rng,
      runId: opts.runId ?? null,
      fromNames: opts.fromNames ?? null,
      signatureHtml: opts.signatureHtml ?? null,
      pages: opts.pages ?? null,
      pixelBaseUrl: opts.pixelBaseUrl ?? null,
      openTimes,
      stats,
      sidelined,
    });
    if (outcome.delivered) {
      sentToday.set(sender, (sentToday.get(sender) ?? 0) + 1);
      lastSentPerSender.set(sender, now);
      if (opening) {
        openersToday += 1;
        nicheOpeners.set(enrollment.niche, (nicheOpeners.get(enrollment.niche) ?? 0) + 1);
      }
      if (!outcome.messages.some((m) => isLive(m.state))) {
        // That was the last step: finish here rather than leave a completed
        // enrollment ACTIVE until some later tick walks it again.
        await db
          .update(enrollments)
          .set({ state: transitionEnrollment("active", "finished") })
          .where(and(eq(enrollments.id, enrollment.id), eq(enrollments.state, "active")));
        stats.finished += 1;
      }
    }
  }
  return stats;
}

// --- the pacing facts, read once per tick ------------------------------

/**
 * (sends per inbox, openers fleet-wide, openers per niche) over the policy's
 * LOCAL day: the cap is a promise about one operator's working day. Openers are step 0.
 */
async function todaysSends(
  db: Queryable,
  policy: SendPolicy,
  now: Date,
): Promise<{
  sentToday: Map<string, number>;
  openersToday: number;
  nicheOpeners: Map<string, number>;
}> {
  const [dayStart, dayEnd] = policy.localDayBounds(now);
  const rows = await db
    .select({
      sender: enrollments.sender,
      niche: enrollments.niche,
      step: messages.step,
      n: count(),
    })
    .from(messages)
    .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(
      and(eq(messages.state, "sent"), gte(messages.sentAt, dayStart), lt(messages.sentAt, dayEnd)),
    )
    .groupBy(enrollments.sender, enrollments.niche, messages.step);
  const sentToday = new Map<string, number>();
  const nicheOpeners = new Map<string, number>();
  let openersToday = 0;
  for (const { sender, niche, step, n } of rows) {
    sentToday.set(sender, (sentToday.get(sender) ?? 0) + n);
    if (step === 0) {
      openersToday += n;
      nicheOpeners.set(niche, (nicheOpeners.get(niche) ?? 0) + n);
    }
  }
  return { sentToday, openersToday, nicheOpeners };
}

/**
 * Each candidate company's own clock (companies.timezone), parsed once per
 * distinct zone. A stored key that is not an IANA zone stops the tick before
 * any send, loudly: a bad row is a hand edit to fix, not a lead to skip.
 */
async function leadZonesFor(
  db: Queryable,
  companyIds: ReadonlySet<number>,
  policy: SendPolicy,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (policy.leadWindowStart === null || companyIds.size === 0) return out;
  const rows = await db
    .select({ id: companies.id, timezone: companies.timezone })
    .from(companies)
    .where(and(inArray(companies.id, [...companyIds]), isNotNull(companies.timezone)));
  const zones = new Map<string, string>();
  for (const { id, timezone } of rows) {
    if (timezone === null) continue;
    let zone = zones.get(timezone);
    if (zone === undefined) {
      const canonical = canonicalZone(timezone);
      if (canonical === null) {
        throw new Error(
          `companies.timezone ${pyReprStr(timezone)} on company ${id} is not an IANA zone; ` +
            "`outreach timezones` writes only zones it knows — fix the row before sending",
        );
      }
      zone = canonical;
      zones.set(timezone, zone);
    }
    out.set(id, zone);
  }
  return out;
}

/**
 * The soonest any of `senders` may send again by the gap alone (window and cap
 * aside); null when none has sent. The scheduler sleeps until then.
 */
export async function nextSendAt(
  db: Queryable,
  policy: SendPolicy,
  senders: readonly string[],
  now: Date,
): Promise<Date | null> {
  const wanted = new Set(senders.map((s) => s.toLowerCase()));
  const last = await lastSendPerSender(db);
  const { sentToday } = await todaysSends(db, policy, now);
  let soonest: Date | null = null;
  for (const [sender, at] of last) {
    if (!wanted.has(sender.toLowerCase())) continue;
    const next = policy.earliestNextSend(at, sentToday.get(sender) ?? 0);
    if (soonest === null || next < soonest) soonest = next;
  }
  return soonest;
}

/** The newest send per inbox, any day: the gap is a property of the mailbox's own history. */
async function lastSendPerSender(db: Queryable): Promise<Map<string, Date>> {
  const rows = await db
    .select({ sender: enrollments.sender, last: max(messages.sentAt) })
    .from(messages)
    .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(eq(messages.state, "sent"))
    .groupBy(enrollments.sender);
  const out = new Map<string, Date>();
  for (const { sender, last } of rows) if (last !== null) out.set(sender, last);
  return out;
}

// --- classification: at most one due message per enrollment -------------

/**
 * Addresses whose newest verdict is invalid. A step queued weeks ago went out to an
 * address a later walk, CRM check or reverify found dead: a hard bounce, which no
 * pause takes back. Lowercased, as verifications stores them.
 */
async function invalidNow(db: Queryable, emails: string[]): Promise<Set<string>> {
  const wanted = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (wanted.length === 0) return new Set();
  const rows = await db
    .selectDistinctOn([verifications.email], {
      email: verifications.email,
      result: verifications.result,
    })
    .from(verifications)
    .where(inArray(verifications.email, wanted))
    .orderBy(verifications.email, desc(verifications.checkedAt), desc(verifications.id));
  return new Set(rows.filter((r) => r.result === "invalid").map((r) => r.email as string));
}

/**
 * The one message this enrollment may send now, with its thread anchor (null
 * when it opens) — or null, having counted why not. Everything that is NOT a
 * send is resolved here: the suppression re-check, the in-flight block, the
 * unapproved or wedged step, the finish, the thread-rider with no thread.
 */
async function nextDue(
  tx: Queryable,
  enrollment: Enrollment,
  msgs: Message[],
  now: Date,
  stats: SendStats,
  suppressed: (email: string) => Suppression | null,
  invalid: ReadonlySet<string>,
  policy: SendPolicy,
): Promise<{ message: Message; anchor: Message | null } | null> {
  const first = msgs[0];
  if (first === undefined) return null; // compose never does this; refuse to guess
  const suppression = suppressed(first.toEmail);
  if (suppression !== null) {
    await recordStop(tx, enrollment, SUPPRESSION_STOP[suppression.reason] ?? "manual", {
      detail: `suppressed: ${suppression.kind}:${suppression.value}`,
      messages: msgs,
    });
    stats.stopped_suppressed += 1;
    return null;
  }
  if (invalid.has(first.toEmail.toLowerCase())) {
    await recordStop(tx, enrollment, "undeliverable", {
      detail: "newest verdict: invalid",
      messages: msgs,
    });
    stats.stopped_undeliverable += 1;
    return null;
  }
  if (msgs.some((m) => isInFlight(m.state))) {
    // Only reconcile may decide what happened to it.
    stats.awaiting_reconcile += 1;
    return null;
  }

  const days = snapshotDays(enrollment);
  const today = PlainDate.utcDayOf(now);
  for (;;) {
    const nxt = msgs.find((m) => isLive(m.state));
    if (nxt === undefined) {
      await tx
        .update(enrollments)
        .set({ state: transitionEnrollment(enrollment.state, "finished") })
        .where(eq(enrollments.id, enrollment.id));
      stats.finished += 1;
      return null;
    }
    if (nxt.state === "draft") {
      stats.awaiting_approval += 1;
      return null;
    }
    if (nxt.state === "failed") {
      stats.awaiting_retry += 1;
      return null;
    }
    const anchor = lastSent(msgs);
    let due: PlainDate;
    if (anchor === null) {
      if (nxt.subject === null) {
        // A thread-riding step with no thread to ride (its opener was rejected).
        nxt.state = transitionMessage(nxt.state, "skipped");
        nxt.detail = "no thread to ride: no prior step was sent";
        await tx
          .update(messages)
          .set({ state: nxt.state, detail: nxt.detail })
          .where(eq(messages.id, nxt.id));
        stats.skipped_no_thread += 1;
        continue;
      }
      due = today; // the first sendable step goes out immediately
    } else {
      const anchorDay = days[anchor.step];
      const nextDay = days[nxt.step];
      if (anchorDay === undefined || nextDay === undefined) {
        throw new Error(`enrollment ${enrollment.id}: snapshot has no day for step ${nxt.step}`);
      }
      if (anchor.sentAt === null) throw new Error(`sent message ${anchor.id} has no sent_at`);
      due = addBusinessDays(
        PlainDate.utcDayOf(anchor.sentAt),
        nextDay - anchorDay,
        (day) => policy.holidayOn(day) !== null,
      );
    }
    if (enrollment.awayUntil !== null) {
      // Their out-of-office named a return day: the step waits for the first sending day after it.
      const back = addBusinessDays(
        PlainDate.fromIso(enrollment.awayUntil).addDays(1),
        0,
        (day) => policy.holidayOn(day) !== null,
      );
      if (today.compare(back) < 0) {
        stats[due.compare(back) < 0 ? "waiting_away" : "waiting"] += 1;
        return null;
      }
    }
    if (today.compare(due) < 0) {
      stats.waiting += 1;
      return null;
    }
    return { message: nxt, anchor };
  }
}

function lastSent(msgs: readonly Message[]): Message | null {
  let found: Message | null = null;
  for (const m of msgs) if (m.state === "sent") found = m;
  return found;
}

/** The opener's subject, carried on every riding step so the wire can say `Re: ...`. */
function replySubject(msgs: readonly Message[]): string | null {
  for (const m of msgs) if (m.state === "sent" && m.subject) return m.subject;
  return null;
}

// --- the last gate: cooldown ------------------------------------------

/**
 * `{enrollmentId, sentAt}` if this address or this company was already mailed
 * inside `resendCooldownDays` by a DIFFERENT enrollment, else null. Does not
 * care about state: the partial unique indexes hold only while both are ACTIVE.
 */
async function cooldownConflict(
  db: Queryable,
  enrollment: Enrollment,
  policy: SendPolicy,
  now: Date,
): Promise<{ enrollmentId: number; sentAt: Date } | null> {
  if (policy.resendCooldownDays <= 0) return null;
  const cutoff = new Date(now.getTime() - policy.resendCooldownDays * 86_400_000);
  const [row] = await db
    .select({ enrollmentId: messages.enrollmentId, sentAt: messages.sentAt })
    .from(messages)
    .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(
      and(
        eq(messages.state, "sent"),
        gt(messages.sentAt, cutoff),
        ne(enrollments.id, enrollment.id),
        or(
          eq(sql`lower(${enrollments.toEmail})`, enrollment.toEmail.trim().toLowerCase()),
          eq(enrollments.companyId, enrollment.companyId),
        ),
      ),
    )
    .orderBy(desc(messages.sentAt))
    .limit(1);
  if (row === undefined || row.sentAt === null) return null;
  return { enrollmentId: row.enrollmentId, sentAt: row.sentAt };
}

async function stopForCooldown(
  tx: Queryable,
  enrollment: Enrollment,
  message: Message,
  conflict: { enrollmentId: number; sentAt: Date },
  now: Date,
): Promise<void> {
  await recordStop(tx, enrollment, "manual", { detail: "duplicate address/company (cooldown)" });
  // recordStop stamps every skipped step with the stop's own detail; the step
  // that actually hit the gate keeps the specific evidence.
  const days = Math.max(Math.floor((now.getTime() - conflict.sentAt.getTime()) / 86_400_000), 0);
  await tx
    .update(messages)
    .set({
      detail: `cooldown: address/company was mailed ${days} days ago by enrollment ${conflict.enrollmentId}`,
    })
    .where(eq(messages.id, message.id));
}

// --- the irreversible part ---------------------------------------------

interface SendContext {
  transport: Transport;
  policy: SendPolicy;
  now: Date;
  rng: Rng;
  runId: string | null;
  fromNames: NameMap | null;
  signatureHtml: StringMap | null;
  pages: StringMap | null;
  pixelBaseUrl: string | null;
  /** The calendar's open times for this pass, asked once; null when it couldn't say. */
  openTimes: () => Promise<Date[] | null>;
  stats: SendStats;
  sidelined: Set<string>;
}

/**
 * The per-inbox gap and daily cap, re-asked with the row locked, over every
 * message this inbox has sent or is still trying to send (SENT plus in-flight,
 * whose bytes may be on the wire). An overlapping tick that sent from this
 * inbox since the top of the walk is invisible to the pre-checks.
 */
async function pacedUnderLock(
  tx: Queryable,
  enrollment: Enrollment,
  message: Message,
  ctx: SendContext,
): Promise<boolean> {
  const instant = sql`coalesce(${messages.sentAt}, ${messages.attemptedAt})`;
  const [dayStart, dayEnd] = ctx.policy.localDayBounds(ctx.now);
  const [row] = await tx
    .select({
      last: sql`max(${instant})`.mapWith(messages.sentAt),
      today:
        sql`count(*) filter (where ${instant} >= ${dayStart.toISOString()}::timestamptz and ${instant} < ${dayEnd.toISOString()}::timestamptz)`.mapWith(
          Number,
        ),
    })
    .from(messages)
    .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(
      and(
        eq(enrollments.sender, enrollment.sender),
        inArray(messages.state, ["sent", ...IN_FLIGHT]),
        ne(messages.id, message.id),
      ),
    );
  const last = (row?.last ?? null) as Date | null;
  const today = row?.today ?? 0;
  if (last !== null && ctx.now < ctx.policy.earliestNextSend(last, today)) {
    ctx.stats.gap_waiting += 1;
    return false;
  }
  if (today >= ctx.policy.perInboxCap(ctx.now)) {
    ctx.stats.senders_capped += 1;
    return false;
  }
  return true;
}

/** The calendar asked at most once a pass, and only when an email needs times. */
function onceOpenTimes(calendar: Calendar | null, now: Date): () => Promise<Date[] | null> {
  let asked: Promise<Date[] | null> | null = null;
  return () => {
    asked ??= calendar
      ? calendar.open(now, new Date(now.getTime() + LOOKAHEAD_MS)).catch(() => null)
      : Promise.resolve(null);
    return asked;
  };
}

async function companyZone(db: Queryable, companyId: number): Promise<string | null> {
  const [row] = await db
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  return row?.timezone ?? null;
}

/** This sender's rich sign-off with its `{page}` slot filled for the message's niche. */
function signatureFor(
  signatureHtml: StringMap | null,
  sender: string,
  pages: StringMap | null,
  niche: string,
): string | null {
  const html = signatureHtml?.[sender];
  if (html === undefined) return null;
  return fillPage(html, pages?.[niche] ?? "");
}

type Intent =
  | { kind: "raced" }
  | { kind: "paced" }
  | { kind: "ready"; enrollment: Enrollment; messages: Message[]; message: Message };

/**
 * Commit the intent, hand the message to the transport, record what came
 * back. The fresh locked re-read is the double-send guard: anything but
 * APPROVED/ACTIVE means somebody else got there first, and this walk touches
 * nothing. The DB CHECK `message_id_before_send` refuses a reordering.
 */
async function sendOne(
  db: Db,
  candidate: Candidate,
  ctx: SendContext,
): Promise<{ delivered: boolean; messages: Message[] }> {
  // The calendar and the lead's zone are read before the lock: no network inside it.
  const asksTimes = candidate.message.body.includes(CALL_TIMES);
  const open = asksTimes ? await ctx.openTimes() : null;
  const zone = asksTimes ? await companyZone(db, candidate.enrollment.companyId) : null;
  const intent: Intent = await db.transaction(async (tx) => {
    const [freshMessage] = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, candidate.message.id))
      .for("update", { skipLocked: true });
    if (freshMessage === undefined) return { kind: "raced" };
    const [freshEnrollment] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, candidate.enrollment.id))
      .for("update", { skipLocked: true });
    if (freshEnrollment === undefined) return { kind: "raced" };
    if (freshMessage.state !== "approved" || freshEnrollment.state !== "active") {
      return { kind: "raced" };
    }
    if (!(await pacedUnderLock(tx, freshEnrollment, freshMessage, ctx))) return { kind: "paced" };

    const sender = freshEnrollment.sender;
    const messageId = `<${randomUUID().replaceAll("-", "")}@${sender.slice(sender.lastIndexOf("@") + 1)}>`;
    // The row keeps the words that went out, times said, and the times it offered.
    const timed = fillCallTimes(freshMessage.body, open, zone, ctx.now);
    const [sending] = await tx
      .update(messages)
      .set({
        ...(timed.body === freshMessage.body
          ? {}
          : {
              body: timed.body,
              offeredTimes: timed.offered.length ? timed.offered.map((t) => t.toISOString()) : null,
            }),
        messageId,
        state: transitionMessage(freshMessage.state, "sending"),
        attemptedAt: ctx.now,
        transport: ctx.transport.name,
        sentRunId: ctx.runId,
      })
      .where(eq(messages.id, freshMessage.id))
      .returning();
    if (sending === undefined) throw new Error(`message ${freshMessage.id} vanished under lock`);
    const fresh = (await messagesOf(tx, freshEnrollment.id)).map((m) =>
      m.id === sending.id ? sending : m,
    );
    return { kind: "ready", enrollment: freshEnrollment, messages: fresh, message: sending };
  });
  if (intent.kind === "raced") {
    ctx.stats.raced += 1;
    return { delivered: false, messages: candidate.messages };
  }
  if (intent.kind === "paced") return { delivered: false, messages: candidate.messages };

  const { enrollment, message } = intent;
  const sender = enrollment.sender;
  // Only a subjectless step rides the thread. A step with its own subject starts a fresh
  // one (no Re:, no In-Reply-To); replies still match on its own Message-ID.
  const rides = candidate.anchor !== null && message.subject === null;
  const anchor = rides ? lastSent(intent.messages) : null;
  if (message.messageId === null) throw new Error("intent row has no Message-ID");
  const outgoing: OutgoingEmail = {
    fromAddress: sender,
    fromName: ctx.fromNames?.[sender] ?? null,
    to: message.toEmail,
    subject: message.subject,
    replySubject: anchor !== null ? replySubject(intent.messages) : null,
    body: message.body,
    messageId: message.messageId,
    inReplyTo: anchor?.messageId ?? null,
    references: rides
      ? intent.messages
          .filter((m) => m.state === "sent" && m.messageId)
          .map((m) => m.messageId as string)
      : [],
    threadId: anchor?.threadId ?? null,
    signatureHtml: signatureFor(ctx.signatureHtml, sender, ctx.pages, enrollment.niche),
    // A pixel exists only where compose minted a token AND a host is configured.
    pixelUrl: buildPixelUrl(ctx.pixelBaseUrl, message.openToken),
    linkCode: message.linkCode,
  };

  const outcome = await attempt(ctx, outgoing, message, sender);
  const [final] = await db
    .update(messages)
    .set(outcome.patch)
    .where(eq(messages.id, message.id))
    .returning();
  const updated = final ?? { ...message, ...outcome.patch };
  return {
    delivered: outcome.delivered,
    messages: intent.messages.map((m) => (m.id === updated.id ? updated : m)),
  };
}

/** Hand the bytes to the transport and classify what came back (never throws). */
async function attempt(
  ctx: SendContext,
  outgoing: OutgoingEmail,
  message: Message,
  sender: string,
): Promise<{ patch: Partial<Message>; delivered: boolean }> {
  let receipt: SendReceipt;
  try {
    receipt = await ctx.transport.send(outgoing);
  } catch (err) {
    if (err instanceof TransportRefused) {
      ctx.stats.failed += 1;
      if (err.senderLevel) {
        ctx.sidelined.add(sender);
        ctx.stats.sender_errors += 1;
      }
      return {
        patch: { state: transitionMessage(message.state, "failed"), detail: err.message },
        delivered: false,
      };
    }
    if (err instanceof TransportAmbiguous) {
      ctx.stats.ambiguous += 1;
      return {
        patch: { state: transitionMessage(message.state, "unknown"), detail: err.message },
        delivered: false,
      };
    }
    // A bug in the transport is still ambiguity: the exception may have been
    // raised after the request left the socket.
    const name = err instanceof Error ? err.constructor.name : typeof err;
    const text = err instanceof Error ? err.message : String(err);
    ctx.stats.ambiguous += 1;
    return {
      patch: {
        state: transitionMessage(message.state, "unknown"),
        detail: `unexpected ${name}: ${text}`,
      },
      delivered: false,
    };
  }
  ctx.stats.sent += 1;
  return {
    patch: {
      state: transitionMessage(message.state, "sent"),
      sentAt: ctx.now,
      gmailId: receipt.providerId,
      threadId: receipt.threadId,
    },
    delivered: true,
  };
}

// --- stops --------------------------------------------------------------

/**
 * Stop one ACTIVE enrollment: every unsent step (draft, approved, or wedged
 * failed) becomes SKIPPED so nothing can send later. Returns the number of
 * steps skipped. Illegal on a finished/stopped enrollment.
 *
 * A SENDING or UNKNOWN step is deliberately NOT skipped: that mail may already
 * be on its way, and the enrollment being STOPPED means the walk never touches
 * it again either way.
 *
 * opt_out/complaint/bounce also get-or-create a Suppression for the
 * enrollment's to_email — the row compose/send actually gate on — with the
 * enrollment id, stop reason and detail as the event's evidence.
 */
export async function recordStop(
  db: Queryable,
  enrollment: Enrollment,
  reason: StopReason,
  opts: { detail?: string | null; now?: Date; messages?: Message[] } = {},
): Promise<number> {
  const detail = opts.detail ?? null;
  await db
    .update(enrollments)
    .set({
      state: transitionEnrollment(enrollment.state, "stopped"),
      stopReason: reason,
      stoppedAt: opts.now ?? new Date(),
    })
    .where(eq(enrollments.id, enrollment.id));
  const msgs = opts.messages ?? (await messagesOf(db, enrollment.id));
  let skipped = 0;
  for (const message of msgs) {
    if (!isLive(message.state)) continue;
    message.state = transitionMessage(message.state, "skipped");
    message.detail = detail ?? `enrollment stopped: ${reason}`;
    await db
      .update(messages)
      .set({ state: message.state, detail: message.detail })
      .where(eq(messages.id, message.id));
    skipped += 1;
  }
  const first = msgs[0];
  if (first !== undefined) {
    await ensureSuppression(db, first.toEmail, reason, {
      enrollment_id: enrollment.id,
      stop_reason: reason,
      detail,
    });
  }
  return skipped;
}

/**
 * Company-scoped stop: a reply from anyone at the firm stops every active
 * enrollment into it. Returns enrollments stopped. Filters on
 * `enrollments.company_id`, pinned at compose — never through `people`.
 */
export async function stopCompany(
  db: Queryable,
  opts: { companyId: number; reason: StopReason; detail?: string | null; now?: Date },
): Promise<number> {
  const rows = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.companyId, opts.companyId), eq(enrollments.state, "active")))
    .orderBy(asc(enrollments.id));
  for (const enrollment of rows) {
    await recordStop(db, enrollment, opts.reason, {
      detail: opts.detail ?? null,
      ...(opts.now ? { now: opts.now } : {}),
    });
  }
  return rows.length;
}
