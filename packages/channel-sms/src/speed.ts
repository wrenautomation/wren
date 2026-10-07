/**
 * Speed to lead's texts (designs/2026-10-07-speed-to-lead.md). A lead comes through a client's
 * door (a hook) as a `form` event; `firstText` keeps its run, and, when the form said yes to
 * texts, makes it a contact and enrolls it in `speed-to-lead`, which queues the first text due
 * now. The step then wakes the sender, so it leaves in seconds, inside the lead's asked window
 * (policy.ts). The rest of the sequence is the follow-up: day 1, 3 and 7 after the first, each
 * queued by its `sms.touch` (follow.ts), stopping on a reply, a booking or STOP.
 *
 * Nothing leaves with `WREN_SMS_LIVE` off or the client's texts off: the run records "would
 * send" at once and goes no further, with no contact, no carrier lookup and no text queued.
 */
import { activeSuppressionOf } from "@wren/core";
import { type DoorLead, leadOf } from "@wren/core/door";
import { linkPeople } from "@wren/core/leads";
import type { SpineEvent, Step } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { and, eq } from "drizzle-orm";
import { enroll } from "./enroll.js";
import { countryOf, toPhoneE164 } from "./phone.js";
import type { SmsPolicy } from "./policy.js";
import type { SmsProvider } from "./provider.js";
import { SmsRefusal } from "./refusal.js";
import { type FirstTouch, type SpeedRun, smsContacts, speedRuns } from "./schema.js";
import { liveTexts } from "./template-store.js";
import { checkSequence, type SmsSequence, stepKey } from "./templates.js";

export const SPEED = "speed-to-lead";

/** The first text, then day 1, 3 and 7 after it. Empty until the client's words are in. */
export const SPEED_SEQUENCE: SmsSequence = checkSequence({
  name: SPEED,
  label: "Speed to lead",
  steps: [
    { step: 1, afterDays: 0 },
    { step: 2, afterDays: 1 },
    { step: 3, afterDays: 2 },
    { step: 4, afterDays: 4 },
  ],
  firstGoes: "Within a minute of the form, in texting hours on their clock",
  fields: ["first_name", "sender", "booking_link"],
  namesSender: true,
});

/** Core sequences, registered next to every niche's (niches/src/index.ts). */
export const SPEED_SEQUENCES: readonly SmsSequence[] = [SPEED_SEQUENCE];

/** What a client's (or Wren's) first text runs on. */
export interface SpeedTexts {
  db: Db;
  /** `WREN_SMS_LIVE` and the client's texts both on. */
  live: boolean;
  /** Why not live, for the run ("WREN_SMS_LIVE is off"). */
  why: string | null;
  policy: SmsPolicy;
  provider: SmsProvider;
  senderName: string;
  bookingLink: string | null;
  /** Wake the sender, so a queued text leaves within seconds. The key makes a retry wake once. */
  nudge: (idempotencyKey: string) => Promise<void>;
}

export interface FirstText {
  run: SpeedRun;
  /** The text contact, once enrolled; null when no text was queued. */
  contactId: number | null;
}

/** The run of `subject`, made once: a retried step finds the first one and does nothing more. */
async function runOf(
  db: Db,
  r: { workflow: string; subject: string; lead: DoorLead; leadAt: Date },
  touch: FirstTouch,
  detail: string | null,
  now: Date,
): Promise<{ run: SpeedRun; made: boolean }> {
  const e164 = r.lead.phone ? toPhoneE164(r.lead.phone) : null;
  const [made] = await db
    .insert(speedRuns)
    .values({
      workflow: r.workflow,
      subject: r.subject,
      leadAt: r.leadAt,
      name: r.lead.name,
      phone: r.lead.phone?.slice(0, 64) ?? null,
      e164,
      email: r.lead.email,
      source: r.lead.source,
      consent: r.lead.consent,
      consentDetail: r.lead.consentDetail,
      zone: r.lead.zone?.slice(0, 64) ?? null,
      firstTouch: touch,
      firstTouchAt: touch === "would_send" ? now : null,
      firstTouchDetail: detail,
    })
    .onConflictDoNothing()
    .returning();
  if (made) return { run: made, made: true };
  const [have] = await db
    .select()
    .from(speedRuns)
    .where(and(eq(speedRuns.workflow, r.workflow), eq(speedRuns.subject, r.subject)));
  return { run: have as SpeedRun, made: false };
}

async function settle(db: Db, id: number, touch: FirstTouch, detail: string | null) {
  const [run] = await db
    .update(speedRuns)
    .set({ firstTouch: touch, firstTouchDetail: detail })
    .where(eq(speedRuns.id, id))
    .returning();
  return run as SpeedRun;
}

/**
 * A lead's first text: its run, and the text queued when it may go. Every way it doesn't is
 * written on the run (`first_touch`, `first_touch_detail`); the rep is alerted either way.
 */
export async function firstText(
  db: Db,
  r: { workflow: string; subject: string; lead: DoorLead; leadAt: Date },
  t: Omit<SpeedTexts, "db" | "nudge">,
  now: Date,
): Promise<FirstText> {
  const e164 = r.lead.phone ? toPhoneE164(r.lead.phone) : null;
  const before: [FirstTouch, string | null] = !r.lead.consent
    ? ["no_consent", "the form didn't say yes to texts"]
    : !e164
      ? ["no_phone", r.lead.phone ? `${r.lead.phone} isn't a US or Canadian number` : "no phone"]
      : (await activeSuppressionOf(db, "phone", e164))
        ? ["refused", "the phone opted out"]
        : !t.live
          ? ["would_send", t.why ?? "texts are off"]
          : ["queued", null];
  const { run, made } = await runOf(db, r, before[0], before[1], now);
  // A retry, or a lead the door saw before: the first run stands.
  if (!made) {
    const texted = run.firstTouch === "queued" || run.firstTouch === "sent";
    return { run, contactId: texted ? run.smsContactId : null };
  }
  if (run.firstTouch !== "queued" || !e164) return { run, contactId: null };

  const key = stepKey(SPEED, 1);
  if (!(await liveTexts(db, [key])).has(key))
    return {
      run: await settle(db, run.id, "refused", `template ${key} is empty`),
      contactId: null,
    };
  const source = r.lead.source ?? "a form";
  const [contact] = await db
    .insert(smsContacts)
    .values({
      e164,
      sourceKind: "hook",
      sourceRef: String(run.id),
      basis: "opt_in",
      basisDetail: `said yes to texts on ${source} (${r.lead.consentDetail ?? "consent"}) at ${r.leadAt.toISOString()}`,
      name: r.lead.name,
      email: r.lead.email,
      zone: run.zone,
    })
    .returning({ id: smsContacts.id });
  const contactId = contact?.id as number;
  // A lead who's a person already gets them, for the copy and the other channels.
  await linkPeople(db, "sms_contacts", [contactId]);
  await db.update(speedRuns).set({ smsContactId: contactId }).where(eq(speedRuns.id, run.id));
  let got: Awaited<ReturnType<typeof enroll>>;
  try {
    got = await enroll(db, {
      sequence: SPEED_SEQUENCE,
      contactIds: [contactId],
      policy: t.policy,
      provider: t.provider,
      senderName: t.senderName,
      bookingLink: t.bookingLink,
      heldNiches: [],
      limit: 1,
      now,
    });
  } catch (err) {
    // An empty follow-up step, or no carrier: no text, said why.
    if (!(err instanceof SmsRefusal)) throw err;
    return { run: await settle(db, run.id, "refused", err.message), contactId: null };
  }
  if (got.enrolled === 1) return { run: { ...run, smsContactId: contactId }, contactId };
  const why =
    got.lookupErrors[0] ??
    (got.considered === 0
      ? "the policy does not text opt_in contacts (WREN_SMS_BASES)"
      : got.noNumber
        ? `no pool number texts ${countryOf(e164)} phones`
        : got.companyBusy > 0
          ? "this phone is already in a running thread"
          : got.notTextable > 0
            ? "not a mobile number"
            : got.suppressed > 0
              ? "the phone opted out"
              : "not enrolled");
  return { run: await settle(db, run.id, "refused", why), contactId: null };
}

/** The lead on an event: the door's facts, else read from the event as a payload. */
export const leadOn = (e: SpineEvent): DoorLead =>
  (e.data.lead as DoorLead | undefined) ?? leadOf(e.data);

/**
 * `sms.forms` on the spine: the first text. `texted` carries the text contact on as its lead
 * (`lead:sms:<id>`, which the follow-up's touches know); `untexted` (no consent, no phone,
 * "would send", refused) goes on with the door's subject, so the rep is still alerted.
 */
export const firstTextStep =
  (textsFor: (client: string | null) => Promise<SpeedTexts>): Step =>
  async (_port, e, at) => {
    const t = await textsFor(at.client);
    const now = new Date();
    const lead = leadOn(e);
    const got = await firstText(
      t.db,
      { workflow: at.workflow, subject: e.subject, lead, leadAt: now },
      t,
      now,
    );
    const data = { ...e.data, lead, run: got.run.id };
    if (got.contactId === null)
      return [{ port: "untexted", event: { subject: e.subject, kind: "lead", data } }];
    await t.nudge(`speed:${at.workflow}:${got.run.id}`);
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
