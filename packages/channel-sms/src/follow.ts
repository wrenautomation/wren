/**
 * Text follow-ups on the spine (designs/2026-10-05-workflows.md, Follow-ups). Each sequence is a
 * cadence workflow of `sms.touch` nodes. Enroll queues the opener. When the tick sends a step, it
 * leaves that step's node as `sent` and waits on the wire for the next touch, which queues the
 * next text due now, so the tick still meters every send. A reply answers `replied` instead.
 */
import type { SpineEvent, Step } from "@wren/core/spine";
import { cadenceWorkflow, type Workflow } from "@wren/core/workflows";
import type { Db } from "@wren/db";
import { eq } from "drizzle-orm";
import { TOUCH } from "./components.js";
import { endContact } from "./deliver.js";
import { smsContacts, smsMessages } from "./schema.js";
import { fieldsFor, templateBodies } from "./template-store.js";
import { render, type SmsSequence, stepKey } from "./templates.js";

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
    label: `Texts: ${seq.name}`,
    blurb: `${seq.steps.length} texts, stopping when they answer.`,
    for: "wren",
    steps: seq.steps.map((s) => ({
      touch: TOUCH,
      with: { step: s.step },
      ...(s.afterDays > 0 ? { after: `${s.afterDays} day${s.afterDays === 1 ? "" : "s"}` } : {}),
    })),
  });
}

export interface TouchOptions {
  sequences: ReadonlyMap<string, SmsSequence>;
  senderName: string;
  now: Date;
}

/**
 * Queue step `step` of a contact's sequence, due now. A contact who replied answers "replied";
 * any other end, or an emptied step, sends nothing. Queueing a step twice is a no-op.
 */
export async function touch(
  db: Db,
  contactId: number,
  step: number,
  opts: TouchOptions,
): Promise<"queued" | "replied" | "ended"> {
  const [c] = await db.select().from(smsContacts).where(eq(smsContacts.id, contactId));
  if (c?.state === "replied") return "replied";
  if (c?.state !== "enrolled") return "ended";
  const seq = c.sequence ? opts.sequences.get(c.sequence) : undefined;
  const key = seq?.steps.some((s) => s.step === step) ? stepKey(seq.name, step) : null;
  const words = key ? (await templateBodies(db, [key])).get(key) : undefined;
  if (!key || words === undefined) {
    const why = key ? `template ${key} is empty` : `${c.sequence} has no step ${step}`;
    await endContact(db, c.id, "finished", why, opts.now);
    return "ended";
  }
  await db
    .insert(smsMessages)
    .values({
      contactId: c.id,
      direction: "out",
      kind: "sequence",
      step,
      template: key,
      numberId: c.numberId,
      toE164: c.e164,
      body: render(words, await fieldsFor(db, c, opts.senderName)),
      state: "queued",
      dueAt: opts.now,
    })
    .onConflictDoNothing();
  return "queued";
}

/** `sms.touch` on the spine: the node's `step`, in the database of whoever's workflow it is. */
export const touchStep =
  (dbFor: (client: string | null) => Db, opts: Omit<TouchOptions, "now">): Step =>
  async (_port, e, at) => {
    const contactId = Number(e.data.contactId);
    if (!Number.isInteger(contactId)) throw new Error(`${e.subject} is no text contact`);
    const got = await touch(dbFor(at.client), contactId, Number(at.with.step), {
      ...opts,
      now: new Date(),
    });
    return got === "replied"
      ? [{ port: "replied", event: { ...e, subject: `reply:sms:${contactId}`, kind: "reply" } }]
      : [];
  };
