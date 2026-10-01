/**
 * Day-before reminders for calls booked on cal.com. Each SmsWatch pass lists
 * the calls in the next two days. A call gets one text, `reminder.day-before`
 * in William's words, on the day before it on the person's own clock, inside
 * the window's hours on any day of the week (it answers something they booked).
 *
 * Only someone who said yes to texts gets one: the booking's application (the
 * lander's link carries its id) or its email must match a contact whose basis
 * the policy texts. Nobody who booked today (they remember), nobody opted out
 * or at the monthly cap. An empty template means no reminders.
 *
 * The tick sends it. A reminder is queued no later than REMINDER_FRESH_MS
 * before the window shuts, and the tick drops one that has waited longer than
 * that, so it never lands outside the window or on the day of the call.
 */
import { activeSuppressionOf } from "@wren/core";
import { canonicalZone, wallClock } from "@wren/core/time";
import type { Queryable } from "@wren/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Booking, Bookings } from "./bookings.js";
import { monthlyRoomAt, REMINDER_FRESH_MS } from "./deliver.js";
import { countryOf } from "./phone.js";
import { daysBetween, FLEET_ZONE, inWindow, LATEST_MINUTE, type SmsPolicy } from "./policy.js";
import { cannotReach, pickNumber } from "./pool.js";
import { type SmsContact, type SmsNumber, smsContacts, smsMessages, smsNumbers } from "./schema.js";
import { fieldsFor, templateBodies } from "./template-store.js";
import { DAY_BEFORE, firstName, render } from "./templates.js";

/** Past tomorrow on any clock. */
const LOOK_AHEAD_MS = 48 * 3_600_000;
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const ENDED: readonly SmsContact["state"][] = ["opted_out", "unreachable", "stopped"];

export interface ReminderStats {
  /** Accepted calls in the next two days. */
  calls: number;
  /** Calls whose reminder day is today. */
  due: number;
  queued: number;
  /** Queued by an earlier pass. */
  already: number;
  /** Booked today: no reminder. */
  bookedToday: number;
  /** Outside the hours on their clock: a later pass today. */
  outOfHours: number;
  /** The template is empty: nothing queued. */
  empty: number;
  /** No contact that said yes to texts. */
  noConsent: number;
  /** Opted out, a landline, or stopped. */
  ended: number;
  /** Already at the monthly cap. */
  capped: number;
  /** No number reaches their phone yet. */
  unreachable: number;
}

export interface ReminderOptions {
  bookings: Bookings;
  policy: SmsPolicy;
  senderName: string;
  now: Date;
  runId?: string | null;
}

function dayIn(zone: string, at: Date): string {
  const w = wallClock(zone, at);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** "2:30 PM" on `zone`'s clock, with plain spaces (ICU's narrow one would make it a UCS-2 text). */
function clockTime(zone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" })
    .format(at)
    .replace(/\s/g, " ");
}

/** The contact that said yes to texts for this booking: its application's, else the newest under its email. */
async function consentFor(
  db: Queryable,
  booking: Booking,
  policy: SmsPolicy,
): Promise<SmsContact | null> {
  const bases = [...policy.bases];
  if (booking.application) {
    const [form] = await db
      .select()
      .from(smsContacts)
      .where(
        and(
          eq(smsContacts.sourceKind, "form"),
          eq(smsContacts.sourceRef, booking.application),
          inArray(smsContacts.basis, bases),
        ),
      );
    if (form) return form;
  }
  const [byEmail] = await db
    .select()
    .from(smsContacts)
    .where(
      and(
        sql`lower(${smsContacts.email}) = ${booking.email.trim().toLowerCase()}`,
        inArray(smsContacts.basis, bases),
      ),
    )
    .orderBy(desc(smsContacts.id))
    .limit(1);
  return byEmail ?? null;
}

export async function remindBookings(db: Queryable, opts: ReminderOptions): Promise<ReminderStats> {
  const { now, policy } = opts;
  const stats: ReminderStats = {
    calls: 0,
    due: 0,
    queued: 0,
    already: 0,
    bookedToday: 0,
    outOfHours: 0,
    empty: 0,
    noConsent: 0,
    ended: 0,
    capped: 0,
    unreachable: 0,
  };
  const hours: SmsPolicy = {
    ...policy,
    days: EVERY_DAY,
    windowEndMinute: Math.min(policy.windowEndMinute, LATEST_MINUTE) - REMINDER_FRESH_MS / 60_000,
  };
  const words = (await templateBodies(db, [DAY_BEFORE])).get(DAY_BEFORE);
  const calls = await opts.bookings.upcoming(now, new Date(now.getTime() + LOOK_AHEAD_MS));
  stats.calls = calls.length;
  for (const call of calls) {
    const known = call.timeZone ? canonicalZone(call.timeZone) : null;
    const zone = known ?? FLEET_ZONE;
    const today = dayIn(zone, now);
    if (daysBetween(today, dayIn(zone, call.start)) !== 1) continue;
    stats.due += 1;
    const [sent] = await db
      .select({ id: smsMessages.id })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.kind, "reminder"),
          eq(smsMessages.template, DAY_BEFORE),
          eq(smsMessages.ref, call.uid),
        ),
      );
    if (sent) {
      stats.already += 1;
      continue;
    }
    if (dayIn(zone, call.createdAt) >= today) {
      stats.bookedToday += 1;
      continue;
    }
    // Unknown zone: inside the hours on both US coasts, like any text with no clock.
    if (!inWindow(known, now, hours)) {
      stats.outOfHours += 1;
      continue;
    }
    if (words === undefined) {
      stats.empty += 1;
      continue;
    }
    const consent = await consentFor(db, call, policy);
    if (!consent) {
      stats.noConsent += 1;
      continue;
    }
    // Sent on the phone's existing thread, from the number they already know.
    const [thread] = await db
      .select()
      .from(smsContacts)
      .where(and(eq(smsContacts.e164, consent.e164), isNotNull(smsContacts.numberId)))
      .orderBy(desc(smsContacts.id))
      .limit(1);
    const contact = thread ?? consent;
    if (
      ENDED.includes(contact.state) ||
      contact.lineType === "landline" ||
      (await activeSuppressionOf(db, "phone", contact.e164))
    ) {
      stats.ended += 1;
      continue;
    }
    if (await monthlyRoomAt(db, contact.e164, policy, now)) {
      stats.capped += 1;
      continue;
    }
    const country = countryOf(contact.e164);
    let number: SmsNumber | null | undefined = null;
    if (contact.numberId)
      [number] = await db.select().from(smsNumbers).where(eq(smsNumbers.id, contact.numberId));
    else if (country) number = await pickNumber(db, country);
    if (!number || cannotReach(number, contact.e164)) {
      stats.unreachable += 1;
      continue;
    }
    if (!contact.numberId)
      await db
        .update(smsContacts)
        .set({ numberId: number.id })
        .where(eq(smsContacts.id, contact.id));
    const fields = await fieldsFor(db, contact, opts.senderName);
    const [queued] = await db
      .insert(smsMessages)
      .values({
        contactId: contact.id,
        direction: "out",
        kind: "reminder",
        template: DAY_BEFORE,
        ref: call.uid,
        numberId: number.id,
        toE164: contact.e164,
        body: render(words, {
          ...fields,
          first_name: fields.first_name ?? firstName(call.name),
          time: clockTime(zone, call.start),
        }),
        state: "queued",
        dueAt: now,
        runId: opts.runId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: smsMessages.id });
    if (queued) stats.queued += 1;
    else stats.already += 1;
  }
  return stats;
}
