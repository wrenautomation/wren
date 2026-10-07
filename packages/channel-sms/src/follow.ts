/**
 * Text follow-ups on the spine (designs/2026-10-05-workflows.md, Follow-ups). Each sequence is a
 * cadence workflow of `sms.touch` nodes. Enroll queues the opener. When the tick sends a step, it
 * leaves that step's node as `sent` and waits on the wire for the next touch, which queues the
 * next text due now, so the tick still meters every send. A reply answers `replied` instead.
 *
 * Someone who asked to be texted (a form, a client's door) is also let go when they book (asked
 * before each text) or another channel's sequence holds them: one active sequence per lead.
 */
import { type FollowNote, followStart, isFollowTouch, type Outs, passed } from "@wren/core/follow";
import { activeElsewhere } from "@wren/core/leads";
import { passOn, type SpineEvent, type Step, type StepAt } from "@wren/core/spine";
import { refText } from "@wren/core/templates";
import { liveOrDefault } from "@wren/core/templates/defaults";
import { sequenceLabel } from "@wren/core/templates/labels";
import { cadenceWorkflow, type Workflow } from "@wren/core/workflows";
import type { Db, Queryable } from "@wren/db";
import { and, eq, isNull } from "drizzle-orm";
import type { Bookings } from "./bookings.js";
import { TOUCH } from "./components.js";
import { endContact } from "./deliver.js";
import { ASKED } from "./policy.js";
import { smsCalls, smsContacts, smsMessages, speedRuns } from "./schema.js";
import { fieldsFor, liveTexts, textRef } from "./template-store.js";
import { render, type SmsSequence, stepKey, textSeed } from "./templates.js";

/** One text contact as a lead on the spine. */
export const textLead = (contactId: number): SpineEvent => ({
  subject: `lead:sms:${contactId}`,
  kind: "lead",
  data: { contactId },
});

/** A sequence as its cadence: step n is node `s<n>`, waiting its days after the one before. */
export function textCadence(seq: SmsSequence): Workflow {
  return cadenceWorkflow({
    name: seq.name,
    label: `Texts: ${sequenceLabel(seq.name)}`,
    blurb: `${seq.steps.length} ${seq.steps.length === 1 ? "text" : "texts"}, stopping when they answer.`,
    for: "wren",
    steps: seq.steps.map((s) => ({
      touch: TOUCH,
      template: textRef(stepKey(seq.name, s.step)),
      with: { step: s.step },
      ...(s.afterDays > 0 ? { after: `${s.afterDays} day${s.afterDays === 1 ? "" : "s"}` } : {}),
    })),
  });
}

export interface TouchOptions {
  sequences: ReadonlyMap<string, SmsSequence>;
  senderName: string;
  /** `{booking_link}` in the copy; null = none set. */
  bookingLink?: string | null;
  /** Asked before each text to someone who asked to be texted; null = no check. */
  bookings?: Bookings | null;
  now: Date;
}

/** Their speed run saw a booking (speed.ts): the page shows it, the call step skips. */
export async function bookedRun(db: Db, contactId: number, at: Date): Promise<void> {
  await db
    .update(speedRuns)
    .set({ bookedAt: at })
    .where(and(eq(speedRuns.smsContactId, contactId), isNull(speedRuns.bookedAt)));
  // A caller texted back who then booked: the missed call's booking.
  await db
    .update(smsCalls)
    .set({ bookedAt: at })
    .where(
      and(
        eq(smsCalls.contactId, contactId),
        eq(smsCalls.textBack, "queued"),
        isNull(smsCalls.bookedAt),
      ),
    );
}

/**
 * Queue step `step` of a contact's sequence, due now. A contact who replied answers "replied",
 * one who booked "booked"; any other end, or an emptied step, sends nothing. Queueing a step
 * twice is a no-op. A booking check that can't tell throws: a text to someone who booked is
 * the mistake it exists for, so the step is retried.
 */
export async function touch(
  db: Db,
  contactId: number,
  step: number,
  opts: TouchOptions,
): Promise<"queued" | "replied" | "booked" | "ended"> {
  const [c] = await db.select().from(smsContacts).where(eq(smsContacts.id, contactId));
  if (c?.state === "replied") return "replied";
  if (c?.state !== "enrolled") return "ended";
  if (ASKED.has(c.sourceKind)) {
    if (c.email && opts.bookings && (await opts.bookings.booked(c.email))) {
      await endContact(db, c.id, "finished", `booked a call on ${opts.bookings.name}`, opts.now);
      await bookedRun(db, c.id, opts.now);
      return "booked";
    }
    const busy = step > 1 ? await activeElsewhere(db, c, "text") : null;
    if (busy) {
      await endContact(db, c.id, "finished", busy, opts.now);
      return "ended";
    }
  }
  const seq = c.sequence ? opts.sequences.get(c.sequence) : undefined;
  const key = seq?.steps.some((s) => s.step === step) ? stepKey(seq.name, step) : null;
  const words = key ? (await liveTexts(db, [key])).get(key) : undefined;
  if (!key || words === undefined) {
    const why = key ? `template ${key} is empty` : `${c.sequence} has no step ${step}`;
    await endContact(db, c.id, "finished", why, opts.now);
    return "ended";
  }
  const text = render(
    words,
    await fieldsFor(db, c, opts.senderName, opts.bookingLink ?? null),
    textSeed(c.id),
  );
  await db
    .insert(smsMessages)
    .values({
      contactId: c.id,
      direction: "out",
      kind: "sequence",
      step,
      template: key,
      templateVersion: text.provenance.version,
      provenance: text.provenance,
      numberId: c.numberId,
      toE164: c.e164,
      body: text.body,
      state: "queued",
      dueAt: opts.now,
    })
    .onConflictDoNothing();
  return "queued";
}

/**
 * Whose texts a touch runs on: the database of whoever's workflow it is, and their copy's facts.
 * A follow-up touch also needs Wren's main database (`main`: clients, their send flags) and why
 * texts can't go now (`off`: the global gate, the client's texts), null when they can.
 */
export type TouchTexts = Omit<TouchOptions, "now"> & {
  db: Db;
  main?: Queryable;
  off?: string | null;
};

/** Contact states a follow-up never texts: they said stop, or the number can't take texts. */
const NEVER = new Set(["opted_out", "unreachable", "stopped"]);

/**
 * One follow-up text (designs/2026-10-07-follow-up-nurture.md): to someone who asked to be
 * texted, in the node's live words, queued due now as kind `follow_up` for the sender, which
 * keeps quiet hours, STOP and the monthly cap. One per contact and node, however often it runs.
 */
export async function followText(
  db: Db,
  contactId: number,
  at: Pick<StepAt, "workflow" | "node" | "template">,
  o: { senderName: string; bookingLink: string | null; would: string | null; now: Date },
): Promise<Pick<FollowNote, "did" | "why">> {
  const [c] = await db.select().from(smsContacts).where(eq(smsContacts.id, contactId));
  if (!c) return { did: "skipped", why: `no text contact ${contactId}` };
  if (!ASKED.has(c.sourceKind)) return { did: "skipped", why: "never asked to be texted" };
  if (NEVER.has(c.state)) return { did: "skipped", why: `their texts ended: ${c.state}` };
  if (!c.numberId) return { did: "skipped", why: "no number of ours on the thread" };
  if (!at.template) return { did: "skipped", why: "this step has no copy" };
  const live = await liveOrDefault(db, at.template);
  if (!live) return { did: "skipped", why: `${refText(at.template)} has no live words` };
  if (o.would) return { did: "would_send", why: o.would };
  const text = render(
    live.template,
    await fieldsFor(db, c, o.senderName, o.bookingLink),
    textSeed(c.id),
  );
  const ref = `${at.workflow}/${at.node}`.slice(0, 64);
  await db
    .insert(smsMessages)
    .values({
      contactId: c.id,
      direction: "out",
      kind: "follow_up",
      template: at.template.name,
      templateVersion: text.provenance.version,
      provenance: text.provenance,
      ref,
      numberId: c.numberId,
      toE164: c.e164,
      body: text.body,
      state: "queued",
      dueAt: o.now,
    })
    .onConflictDoNothing();
  return { did: "queued", why: null };
}

async function followTouch(texts: TouchTexts, e: SpineEvent, at: StepAt): Promise<Outs> {
  if (!texts.main) throw new Error("no main database for follow-up texts here");
  const start = await followStart(
    { db: texts.db, main: texts.main, channel: "text", globalOff: texts.off ?? null },
    e,
    at,
  );
  if ("outs" in start) return start.outs;
  const got = await followText(texts.db, start.thread, at, {
    senderName: texts.senderName,
    bookingLink: texts.bookingLink ?? null,
    would: start.would,
    now: new Date(),
  });
  return passed(e, { ...start.note, ...got });
}

/**
 * `sms.touch` on the spine: the node's `step`, on the texts of whoever's workflow it is. A node
 * with no `step` is a follow-up touch (`followTouch`).
 */
export const touchStep =
  (textsFor: (client: string | null) => TouchTexts | Promise<TouchTexts>): Step =>
  async (_port, e, at) => {
    if (isFollowTouch(at)) return followTouch(await textsFor(at.client), e, at);
    const other = passOn(e, "sms");
    if (other) return other;
    const contactId = Number(e.data.contactId);
    if (!Number.isInteger(contactId)) throw new Error(`${e.subject} is no text contact`);
    const { db, ...opts } = await textsFor(at.client);
    const got = await touch(db, contactId, Number(at.with.step), { ...opts, now: new Date() });
    return got === "replied"
      ? [{ port: "replied", event: { ...e, subject: `reply:sms:${contactId}`, kind: "reply" } }]
      : [];
  };
