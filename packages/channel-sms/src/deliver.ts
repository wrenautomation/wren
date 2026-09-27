/**
 * The send tick: due messages out, at most one per number per tick, inside
 * the lead's window, under every cap. Intent before act: a message is marked
 * `sending` in its own write before the provider is called, so a crash leaves
 * a `sending` row, which `reconcile` turns into `unknown` and nothing ever
 * resends. Texting a stranger twice is worse than missing one.
 *
 * After a sequence step is sent, the next step is queued `afterDays` later;
 * after the last, the contact is `finished`. The live gate: with a real
 * provider nothing leaves unless `live` is set (the registered campaign is
 * approved); the fake provider always sends, for tests and dry runs.
 */
import { activeSuppressionOf, addSuppression, companies, people } from "@wren/core";
import type { Db, Queryable } from "@wren/db";
import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { inWindow, type SmsPolicy } from "./policy.js";
import { numberReady, poolToday } from "./pool.js";
import type { SmsProvider } from "./provider.js";
import { SmsRefusal } from "./refusal.js";
import {
  type SmsContact,
  type SmsMessage,
  smsContacts,
  smsMessages,
  smsNumbers,
} from "./schema.js";
import { firstName, render, type SmsSequence, segments } from "./templates.js";

/** A `sending` row older than this lost its provider call to a crash. */
export const STALE_SENDING_MS = 10 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
/** Most due rows read per tick; enough to fill every number past a few out-of-window leads. */
const SCAN = 200;

export interface TickOptions {
  provider: SmsProvider;
  policy: SmsPolicy;
  live: boolean;
  sequences: ReadonlyMap<string, SmsSequence>;
  senderName: string;
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
  /** Due but not sent because the live gate is shut. */
  gated: number;
  /** Due but every number was capped, paused or inside its gap. */
  noCapacity: number;
  reconciled: number;
  remainingToday: number;
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

async function endContact(
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

/** Queue the step after `sent`, or finish the contact after the last step. */
async function queueNext(
  db: Queryable,
  msg: SmsMessage,
  contact: SmsContact,
  opts: TickOptions,
): Promise<void> {
  if (msg.kind !== "sequence" || msg.step === null) return;
  const seq = contact.sequence ? opts.sequences.get(contact.sequence) : undefined;
  const next = seq?.steps.find((s) => s.step === (msg.step as number) + 1);
  if (!seq || !next) {
    await db
      .update(smsContacts)
      .set({ state: "finished", stateReason: "every step sent", endedAt: opts.now })
      .where(and(eq(smsContacts.id, contact.id), eq(smsContacts.state, "enrolled")));
    return;
  }
  const [company] = contact.companyId
    ? await db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, contact.companyId))
    : [];
  const [person] = contact.personId
    ? await db.select({ name: people.fullName }).from(people).where(eq(people.id, contact.personId))
    : [];
  await db
    .insert(smsMessages)
    .values({
      contactId: contact.id,
      direction: "out",
      kind: "sequence",
      step: next.step,
      template: `${seq.name}#${next.step}`,
      numberId: contact.numberId,
      toE164: contact.e164,
      body: render(next.body, {
        first_name: firstName(person?.name),
        company: company?.name ?? null,
        sender: opts.senderName,
      }),
      state: "queued",
      dueAt: new Date(opts.now.getTime() + next.afterDays * 86_400_000),
      runId: opts.runId ?? null,
    })
    .onConflictDoNothing();
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
    gated: 0,
    noCapacity: 0,
    reconciled: await reconcile(db, now),
    remainingToday: 0,
  };
  const pool = await poolToday(db, policy, now);
  let remaining = pool.remaining;
  const ready = new Map(
    pool.numbers.filter((n) => numberReady(n, now, policy)).map((n) => [n.number.id, n]),
  );
  const due = await db
    .select({
      msg: smsMessages,
      contact: smsContacts,
      zone: companies.timezone,
      from: smsNumbers.e164,
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
    // Operator replies first (a person is waiting), then oldest due.
    .orderBy(
      sql`CASE WHEN ${smsMessages.kind} = 'manual' THEN 0 ELSE 1 END`,
      asc(smsMessages.dueAt),
      asc(smsMessages.id),
    )
    .limit(SCAN);
  stats.due = due.length;
  const live = opts.live || opts.provider.name === "fake";
  for (const { msg, contact, zone, from } of due) {
    if (msg.kind === "sequence" && contact.state !== "enrolled") {
      await skipQueued(db, contact.id, `contact ${contact.state}`);
      stats.skipped += 1;
      continue;
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
    // Quiet hours hold for every cold step. An operator's reply to someone who
    // texted us in the last day is a conversation, not a solicitation: it goes now.
    if (
      !inWindow(zone, now, policy) &&
      !(msg.kind === "manual" && (await wroteRecently(db, contact.id, now)))
    ) {
      stats.outOfWindow += 1;
      continue;
    }
    // A manual reply is part of a conversation, not cold volume: it does not wait on the ramp.
    const n = msg.numberId ? ready.get(msg.numberId) : undefined;
    if (msg.kind !== "manual" && (!n || remaining <= 0)) {
      stats.noCapacity += 1;
      continue;
    }
    if (!live) {
      stats.gated += 1;
      continue;
    }
    const claimed = await db
      .update(smsMessages)
      .set({ state: "sending", attemptedAt: now, fromE164: from })
      .where(and(eq(smsMessages.id, msg.id), eq(smsMessages.state, "queued")))
      .returning({ id: smsMessages.id });
    if (claimed.length === 0) continue;
    if (msg.numberId) ready.delete(msg.numberId);
    if (msg.kind !== "manual") remaining -= 1;
    let result: Awaited<ReturnType<SmsProvider["send"]>>;
    try {
      result = await opts.provider.send({ from, to: contact.e164, text: msg.body });
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
          parts: result.parts ?? segments(msg.body).parts,
          costUsd: result.costUsd,
        })
        .where(eq(smsMessages.id, msg.id));
      await queueNext(db, msg, contact, opts);
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
      }
    }
  }
  stats.remainingToday = remaining;
  return stats;
}

/** Queue an operator's text on a contact's thread, from its sticky number. Sent by the next tick. */
export async function queueManual(
  db: Queryable,
  input: { contactId: number; body: string; now: Date },
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
  const [row] = await db
    .insert(smsMessages)
    .values({
      contactId: contact.id,
      direction: "out",
      kind: "manual",
      numberId: contact.numberId,
      toE164: contact.e164,
      body,
      state: "queued",
      dueAt: input.now,
    })
    .returning();
  return row as SmsMessage;
}
