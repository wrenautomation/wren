/**
 * Calls booked on Wren's cal.com (designs/2026-10-04-booking-webhook.md). One shape for
 * both ways in: cal.com's webhook (`CallBookings.ingest`, through the phone Worker) and
 * the catch-up list (`wren email bookings sync`). A booking matches the email it came
 * from by the link's `r` code, else by the attendee's address; a matched one stops the
 * firm's sequences the way a reply does. A cancel only marks the row: it never restarts
 * a sequence.
 */
import { type Db, type Queryable, serializable } from "@wren/db";
import { desc, eq, sql } from "drizzle-orm";
import { callBookings, enrollments, messages } from "../schema.js";
import { stopCompany } from "../send/deliver.js";

export type BookingChange = "created" | "rescheduled" | "cancelled";

/** One booking event, from the webhook or the list. */
export interface BookingEvent {
  change: BookingChange;
  uid: string;
  /** A reschedule's old uid. */
  fromUid: string | null;
  start: Date | null;
  /** When it was booked; null = now. */
  bookedAt: Date | null;
  email: string | null;
  name: string | null;
  offer: string | null;
  code: string | null;
}

const TRIGGERS: Readonly<Record<string, BookingChange>> = {
  BOOKING_CREATED: "created",
  BOOKING_RESCHEDULED: "rescheduled",
  BOOKING_CANCELLED: "cancelled",
};

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
const when = (v: unknown): Date | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

type Fields = {
  uid?: unknown;
  attendees?: { name?: unknown; email?: unknown }[] | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: unknown;
};

function common(p: Fields, uid: string) {
  const who = Array.isArray(p.attendees) ? p.attendees[0] : undefined;
  const meta = p.metadata && typeof p.metadata === "object" ? p.metadata : {};
  return {
    uid,
    bookedAt: when(p.createdAt),
    email: str(who?.email, 320)?.toLowerCase() ?? null,
    name: str(who?.name, 200),
    offer: str(meta.offer, 64),
    code: str(meta.r, 40),
  };
}

/** A cal.com webhook body as an event; null for a PING or any other trigger. Throws on a booking with no uid. */
export function bookingFromWebhook(body: unknown): BookingEvent | null {
  const b = (body ?? {}) as { triggerEvent?: unknown; payload?: Fields & Record<string, unknown> };
  const change = typeof b.triggerEvent === "string" ? TRIGGERS[b.triggerEvent] : undefined;
  if (!change) return null;
  const p = b.payload ?? {};
  const uid = str(p.uid, 64);
  if (!uid) throw new Error(`${String(b.triggerEvent)} with no booking uid`);
  return {
    change,
    fromUid: change === "rescheduled" ? str(p.rescheduleUid, 64) : null,
    start: when(p.startTime),
    ...common(p, uid),
  };
}

/** One booking as cal.com's v2 list has it. */
export interface ListedBooking extends Fields {
  uid: string;
  status: string;
  start: string;
  rescheduledFromUid?: string | null;
  rescheduledToUid?: string | null;
  rescheduled?: boolean | null;
}

/**
 * A listed booking as the event that would have made it; null for the old half of a
 * reschedule (its new half carries the move). List oldest first.
 */
export function bookingFromList(b: ListedBooking): BookingEvent | null {
  const gone = b.status === "cancelled" || b.status === "rejected";
  if (gone && (b.rescheduledToUid || b.rescheduled)) return null;
  const fromUid = str(b.rescheduledFromUid, 64);
  return {
    change: gone ? "cancelled" : fromUid ? "rescheduled" : "created",
    fromUid,
    start: when(b.start),
    ...common(b, b.uid),
  };
}

export interface BookingOutcome {
  id: number;
  state: "booked" | "cancelled";
  enrollmentId: number | null;
  /** Enrollments this event stopped. */
  stopped: number;
}

/** The message and enrollment a booking came from: its link code, else the attendee's newest enrollment. */
async function match(
  db: Queryable,
  code: string | null,
  email: string | null,
): Promise<{ messageId: number | null; enrollmentId: number } | null> {
  if (code) {
    const [m] = await db
      .select({ messageId: messages.id, enrollmentId: messages.enrollmentId })
      .from(messages)
      .where(eq(messages.linkCode, code));
    if (m) return m;
  }
  if (!email) return null;
  const [e] = await db
    .select({ enrollmentId: enrollments.id })
    .from(enrollments)
    .where(sql`lower(${enrollments.toEmail}) = ${email}`)
    .orderBy(desc(enrollments.id))
    .limit(1);
  return e ? { messageId: null, enrollmentId: e.enrollmentId } : null;
}

/** Apply one event. Idempotent: the same event twice leaves the same row and stops nothing more. */
export async function applyBooking(
  db: Db,
  e: BookingEvent,
  opts: { now: Date },
): Promise<BookingOutcome> {
  return serializable(db, async (tx) => {
    const state = e.change === "cancelled" ? "cancelled" : "booked";
    const fields = {
      ...(e.start ? { start: e.start } : {}),
      ...(e.email ? { email: e.email } : {}),
      ...(e.name ? { name: e.name } : {}),
      ...(e.offer ? { offer: e.offer } : {}),
      ...(e.code ? { code: e.code } : {}),
      updatedAt: opts.now,
    };
    // A reschedule moves the old row to the new uid, unless the new one is already in.
    if (e.change === "rescheduled" && e.fromUid) {
      const [taken] = await tx
        .select({ id: callBookings.id })
        .from(callBookings)
        .where(eq(callBookings.uid, e.uid));
      if (!taken) {
        await tx.update(callBookings).set({ uid: e.uid }).where(eq(callBookings.uid, e.fromUid));
      }
    }
    // A late "created" never revives a cancelled row; a reschedule or cancel sets the state.
    const [row] = await tx
      .insert(callBookings)
      .values({ uid: e.uid, state, bookedAt: e.bookedAt ?? opts.now, ...fields })
      .onConflictDoUpdate({
        target: callBookings.uid,
        set: e.change === "created" ? fields : { ...fields, state },
      })
      .returning();
    if (!row) throw new Error(`call_bookings upsert for ${e.uid} returned no row`);
    let { enrollmentId } = row;
    if (enrollmentId === null) {
      const found = await match(tx, row.code, row.email);
      if (found) {
        enrollmentId = found.enrollmentId;
        await tx
          .update(callBookings)
          .set({ messageId: found.messageId, enrollmentId })
          .where(eq(callBookings.id, row.id));
      }
    }
    let stopped = 0;
    if (row.state === "booked" && enrollmentId !== null) {
      const [enrollment] = await tx
        .select({ companyId: enrollments.companyId })
        .from(enrollments)
        .where(eq(enrollments.id, enrollmentId));
      if (enrollment) {
        stopped = await stopCompany(tx, {
          companyId: enrollment.companyId,
          reason: "booked",
          detail: `call booked on cal.com (${row.uid})`,
          now: opts.now,
        });
      }
    }
    return { id: row.id, state: row.state, enrollmentId, stopped };
  });
}
