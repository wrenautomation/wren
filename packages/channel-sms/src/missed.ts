/**
 * Missed-call text back (designs/2026-10-07-missed-call-and-reviews.md). A call to the client's
 * number that nobody picked up (missed, busy, voicemail) arrives on the spine once its template
 * is live. `textBack` texts the caller from the number they called, within a minute, in texting
 * hours on their clock (else the next morning), in the client's words: one for a new caller, one
 * for someone already in their texts.
 *
 * Skipped: a caller who opted out, one texted back inside the setting's hours, one in a running
 * thread. With `WREN_SMS_LIVE` off or the client's texts or sends off, the call records "would
 * send" and nothing is queued. A reply opens the thread like any text; `callReplied` marks it,
 * and the worker hands the caller to speed to lead when the client has it live.
 */
import { activeSuppressionOf } from "@wren/core";
import { linkPeople } from "@wren/core/leads";
import type { Step } from "@wren/core/spine";
import { liveOrDefault } from "@wren/core/templates/defaults";
import type { Db, Queryable } from "@wren/db";
import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { formatPhone, toPhoneE164 } from "./phone.js";
import {
  type AnswerState,
  type SmsCall,
  type SpeedRun,
  smsCalls,
  smsContacts,
  smsMessages,
  speedRuns,
} from "./schema.js";
import { fieldsFor, textRef } from "./template-store.js";
import { render, textSeed } from "./templates.js";

/** The text a caller gets who isn't in the client's texts yet. Must say STOP. */
export const MISSED_NEW = "missed-call-new";
/** The text a caller gets who is: it can use their name. */
export const MISSED_KNOWN = "missed-call-known";

/** One text back per caller in this many hours, unless the client's setting says otherwise. */
export const ONCE_EVERY_HOURS = 24;

/** What a text back runs on: the client's database, its gates and its words' facts. */
export interface TextBackOptions {
  /** `WREN_SMS_LIVE`, the client's texts and its sends all on. */
  live: boolean;
  /** Why not live ("WREN_SMS_LIVE is off"). */
  why: string | null;
  senderName: string;
  bookingLink: string | null;
  /** One text per caller in this many hours. */
  onceEvery: number;
  /** The business's time zone, for a new caller; null = both US coasts must be in hours. */
  zone: string | null;
  now: Date;
}

export interface TextBack {
  call: SmsCall;
  /** The caller's contact, once a text was queued; null otherwise. */
  contactId: number | null;
}

/** The message ref of a call's text back: one per call. */
export const callRef = (id: number) => `call:${id}`;

async function settle(
  db: Queryable,
  id: number,
  state: AnswerState,
  detail: string | null,
  now: Date,
  more: Partial<Pick<SmsCall, "contactId" | "known">> = {},
): Promise<SmsCall> {
  const [row] = await db
    .update(smsCalls)
    .set({ textBack: state, textBackDetail: detail, textBackAt: now, ...more })
    .where(and(eq(smsCalls.id, id), isNull(smsCalls.textBack)))
    .returning();
  if (row) return row;
  const [have] = await db.select().from(smsCalls).where(eq(smsCalls.id, id));
  return have as SmsCall;
}

/** The caller's newest thread: a running one first. */
async function threadOf(db: Queryable, e164: string) {
  const [row] = await db
    .select()
    .from(smsContacts)
    .where(eq(smsContacts.e164, e164))
    .orderBy(
      sql`CASE WHEN ${smsContacts.state} = 'enrolled' THEN 0 ELSE 1 END`,
      desc(smsContacts.id),
    )
    .limit(1);
  return row ?? null;
}

/** "3 h", "40 min": how long ago, said short. */
const ago = (from: Date, now: Date) => {
  const min = Math.max(1, Math.round((now.getTime() - from.getTime()) / 60_000));
  return min < 120 ? `${min} min` : `${Math.round(min / 60)} h`;
};

/**
 * Text back the caller of missed call `id`, once. Every way it doesn't go is kept on the call
 * (`text_back`, `text_back_detail`); a retry finds the first answer and changes nothing.
 */
export async function textBack(db: Db, id: number, o: TextBackOptions): Promise<TextBack> {
  const [call] = await db.select().from(smsCalls).where(eq(smsCalls.id, id));
  if (!call) throw new Error(`no call ${id}`);
  if (call.textBack !== null)
    return { call, contactId: call.textBack === "queued" ? call.contactId : null };
  const done = (state: AnswerState, why: string, more = {}) =>
    settle(db, id, state, why, o.now, more).then((c) => ({ call: c, contactId: null }));
  if (!call.result || call.result === "answered")
    return done("skipped", call.result ? "a person picked up" : "the call hasn't ended");
  const e164 = toPhoneE164(call.fromE164);
  if (!e164)
    return done(
      "refused",
      /^\+?\d{8,}$/.test(call.fromE164)
        ? "not a US or Canadian number"
        : "the caller's number is hidden",
    );
  if (await activeSuppressionOf(db, "phone", e164)) return done("refused", "the phone opted out");
  const [recent] = await db
    .select({ at: smsCalls.textBackAt })
    .from(smsCalls)
    .where(
      and(
        eq(smsCalls.fromE164, call.fromE164),
        ne(smsCalls.id, id),
        inArray(smsCalls.textBack, ["queued", "would_send"]),
        gt(smsCalls.textBackAt, new Date(o.now.getTime() - o.onceEvery * 3_600_000)),
      ),
    )
    .orderBy(desc(smsCalls.textBackAt))
    .limit(1);
  if (recent?.at) return done("skipped", `texted back ${ago(recent.at, o.now)} ago`);
  const thread = await threadOf(db, e164);
  const known = thread !== null;
  if (thread?.state === "enrolled")
    return done("skipped", "already in a running text thread", { contactId: thread.id, known });
  if (!o.live) return done("would_send", o.why ?? "texts are off", { known });
  const key = known ? MISSED_KNOWN : MISSED_NEW;
  const words = await liveOrDefault(db, textRef(key));
  if (!words) return done("refused", `template ${key} is empty`, { known });
  if (!call.numberId)
    return done(
      "refused",
      `${formatPhone(call.toE164)} isn't one of the client's texting numbers`,
      {
        known,
      },
    );
  let contact = thread;
  if (!contact) {
    const [made] = await db
      .insert(smsContacts)
      .values({
        e164,
        sourceKind: "call",
        sourceRef: String(call.id),
        basis: "opt_in",
        basisDetail: `called ${formatPhone(call.toE164)} at ${call.startedAt.toISOString()}`,
        numberId: call.numberId,
        zone: o.zone,
      })
      .onConflictDoNothing()
      .returning();
    contact = made ?? (await threadOf(db, e164));
    if (!contact) throw new Error(`no contact for call ${id}`);
    await linkPeople(db, "sms_contacts", [contact.id]);
  } else if (!contact.numberId) {
    await db
      .update(smsContacts)
      .set({ numberId: call.numberId })
      .where(eq(smsContacts.id, contact.id));
  }
  const text = render(
    words.template,
    await fieldsFor(db, contact, o.senderName, o.bookingLink),
    textSeed(contact.id),
  );
  await db
    .insert(smsMessages)
    .values({
      contactId: contact.id,
      direction: "out",
      kind: "text_back",
      template: key,
      templateVersion: text.provenance.version,
      provenance: text.provenance,
      ref: callRef(call.id),
      // The number they called: the text comes from it.
      numberId: call.numberId,
      toE164: e164,
      body: text.body,
      state: "queued",
      dueAt: o.now,
    })
    .onConflictDoNothing();
  const settled = await settle(db, id, "queued", null, o.now, { contactId: contact.id, known });
  return { call: settled, contactId: contact.id };
}

/**
 * A reply from a caller texted back in the last week: its call is marked replied, once. The
 * call, or null when the reply isn't to a text back.
 */
export async function callReplied(db: Queryable, contactId: number, now: Date) {
  // A caller who answered has replied: no follow-up texts them as if they hadn't.
  await db
    .update(smsContacts)
    .set({ state: "replied", stateReason: "they replied", endedAt: now })
    .where(
      and(
        eq(smsContacts.id, contactId),
        eq(smsContacts.state, "new"),
        eq(smsContacts.sourceKind, "call"),
      ),
    );
  const [call] = await db
    .update(smsCalls)
    .set({ repliedAt: now })
    .where(
      and(
        eq(smsCalls.contactId, contactId),
        eq(smsCalls.textBack, "queued"),
        isNull(smsCalls.repliedAt),
        gt(smsCalls.textBackAt, new Date(now.getTime() - 7 * 86_400_000)),
      ),
    )
    .returning();
  return call ?? null;
}

/**
 * A caller who answered the text back, as a speed-to-lead run: their first text was the text back,
 * so the run goes on from there (Call now for the rep, the follow-up). One run per call.
 */
export async function runOfCall(
  db: Queryable,
  workflow: string,
  call: SmsCall,
  now: Date,
): Promise<SpeedRun | null> {
  if (!call.contactId) return null;
  const [c] = await db.select().from(smsContacts).where(eq(smsContacts.id, call.contactId));
  if (!c) return null;
  const [sent] = await db
    .select({ at: smsMessages.sentAt })
    .from(smsMessages)
    .where(and(eq(smsMessages.contactId, c.id), eq(smsMessages.ref, callRef(call.id))));
  const subject = `call:${call.id}`;
  const [made] = await db
    .insert(speedRuns)
    .values({
      workflow,
      subject,
      leadAt: call.startedAt,
      name: c.name,
      phone: c.e164,
      e164: c.e164,
      email: c.email,
      source: "missed call",
      consent: true,
      consentDetail: "called, then answered our text",
      zone: c.zone,
      smsContactId: c.id,
      firstTouch: "sent",
      firstTouchAt: sent?.at ?? call.textBackAt ?? now,
      firstTouchDetail: "the missed-call text",
    })
    .onConflictDoNothing()
    .returning();
  if (made) return made;
  const [have] = await db
    .select()
    .from(speedRuns)
    .where(and(eq(speedRuns.workflow, workflow), eq(speedRuns.subject, subject)));
  return have ?? null;
}

/** A missed call as it enters its workflow: one arrival per call. */
export const missedCallEvent = (id: number) => ({
  subject: `call:missed:${id}`,
  kind: "call" as const,
  data: { call: id },
});

/** What the step needs for whoever's workflow it is. */
export type TextBackDeps = Omit<TextBackOptions, "now"> & {
  db: Db;
  /** Wake the sender, so the text leaves in seconds. The key makes a retry wake once. */
  nudge: (idempotencyKey: string) => Promise<void>;
};

/**
 * `sms.text_back` on the spine: `texted` carries the caller on as a text lead (`lead:sms:<id>`);
 * `untexted` (skipped, would send, refused) goes on with the call's subject.
 */
export const textBackStep =
  (depsFor: (client: string | null) => Promise<TextBackDeps>): Step =>
  async (_port, e, at) => {
    const id = Number(e.data.call);
    if (!Number.isInteger(id)) throw new Error(`${e.subject} is no call`);
    const { db, nudge, ...o } = await depsFor(at.client);
    const got = await textBack(db, id, { ...o, now: new Date() });
    const data = { ...e.data, textBack: got.call.textBack, why: got.call.textBackDetail };
    if (got.contactId === null)
      return [{ port: "untexted", event: { subject: e.subject, kind: "call", data } }];
    await nudge(`text-back:${at.workflow}:${id}`);
    return [
      {
        port: "texted",
        event: {
          subject: `lead:sms:${got.contactId}`,
          kind: "lead",
          data: { ...data, contactId: got.contactId },
        },
      },
    ];
  };
