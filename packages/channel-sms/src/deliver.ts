/**
 * The send tick: due messages out, at most one per number per tick, inside
 * the lead's window, under every cap. Intent before act: a message is marked
 * `sending` in its own write before the provider is called, so a crash leaves
 * a `sending` row, which `reconcile` turns into `unknown` and nothing ever
 * resends. Texting a stranger twice is worse than missing one.
 *
 * A sent sequence step is listed in `stepped`: the sender hands it to the spine,
 * whose wire waits `afterDays` and queues the next (follow.ts). After the last,
 * the contact is `finished`. The live gate: with a real
 * provider nothing leaves unless `live` is set (the registered campaign is
 * approved); the fake provider always sends, for tests and dry runs; with no
 * provider every due text is held as gated. A text whose number cannot reach
 * its phone yet (a US number before the carriers attach it) waits, counted.
 *
 * A reminder (reminders.ts) is checked against the person's clock when it is
 * queued, so the tick sends it without the window or the ramp. One the cap or
 * an emptied template stops is dropped, as is one still waiting after
 * REMINDER_FRESH_MS: a reminder is never sent late.
 */
import { activeSuppressionOf, addSuppression, companies } from "@wren/core";
import {
  campaignOfRef,
  capCheck,
  countMarketingSend,
  readMessageSettings,
  tagLinks,
} from "@wren/core/message-settings";
import type { Db, Queryable } from "@wren/db";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { ASKED, inWindow, policyFor, type SmsPolicy } from "./policy.js";
import { cannotReach, numberReady, poolToday, wrongCountry } from "./pool.js";
import type { SmsProvider } from "./provider.js";
import { SmsRefusal } from "./refusal.js";
import {
  ANSWER_KINDS,
  CONSENTED_KINDS,
  type MessageState,
  type SmsContact,
  type SmsMessage,
  smsContacts,
  smsMessages,
  smsNumbers,
  speedRuns,
} from "./schema.js";
import { fieldsFor, liveTexts } from "./template-store.js";
import { render, type SmsSequence, segments, textSeed } from "./templates.js";

/** A `sending` row older than this lost its provider call to a crash. */
export const STALE_SENDING_MS = 10 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
/** Most due rows read per tick; enough to fill every number past a few out-of-window leads. */
const SCAN = 200;
/** A reminder unsent this long after it was queued is dropped (reminders.ts queues it early enough). */
export const REMINDER_FRESH_MS = 60 * 60 * 1000;

export interface TickOptions {
  provider: SmsProvider;
  policy: SmsPolicy;
  live: boolean;
  sequences: ReadonlyMap<string, SmsSequence>;
  senderName: string;
  /** `{booking_link}` in the copy; null = none set. */
  bookingLink?: string | null;
  /**
   * Whose texts these are, for the `utm_source` on their links (the workspace's switch decides
   * whether any are added). Null or left out: links go as written.
   */
  linkSource?: string | null;
  now: Date;
  runId?: string | null;
}

export interface TickStats {
  due: number;
  sent: number;
  failed: number;
  retried: number;
  unknown: number;
  skipped: number;
  outOfWindow: number;
  /** Due but the phone already got its texts for the month: moved to when it has room. */
  capped: number;
  /** Due but not sent because the live gate is shut. */
  gated: number;
  /** Due but every number was capped, paused or inside its gap. */
  noCapacity: number;
  /** Due but its number cannot text that phone yet (US numbers wait on the 10DLC campaign). */
  unreachable: number;
  reconciled: number;
  remainingToday: number;
  /** Numbers in the pool that are active (not paused or retired). 0 = the loop sleeps long. */
  activeNumbers: number;
  /** Sequence steps sent this tick, each leaving its cadence node on the spine. */
  stepped: Array<{ contactId: number; sequence: string; step: number }>;
  /** The soonest text still queued for later (ISO), or null: the loop sleeps until then. */
  nextDue: string | null;
}

/** `sending` rows past the stale mark → `unknown`. Never resent. */
export async function reconcile(db: Queryable, now: Date): Promise<number> {
  const rows = await db
    .update(smsMessages)
    .set({ state: "unknown", detail: "provider call lost (crash or timeout); never resent" })
    .where(
      and(
        eq(smsMessages.state, "sending"),
        lt(smsMessages.attemptedAt, new Date(now.getTime() - STALE_SENDING_MS)),
      ),
    )
    .returning({ id: smsMessages.id });
  return rows.length;
}

/** Contact states a queued follow-up text never goes to. */
const FOLLOW_ENDS = new Set(["replied", "opted_out", "unreachable", "stopped"]);
/** Contact states an answer (a text back, a review ask) skips: they may have replied before. */
const ANSWER_ENDS = new Set(["opted_out", "unreachable", "stopped"]);

/**
 * Whether a text counts toward the workspace's per-person cap: a Follow-up or Nurture touch, a
 * broadcast, or a sequence step after the opener to someone who asked to be texted. Cold steps keep their own
 * policy, and answers (a text back, a review ask, a pay link), reminders and an operator's own
 * texts are not marketing.
 */
export const isMarketingText = (
  msg: Pick<SmsMessage, "kind" | "step">,
  contact: Pick<SmsContact, "sourceKind">,
) =>
  msg.kind === "follow_up" ||
  CONSENTED_KINDS.has(msg.kind) ||
  (msg.kind === "sequence" && ASKED.has(contact.sourceKind) && (msg.step ?? 1) > 1);

/** Queued sequence messages of a contact → `skipped`, when its thread ends. */
export async function skipQueued(db: Queryable, contactId: number, why: string): Promise<number> {
  const rows = await db
    .update(smsMessages)
    .set({ state: "skipped", detail: why })
    .where(
      and(
        eq(smsMessages.contactId, contactId),
        eq(smsMessages.state, "queued"),
        eq(smsMessages.kind, "sequence"),
      ),
    )
    .returning({ id: smsMessages.id });
  return rows.length;
}

export async function endContact(
  db: Queryable,
  contactId: number,
  state: SmsContact["state"],
  reason: string,
  now: Date,
) {
  await db
    .update(smsContacts)
    .set({ state, stateReason: reason, endedAt: now })
    .where(eq(smsContacts.id, contactId));
  await skipQueued(db, contactId, `contact ${state}: ${reason}`);
}

/** Contacts a speed run follows: a door lead (`hook`), a site applicant (`form`). */
const RUN_KINDS: ReadonlySet<string> = new Set(["hook", "form"]);

/** The carrier refused a lead's first text: its run says so, in the words it came with. */
async function refusedRun(db: Queryable, contact: SmsContact, detail: string) {
  if (!RUN_KINDS.has(contact.sourceKind)) return;
  await db
    .update(speedRuns)
    .set({ firstTouch: "refused", firstTouchDetail: `Telnyx refused the text: ${detail}` })
    .where(and(eq(speedRuns.smsContactId, contact.id), eq(speedRuns.firstTouch, "queued")));
}

/** A sequence step went: list it for the spine, and finish the contact after the last. */
async function stepped(
  db: Queryable,
  msg: SmsMessage,
  contact: SmsContact,
  opts: TickOptions,
  stats: TickStats,
) {
  if (msg.kind !== "sequence" || msg.step === null || !contact.sequence) return;
  const step = msg.step;
  // A door lead's or a site applicant's first text left: its speed run's first touch, the
  // metric (speed.ts, form.ts).
  if (step === 1 && RUN_KINDS.has(contact.sourceKind))
    await db
      .update(speedRuns)
      .set({ firstTouch: "sent", firstTouchAt: opts.now })
      .where(and(eq(speedRuns.smsContactId, contact.id), eq(speedRuns.firstTouch, "queued")));
  stats.stepped.push({ contactId: contact.id, sequence: contact.sequence, step });
  if (opts.sequences.get(contact.sequence)?.steps.some((s) => s.step > step)) return;
  await db
    .update(smsContacts)
    .set({ state: "finished", stateReason: "every step sent", endedAt: opts.now })
    .where(and(eq(smsContacts.id, contact.id), eq(smsContacts.state, "enrolled")));
}

// Any calendar month fits inside 31 days, so a cap over every 31 days holds every month too.
const MONTH_MS = 31 * 86_400_000;
const REACHED: MessageState[] = ["sending", "sent", "delivered", "unknown"];

/** Texts that left for `e164` in the last 31 days, under any contact row: what the monthly cap counts. */
export async function textedThisMonth(db: Queryable, e164: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(smsMessages)
    .where(
      and(
        inArray(
          smsMessages.contactId,
          db.select({ id: smsContacts.id }).from(smsContacts).where(eq(smsContacts.e164, e164)),
        ),
        eq(smsMessages.direction, "out"),
        inArray(smsMessages.state, REACHED),
        gte(smsMessages.attemptedAt, new Date(now.getTime() - MONTH_MS)),
      ),
    );
  return row?.n ?? 0;
}

/** When `e164` may get its next text under the monthly cap; null = now. Counts every text that left, under any contact row. */
export async function monthlyRoomAt(
  db: Queryable,
  e164: string,
  policy: Pick<SmsPolicy, "monthlyPerContact">,
  now: Date,
): Promise<Date | null> {
  const recent = await db
    .select({ at: smsMessages.attemptedAt })
    .from(smsMessages)
    .where(
      and(
        inArray(
          smsMessages.contactId,
          db.select({ id: smsContacts.id }).from(smsContacts).where(eq(smsContacts.e164, e164)),
        ),
        eq(smsMessages.direction, "out"),
        inArray(smsMessages.state, REACHED),
        gte(smsMessages.attemptedAt, new Date(now.getTime() - MONTH_MS)),
      ),
    )
    .orderBy(desc(smsMessages.attemptedAt))
    .limit(policy.monthlyPerContact);
  const oldest = recent.at(-1)?.at;
  if (recent.length < policy.monthlyPerContact || !oldest) return null;
  return new Date(oldest.getTime() + MONTH_MS);
}

async function wroteRecently(db: Queryable, contactId: number, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: smsMessages.id })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.contactId, contactId),
        eq(smsMessages.direction, "in"),
        gte(smsMessages.receivedAt, new Date(now.getTime() - 86_400_000)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * The tagged text, unless the tags would add a billed part: a text keeps its price, so then the
 * links go as written.
 */
function withinParts(plain: string, tagged: string): string {
  return segments(tagged).parts > segments(plain).parts ? plain : tagged;
}

export async function tick(db: Db, opts: TickOptions): Promise<TickStats> {
  const { now, policy } = opts;
  const stats: TickStats = {
    due: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    unknown: 0,
    skipped: 0,
    outOfWindow: 0,
    capped: 0,
    gated: 0,
    noCapacity: 0,
    unreachable: 0,
    reconciled: await reconcile(db, now),
    remainingToday: 0,
    activeNumbers: 0,
    stepped: [],
    nextDue: null,
  };
  const tagFor = opts.linkSource ? (await readMessageSettings(db)).utmLinks : false;
  const pool = await poolToday(db, policy, now);
  stats.activeNumbers = pool.numbers.filter((n) => n.number.state === "active").length;
  let remaining = pool.remaining;
  const ready = new Map(
    pool.numbers.filter((n) => numberReady(n, now, policy)).map((n) => [n.number.id, n]),
  );
  const due = await db
    .select({
      msg: smsMessages,
      contact: smsContacts,
      zone: sql<string | null>`coalesce(${smsContacts.zone}, ${companies.timezone})`,
      number: smsNumbers,
    })
    .from(smsMessages)
    .innerJoin(smsContacts, eq(smsContacts.id, smsMessages.contactId))
    .innerJoin(smsNumbers, eq(smsNumbers.id, smsMessages.numberId))
    .leftJoin(companies, eq(companies.id, smsContacts.companyId))
    .where(
      and(
        eq(smsMessages.state, "queued"),
        eq(smsMessages.direction, "out"),
        lte(smsMessages.dueAt, now),
      ),
    )
    // Operator replies and reminders first (a person is waiting), then oldest due.
    .orderBy(
      sql`CASE WHEN ${smsMessages.kind} IN ('manual', 'reminder') THEN 0 ELSE 1 END`,
      asc(smsMessages.dueAt),
      asc(smsMessages.id),
    )
    .limit(SCAN);
  stats.due = due.length;
  const live = opts.provider.name !== "none" && (opts.live || opts.provider.name === "fake");
  for (const { msg, contact, zone, number } of due) {
    const from = number.e164;
    if (msg.kind === "sequence" && contact.state !== "enrolled") {
      await skipQueued(db, contact.id, `contact ${contact.state}`);
      stats.skipped += 1;
      continue;
    }
    // A follow-up waits on no enrollment, but never goes to someone who answered or ended texts.
    if (msg.kind === "follow_up" && FOLLOW_ENDS.has(contact.state)) {
      await db
        .update(smsMessages)
        .set({ state: "skipped", detail: `contact ${contact.state}` })
        .where(eq(smsMessages.id, msg.id));
      stats.skipped += 1;
      continue;
    }
    // A text back, a review ask or a broadcast never goes to someone who ended texts.
    if (
      (ANSWER_KINDS.has(msg.kind) || CONSENTED_KINDS.has(msg.kind)) &&
      ANSWER_ENDS.has(contact.state)
    ) {
      await db
        .update(smsMessages)
        .set({ state: "skipped", detail: `contact ${contact.state}` })
        .where(eq(smsMessages.id, msg.id));
      stats.skipped += 1;
      continue;
    }
    if (msg.kind === "reminder") {
      const late = now.getTime() - (msg.dueAt ?? msg.createdAt).getTime() > REMINDER_FRESH_MS;
      const words = msg.template
        ? (await liveTexts(db, [msg.template])).get(msg.template)
        : undefined;
      const drop = late
        ? "too late: not sent within an hour of queuing"
        : words === undefined
          ? `template ${msg.template} was emptied`
          : (await monthlyRoomAt(db, contact.e164, policy, now))
            ? `${policy.monthlyPerContact} texts in the last 31 days already`
            : null;
      if (drop) {
        await db
          .update(smsMessages)
          .set({ state: "skipped", detail: drop })
          .where(eq(smsMessages.id, msg.id));
        stats.skipped += 1;
        continue;
      }
    }
    if (await activeSuppressionOf(db, "phone", contact.e164)) {
      await db
        .update(smsMessages)
        .set({ state: "skipped", detail: "phone suppressed" })
        .where(eq(smsMessages.id, msg.id));
      if (contact.state === "enrolled")
        await endContact(db, contact.id, "opted_out", "phone suppressed", now);
      stats.skipped += 1;
      continue;
    }
    if (cannotReach(number, contact.e164)) {
      stats.unreachable += 1;
      continue;
    }
    // Quiet hours hold for every cold step; someone who asked has a wider window. An operator's
    // reply to someone who texted us in the last day is a conversation, not a solicitation: it goes now.
    if (
      msg.kind !== "reminder" &&
      !inWindow(zone, now, policyFor(contact.sourceKind, policy, msg.kind, contact.basis)) &&
      !(msg.kind === "manual" && (await wroteRecently(db, contact.id, now)))
    ) {
      stats.outOfWindow += 1;
      continue;
    }
    const roomAt = await monthlyRoomAt(db, contact.e164, policy, now);
    if (roomAt) {
      await db.update(smsMessages).set({ dueAt: roomAt }).where(eq(smsMessages.id, msg.id));
      stats.capped += 1;
      continue;
    }
    // A manual reply, a reminder, or a text someone asked for answers the person, not cold
    // volume: it does not wait on the ramp.
    const cold = msg.kind === "sequence" && !ASKED.has(contact.sourceKind);
    const n = msg.numberId ? ready.get(msg.numberId) : undefined;
    if (cold && (!n || remaining <= 0)) {
      stats.noCapacity += 1;
      continue;
    }
    // A step goes out in the template's words as they are now: an edit reaches
    // texts already queued, and an emptied template sends nothing.
    let body = msg.body;
    let rendered: Partial<Pick<SmsMessage, "templateVersion" | "provenance">> = {};
    if (msg.kind === "sequence" && msg.template) {
      const words = (await liveTexts(db, [msg.template])).get(msg.template);
      if (words === undefined) {
        await endContact(db, contact.id, "finished", `template ${msg.template} is empty`, now);
        stats.skipped += 1;
        continue;
      }
      const text = render(
        words,
        await fieldsFor(db, contact, opts.senderName, opts.bookingLink ?? null),
        textSeed(contact.id),
      );
      body = tagFor
        ? withinParts(
            text.body,
            tagLinks(text.body, {
              source: opts.linkSource as string,
              medium: "sms",
              campaign: contact.sequence ?? msg.template,
            }),
          )
        : text.body;
      rendered = { templateVersion: text.provenance.version, provenance: text.provenance };
    } else if ((msg.kind === "follow_up" || CONSENTED_KINDS.has(msg.kind)) && tagFor) {
      // A follow-up or a broadcast is written when it is queued; its links are tagged as it goes.
      body = withinParts(
        msg.body,
        tagLinks(msg.body, {
          source: opts.linkSource as string,
          medium: "sms",
          campaign: campaignOfRef(msg.ref),
        }),
      );
    }
    if (!live) {
      stats.gated += 1;
      continue;
    }
    // The workspace's cap across email, texts and DMs: a marketing text waits until its person
    // has room (a held text keeps its place and goes on a later pass).
    let counted: string | null = null;
    if (isMarketingText(msg, contact)) {
      const cap = await capCheck(db, "sms", contact.e164, now);
      if (cap.until) {
        await db.update(smsMessages).set({ dueAt: cap.until }).where(eq(smsMessages.id, msg.id));
        stats.capped += 1;
        continue;
      }
      counted = cap.person;
    }
    const claimed = await db
      .update(smsMessages)
      .set({ state: "sending", attemptedAt: now, fromE164: from, body, ...rendered })
      .where(and(eq(smsMessages.id, msg.id), eq(smsMessages.state, "queued")))
      .returning({ id: smsMessages.id });
    if (claimed.length === 0) continue;
    if (msg.numberId) ready.delete(msg.numberId);
    if (cold) remaining -= 1;
    let result: Awaited<ReturnType<SmsProvider["send"]>>;
    try {
      result = await opts.provider.send({ from, to: contact.e164, text: body });
    } catch (err) {
      await db
        .update(smsMessages)
        .set({
          state: "unknown",
          detail:
            `provider call failed mid-flight: ${err instanceof Error ? err.message : String(err)}`.slice(
              0,
              500,
            ),
        })
        .where(eq(smsMessages.id, msg.id));
      stats.unknown += 1;
      continue;
    }
    if (result.ok) {
      await db
        .update(smsMessages)
        .set({
          state: "sent",
          providerId: result.providerId,
          sentAt: now,
          parts: result.parts ?? segments(body).parts,
          costUsd: result.costUsd,
          service: result.service ?? null,
        })
        .where(eq(smsMessages.id, msg.id));
      if (counted)
        await countMarketingSend(db, {
          personKey: counted,
          channel: "sms",
          campaign: campaignOfRef(msg.ref) ?? contact.sequence ?? msg.template,
          now,
        });
      await stepped(db, msg, contact, opts, stats);
      stats.sent += 1;
    } else if (result.retry) {
      await db
        .update(smsMessages)
        .set({
          state: "queued",
          attemptedAt: null,
          dueAt: new Date(now.getTime() + RETRY_AFTER_MS),
          detail: result.detail,
        })
        .where(eq(smsMessages.id, msg.id));
      stats.retried += 1;
    } else {
      await db
        .update(smsMessages)
        .set({ state: "failed", errorCode: result.code, detail: result.detail })
        .where(eq(smsMessages.id, msg.id));
      stats.failed += 1;
      if (result.optedOut) {
        await addSuppression(db, {
          kind: "phone",
          value: contact.e164,
          reason: "opt_out",
          evidence: { source: "carrier", code: result.code, sms_message_id: msg.id },
        });
        await endContact(db, contact.id, "opted_out", `carrier: ${result.detail}`, now);
      } else if (msg.kind === "sequence") {
        await endContact(db, contact.id, "unreachable", `refused: ${result.detail}`, now);
        if (msg.step === 1) await refusedRun(db, contact, result.detail);
      }
    }
  }
  stats.remainingToday = remaining;
  stats.nextDue = await nextDue(db, now);
  return stats;
}

/** The soonest outbound text queued after `now`, ISO, or null. */
async function nextDue(db: Queryable, now: Date): Promise<string | null> {
  const [row] = await db
    .select({ at: sql<Date | string | null>`min(${smsMessages.dueAt})` })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.state, "queued"),
        eq(smsMessages.direction, "out"),
        gt(smsMessages.dueAt, now),
      ),
    );
  return row?.at ? new Date(row.at).toISOString() : null;
}

/** Queue an operator's text on a contact's thread, from its sticky number. Sent by the next tick. */
export async function queueManual(
  db: Queryable,
  input: {
    contactId: number;
    body: string;
    now: Date;
    policy: Pick<SmsPolicy, "monthlyPerContact">;
    /**
     * `pay`: a pay link; `doc`: a document to sign. Neither skips quiet hours, as a reply to
     * someone who just wrote may.
     */
    kind?: "manual" | "pay" | "doc";
  },
): Promise<SmsMessage> {
  const body = input.body.trim();
  if (!body) throw new SmsRefusal("empty message");
  const [contact] = await db.select().from(smsContacts).where(eq(smsContacts.id, input.contactId));
  if (!contact) throw new SmsRefusal(`no sms contact ${input.contactId}`);
  if (!contact.numberId)
    throw new SmsRefusal(
      `contact ${input.contactId} has no number yet (enroll it, or it texts us first)`,
    );
  if (await activeSuppressionOf(db, "phone", contact.e164)) {
    throw new SmsRefusal(
      `${contact.e164} opted out; it is never texted again unless they text START`,
    );
  }
  const roomAt = await monthlyRoomAt(db, contact.e164, input.policy, input.now);
  if (roomAt) {
    throw new SmsRefusal(
      `${contact.e164} already got ${input.policy.monthlyPerContact} texts in the last 31 days, the most the consent allows; the next can go ${roomAt.toISOString().slice(0, 10)}`,
    );
  }
  // Another country is never; an unregistered US number queues and waits for the carriers.
  const [number] = await db.select().from(smsNumbers).where(eq(smsNumbers.id, contact.numberId));
  if (number && wrongCountry(number, contact.e164))
    throw new SmsRefusal(cannotReach(number, contact.e164) as string);
  const [row] = await db
    .insert(smsMessages)
    .values({
      contactId: contact.id,
      direction: "out",
      kind: input.kind ?? "manual",
      numberId: contact.numberId,
      toE164: contact.e164,
      body,
      state: "queued",
      dueAt: input.now,
    })
    .returning();
  return row as SmsMessage;
}
