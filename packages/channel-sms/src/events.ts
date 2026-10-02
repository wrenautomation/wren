/**
 * Webhooks in: delivery receipts and inbound texts. Idempotent by the
 * provider's event id (`sms_events`), so a webhook delivered twice, or
 * replayed by Restate, applies once.
 *
 * Inbound rules, in order, all deterministic:
 * 1. STOP words (the carrier set) or a plain "stop texting me" → a `phone`
 *    suppression, the contact `opted_out`, queued steps skipped. Honored
 *    forever, on every channel.
 * 2. START/UNSTOP → the suppression lifted. The thread does not restart. A
 *    bare YES counts as START only from an opted-out phone (it is a registered
 *    opt-in word); from anyone else it is a reply.
 * 3. Anything else from a lead → `replied`: its sequence stops, the operator is
 *    told. The LLM classifier labels it later; it never suppresses on its own
 *    say (a grounded `opt_out` label does, see classify.ts).
 * A stranger who texts one of our numbers gets a contact row (basis `opt_in`,
 * they wrote first) so the thread shows in the inbox.
 */
import { activeSuppressionsOf, addSuppression, liftSuppression } from "@wren/core";
import type { Notifier } from "@wren/core/notify";
import type { Db, Queryable } from "@wren/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { skipQueued } from "./deliver.js";
import { formatPhone } from "./phone.js";
import { numberByE164 } from "./pool.js";
import type { SmsEvent } from "./provider.js";
import { type PushAlert, type Pusher, pushAll } from "./push.js";
import {
  type Disposition,
  type SmsContact,
  smsContacts,
  smsEvents,
  smsMessages,
} from "./schema.js";

/** The CTIA opt-out words carriers honor, matched on the whole message. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "stop",
  "stopall",
  "stop all",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "optout",
  "opt out",
  "revoke",
]);
const START_WORDS: ReadonlySet<string> = new Set(["start", "unstop", "subscribe"]);
// Plain-language revocation (FCC 2024: any reasonable means counts).
const REVOCATION =
  /\b(stop (texting|messaging|contacting)|don'?t (text|message|contact)|do not (text|message|contact)|remove me|take me off|lose (this|my) number|unsubscribe|wrong number)\b/i;

export type InboundClass = "stop" | "start" | "yes" | "reply";

export function classifyInbound(text: string): {
  kind: InboundClass;
  disposition: Disposition | null;
} {
  const folded = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (STOP_WORDS.has(folded)) return { kind: "stop", disposition: "opt_out" };
  if (START_WORDS.has(folded)) return { kind: "start", disposition: null };
  if (folded === "yes") return { kind: "yes", disposition: null };
  if (REVOCATION.test(text)) return { kind: "stop", disposition: "opt_out" };
  return { kind: "reply", disposition: null };
}

export interface ApplyOptions {
  provider: string;
  now: Date;
  notifier?: Notifier | null;
  /** Reply alerts on the phone app. */
  pusher?: Pusher | null;
}

export interface ApplyResult {
  duplicate: boolean;
  outcome: string;
}

const RANK: Record<string, number> = {
  queued: 0,
  sending: 1,
  unknown: 1,
  sent: 2,
  failed: 3,
  delivered: 3,
};

async function applyStatus(
  db: Queryable,
  e: Extract<SmsEvent, { kind: "status" }>,
  now: Date,
): Promise<string> {
  const [msg] = await db.select().from(smsMessages).where(eq(smsMessages.providerId, e.messageId));
  if (!msg) return `ignored: no message ${e.messageId}`;
  const target = e.status === "unconfirmed" ? "sent" : e.status;
  // Receipts arrive out of order; never walk a message backwards.
  if ((RANK[target] ?? 0) < (RANK[msg.state] ?? 0))
    return `kept ${msg.state} (late ${e.status}) #${msg.id}`;
  await db
    .update(smsMessages)
    .set({
      state: target,
      ...(target === "delivered" ? { deliveredAt: e.at } : {}),
      ...(target === "sent" && !msg.sentAt ? { sentAt: e.at } : {}),
      ...(e.parts !== null ? { parts: e.parts } : {}),
      ...(e.costUsd !== null ? { costUsd: e.costUsd } : {}),
      ...(e.code ? { errorCode: e.code } : {}),
      ...(e.detail ? { detail: e.detail } : {}),
    })
    .where(eq(smsMessages.id, msg.id));
  if (target === "failed" && msg.kind === "sequence") {
    await db
      .update(smsContacts)
      .set({
        state: "unreachable",
        stateReason: `delivery failed: ${e.code ?? ""} ${e.detail ?? ""}`.trim(),
        endedAt: now,
      })
      .where(and(eq(smsContacts.id, msg.contactId), eq(smsContacts.state, "enrolled")));
    await skipQueued(db, msg.contactId, "delivery failed");
  }
  return `${target} #${msg.id}`;
}

async function contactFor(
  db: Queryable,
  from: string,
  numberId: string | null,
  now: Date,
): Promise<SmsContact> {
  // The running or most recent thread with this phone; our number breaks ties.
  const rows = await db
    .select()
    .from(smsContacts)
    .where(eq(smsContacts.e164, from))
    .orderBy(
      sql`CASE WHEN ${smsContacts.state} = 'enrolled' THEN 0 WHEN ${smsContacts.numberId} = ${numberId} THEN 1 ELSE 2 END`,
      desc(smsContacts.enrolledAt),
      desc(smsContacts.id),
    )
    .limit(1);
  if (rows[0]) return rows[0];
  const [made] = await db
    .insert(smsContacts)
    .values({
      e164: from,
      sourceKind: "inbound",
      basis: "opt_in",
      basisDetail: "texted our number first",
      numberId,
      state: "replied",
      stateReason: "texted us first",
      endedAt: now,
    })
    .returning();
  return made as SmsContact;
}

/** The shape `ck_sms_contacts_e164` allows. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

async function applyInbound(
  db: Queryable,
  e: Extract<SmsEvent, { kind: "inbound" }>,
  opts: ApplyOptions,
): Promise<{ outcome: string; notify: string | null; alert: PushAlert | null }> {
  // A short code or alphanumeric sender (Google's sign-in codes) is no contact:
  // it cannot be texted back. The raw event row keeps it; the note and the
  // alert carry the text so a code is readable at once.
  if (!E164.test(e.from)) {
    const body = e.text.length > 160 ? `${e.text.slice(0, 159)}…` : e.text;
    return {
      outcome: `from ${e.from} (not a phone number): ${body}`,
      notify: `SMS from ${e.from} to ${formatPhone(e.to)}: ${body}`,
      alert: { title: `SMS from ${e.from}`, body, url: "/", tag: `sender-${e.from}` },
    };
  }
  const number = await numberByE164(db, e.to);
  const contact = await contactFor(db, e.from, number?.id ?? null, opts.now);
  const cls = classifyInbound(e.text);
  if (cls.kind === "yes") {
    const optedOut = (await activeSuppressionsOf(db, "phone", [e.from]))(e.from);
    cls.kind = optedOut ? "start" : "reply";
  }
  const inserted = await db
    .insert(smsMessages)
    .values({
      contactId: contact.id,
      direction: "in",
      kind: "inbound",
      numberId: number?.id ?? null,
      fromE164: e.from,
      toE164: e.to,
      body: e.text,
      state: "received",
      providerId: e.messageId,
      receivedAt: e.at,
      ...(cls.disposition
        ? { disposition: cls.disposition, dispositionSource: "rule" as const }
        : {}),
    })
    .onConflictDoNothing()
    .returning({ id: smsMessages.id });
  const msgId = inserted[0]?.id;
  if (msgId === undefined)
    return { outcome: `duplicate message ${e.messageId}`, notify: null, alert: null };
  if (!contact.numberId && number) {
    await db.update(smsContacts).set({ numberId: number.id }).where(eq(smsContacts.id, contact.id));
  }
  const who = formatPhone(e.from);
  const alert = (title: string): PushAlert => ({
    title,
    body: e.text.length > 160 ? `${e.text.slice(0, 159)}…` : e.text,
    url: `/#/thread/${contact.id}`,
    tag: `thread-${contact.id}`,
  });
  const name = contact.name ?? who;
  if (cls.kind === "stop") {
    await addSuppression(db, {
      kind: "phone",
      value: e.from,
      reason: "opt_out",
      evidence: { source: "sms", sms_message_id: msgId, provider_message_id: e.messageId },
    });
    await db
      .update(smsContacts)
      .set({ state: "opted_out", stateReason: "texted stop", endedAt: opts.now })
      .where(eq(smsContacts.e164, e.from));
    await skipQueued(db, contact.id, "opted out");
    // Operator messages queued to them die too.
    await db
      .update(smsMessages)
      .set({ state: "skipped", detail: "opted out" })
      .where(and(eq(smsMessages.contactId, contact.id), eq(smsMessages.state, "queued")));
    return {
      outcome: `stop: suppressed ${e.from} (#${msgId})`,
      notify: `SMS opt-out from ${who}`,
      alert: alert(`${name} opted out`),
    };
  }
  if (cls.kind === "start") {
    const lifted = await liftSuppression(db, {
      kind: "phone",
      value: e.from,
      evidence: { source: "sms", sms_message_id: msgId },
    });
    return {
      outcome: `start: ${lifted ? "lifted" : "nothing to lift"} (#${msgId})`,
      notify: null,
      alert: null,
    };
  }
  if (contact.state === "enrolled" || contact.state === "finished") {
    await db
      .update(smsContacts)
      .set({ state: "replied", stateReason: "they replied", endedAt: opts.now })
      .where(eq(smsContacts.id, contact.id));
    await skipQueued(db, contact.id, "they replied");
  }
  return { outcome: `reply #${msgId}`, notify: `SMS reply from ${who}`, alert: alert(name) };
}

/** Apply one webhook. The raw body is stored as received; `event` is it read into our words. */
export async function applyEvent(
  db: Db,
  raw: unknown,
  event: SmsEvent,
  opts: ApplyOptions,
): Promise<ApplyResult> {
  let notify: string | null = null;
  let alert: PushAlert | null = null;
  const result = await db.transaction(async (tx): Promise<ApplyResult> => {
    const claimed = await tx
      .insert(smsEvents)
      .values({
        provider: opts.provider,
        providerEventId: event.eventId,
        type: event.type,
        payload: raw as object,
      })
      .onConflictDoNothing()
      .returning({ id: smsEvents.id });
    const id = claimed[0]?.id;
    if (id === undefined) return { duplicate: true, outcome: "duplicate event" };
    let outcome: string;
    if (event.kind === "status") outcome = await applyStatus(tx, event, opts.now);
    else if (event.kind === "inbound") {
      const r = await applyInbound(tx, event, opts);
      outcome = r.outcome;
      notify = r.notify;
      alert = r.alert;
    } else outcome = `ignored: ${event.type}`;
    await tx.update(smsEvents).set({ outcome }).where(eq(smsEvents.id, id));
    return { duplicate: false, outcome };
  });
  if (notify && opts.notifier)
    await opts.notifier.notify(notify, "open the phone app to read and answer");
  // After the commit, and never thrown: the text is saved either way, and Discord still has it.
  if (alert && opts.pusher) {
    try {
      const pushed = await pushAll(db, opts.pusher, alert);
      for (const err of pushed.errors) console.warn(`sms push: ${err}`);
    } catch (err) {
      console.warn(`sms push: ${(err as Error).message}`);
    }
  }
  return result;
}
