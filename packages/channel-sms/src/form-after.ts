/**
 * After a site applicant's first text (form.ts): the email with the booking link, and the one
 * notice when no text went.
 *
 * The email goes a few minutes after the text left, from William's address
 * (`WREN_FORM_MAIL_FROM`), in the `email/forms/form-booking` template's words: what he calls
 * the calendar confirmation. None to someone who booked by then. It's claimed on its run before
 * it's sent, so the push and the pass never send it twice; a failed send lets go of the claim
 * and the next run tries again.
 *
 * The notice: an applicant who ticked the texts box and got no text 10 minutes after it was due
 * gets one notice to William naming why (their country, a landline, Telnyx refused it, an empty
 * template, or the texting window, until when). Never twice: `notice_at` is claimed first.
 */
import type { Notifier } from "@wren/core/notify";
import { renderKind } from "@wren/core/slots";
import type { TemplateRef } from "@wren/core/templates";
import { liveOrDefault } from "@wren/core/templates/defaults";
import type { Db, Queryable } from "@wren/db";
import { and, desc, eq, gte, isNull, lte, notInArray } from "drizzle-orm";
import type { Bookings } from "./bookings.js";
import { FORM_WORKFLOW } from "./form.js";
import { countryOf, phoneCountry } from "./phone.js";
import { inWindow, nextOpen, policyFor, type SmsPolicy } from "./policy.js";
import type { SendMail } from "./reviews.js";
import { type SmsContact, type SpeedRun, smsContacts, smsMessages, speedRuns } from "./schema.js";
import { firstName } from "./templates.js";

/** The email waits this long after the text, so it reads as a follow-on, not a duplicate. */
export const EMAIL_AFTER_MS = 5 * 60 * 1000;
/** No text this long after it was due: William hears why. */
export const NOTICE_AFTER_MS = 10 * 60 * 1000;
/** Past this, a missed email or notice is old news: the pass stops looking. */
const SWEEP_WITHIN_MS = 86_400_000;

/** The email's place in the template store: kind email, system `forms`. */
export const FORM_EMAILS = "forms";
export const FORM_EMAIL = "form-booking";
export const formEmailRef: TemplateRef = { kind: "email", system: FORM_EMAILS, name: FORM_EMAIL };

export interface AfterOptions {
  /** Plain mail from William's address (the worker's `plainMailer`). Null = no email goes. */
  send: SendMail | null;
  /** Asked before the email; null = no check. */
  bookings: Bookings | null;
  senderName: string;
  notifier: Notifier | null;
  policy: SmsPolicy;
  now: Date;
}

export type EmailOutcome = "sent" | "booked" | "not_yet" | "skipped";

const SENDING = "sending";

async function runById(db: Queryable, runId: number) {
  const [row] = await db
    .select({ run: speedRuns, contact: smsContacts })
    .from(speedRuns)
    .leftJoin(smsContacts, eq(smsContacts.id, speedRuns.smsContactId))
    .where(eq(speedRuns.id, runId));
  return row;
}

async function release(db: Queryable, runId: number) {
  await db
    .update(speedRuns)
    .set({ emailDetail: null })
    .where(and(eq(speedRuns.id, runId), eq(speedRuns.emailDetail, SENDING)));
}

async function emailDone(db: Queryable, runId: number, detail: string, at: Date | null) {
  await db
    .update(speedRuns)
    .set({ emailDetail: detail, emailAt: at })
    .where(eq(speedRuns.id, runId));
}

/**
 * The email after one run's first text: sent, skipped for a booking, or not yet (the text
 * hasn't left, or left under EMAIL_AFTER_MS ago). A failed send throws, unclaimed.
 */
export async function formEmail(db: Db, runId: number, o: AfterOptions): Promise<EmailOutcome> {
  const row = await runById(db, runId);
  const run = row?.run;
  if (!run || run.workflow !== FORM_WORKFLOW || run.emailDetail !== null || !run.email)
    return "skipped";
  if (run.firstTouch === "queued") return "not_yet";
  if (run.firstTouch !== "sent" || !run.firstTouchAt) return "skipped";
  if (o.now.getTime() - run.firstTouchAt.getTime() < EMAIL_AFTER_MS) return "not_yet";
  const send = o.send;
  if (!send) return "skipped";
  const claimed = await db
    .update(speedRuns)
    .set({ emailDetail: SENDING })
    .where(and(eq(speedRuns.id, run.id), isNull(speedRuns.emailDetail)))
    .returning({ id: speedRuns.id });
  if (claimed.length === 0) return "skipped";
  try {
    if (o.bookings && (await o.bookings.booked(run.email))) {
      await emailDone(db, run.id, `booked a call on ${o.bookings.name} first: no email`, null);
      return "booked";
    }
    const link = row.contact?.bookingLink;
    const words = await liveOrDefault(db, formEmailRef);
    const why = !words
      ? `the ${FORM_EMAILS}/${FORM_EMAIL} email template is empty`
      : !link
        ? "no booking link on their thread"
        : null;
    if (why || !words || !link) {
      await emailDone(db, run.id, why ?? "no email", null);
      return "skipped";
    }
    const out = renderKind(
      "email",
      words.template,
      { first_name: firstName(run.name), sender: o.senderName, booking_link: link },
      `form:${run.id}`,
    );
    await send({
      to: run.email,
      subject: out.subject ?? "Your form on wrenautomation.com",
      text: out.body,
    });
    await emailDone(db, run.id, "sent", o.now);
    return "sent";
  } catch (err) {
    await release(db, run.id);
    throw err;
  }
}

export interface AfterStats {
  emailed: number;
  booked: number;
  noticed: number;
  errors: string[];
}

/** The pass's sweep: every email now due, and every notice. */
export async function formAfter(db: Db, o: AfterOptions): Promise<AfterStats> {
  const stats: AfterStats = { emailed: 0, booked: 0, noticed: 0, errors: [] };
  const recent = new Date(o.now.getTime() - SWEEP_WITHIN_MS);
  const emails = await db
    .select({ id: speedRuns.id })
    .from(speedRuns)
    .where(
      and(
        eq(speedRuns.workflow, FORM_WORKFLOW),
        eq(speedRuns.firstTouch, "sent"),
        isNull(speedRuns.emailDetail),
        lte(speedRuns.firstTouchAt, new Date(o.now.getTime() - EMAIL_AFTER_MS)),
        gte(speedRuns.firstTouchAt, recent),
      ),
    );
  if (o.send)
    for (const { id } of emails) {
      try {
        const got = await formEmail(db, id, o);
        if (got === "sent") stats.emailed += 1;
        if (got === "booked") stats.booked += 1;
      } catch (err) {
        stats.errors.push(`run ${id} email: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  const notices = await db
    .select({ id: speedRuns.id })
    .from(speedRuns)
    .where(
      and(
        eq(speedRuns.workflow, FORM_WORKFLOW),
        eq(speedRuns.consent, true),
        notInArray(speedRuns.firstTouch, ["sent", "booked", "no_consent", "would_send"]),
        isNull(speedRuns.noticeAt),
        lte(speedRuns.firstDueAt, new Date(o.now.getTime() - NOTICE_AFTER_MS)),
        gte(speedRuns.firstDueAt, recent),
      ),
    );
  for (const { id } of notices) if ((await noTextNotice(db, id, o)) === "sent") stats.noticed += 1;
  return stats;
}

/** "Thu 8:00 AM IST" on their clock (Eastern when unknown). */
function clockText(at: Date, zone: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone ?? "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

/** Why a run's applicant has no text yet, in plain words. */
export async function whyNoText(
  db: Queryable,
  run: SpeedRun,
  contact: SmsContact | null,
  policy: SmsPolicy,
  now: Date,
): Promise<string> {
  const detail = run.firstTouchDetail ?? "";
  if (run.firstTouch === "no_phone") return `Country: ${detail || "not a number we text"}.`;
  if (run.firstTouch === "refused") {
    if (detail.startsWith("not a mobile")) return `Landline: ${detail}.`;
    if (detail.startsWith("Telnyx refused")) {
      const abroad = run.e164 && !countryOf(run.e164) ? phoneCountry(run.e164) : null;
      return `Refused: ${detail}.${abroad ? ` It's a ${abroad} number: texts abroad need international sending on in Telnyx.` : ""}`;
    }
    if (/template.*empty/.test(detail)) return `Template empty: ${detail}.`;
    return `No text: ${detail || "refused"}.`;
  }
  const asked = policyFor("form", policy);
  if (!inWindow(run.zone, now, asked)) {
    const open = nextOpen(run.zone, now, asked);
    return `Out of the texting window on their clock until ${open ? clockText(open, run.zone) : "it opens"}.`;
  }
  if (!contact || contact.state === "new")
    return `Not texted yet: ${contact?.stateReason ?? "neither the push nor the 30-minute pass has reached it"}.`;
  const [msg] = await db
    .select()
    .from(smsMessages)
    .where(and(eq(smsMessages.contactId, contact.id), eq(smsMessages.step, 1)))
    .orderBy(desc(smsMessages.id))
    .limit(1);
  if (msg?.state === "queued") return `Queued, not sent yet${msg.detail ? `: ${msg.detail}` : ""}.`;
  return `No text: their thread is ${contact.state}${contact.stateReason ? ` (${contact.stateReason})` : ""}.`;
}

/** The one notice for a run with no text 10 minutes past due; "sent" once, then never again. */
export async function noTextNotice(
  db: Db,
  runId: number,
  o: Pick<AfterOptions, "notifier" | "policy" | "now">,
): Promise<"sent" | "not_yet" | "skipped"> {
  const row = await runById(db, runId);
  const run = row?.run;
  if (!run || run.workflow !== FORM_WORKFLOW || !run.consent || run.noticeAt) return "skipped";
  if (["sent", "booked", "no_consent", "would_send"].includes(run.firstTouch)) return "skipped";
  if (!run.firstDueAt || o.now.getTime() - run.firstDueAt.getTime() < NOTICE_AFTER_MS)
    return "not_yet";
  if (!o.notifier) return "skipped";
  const why = await whyNoText(db, run, row.contact ?? null, o.policy, o.now);
  const claimed = await db
    .update(speedRuns)
    .set({ noticeAt: o.now })
    .where(and(eq(speedRuns.id, run.id), isNull(speedRuns.noticeAt)))
    .returning({ id: speedRuns.id });
  if (claimed.length === 0) return "skipped";
  const minutes = Math.round((o.now.getTime() - run.leadAt.getTime()) / 60_000);
  await o.notifier.notify(
    "No text to a site applicant",
    `${run.name ?? "An applicant"} (${run.subject.replace("site:applications:", "application ")}) ticked the texts box ${minutes} min ago and has no text. ${why}`,
    "action",
  );
  return "sent";
}
