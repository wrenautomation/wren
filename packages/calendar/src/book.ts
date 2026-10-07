/**
 * Booking in Postgres: claim a slot, move it, cancel it, say how it went. A claim reads the
 * day's calls and writes the row in one serializable transaction, and the partial unique index
 * on (calendar, start) backs it up, so two bookers racing for a slot get one call and one
 * `SlotTaken`. Each change is then mirrored into `call_bookings` as `wren-<id>` through
 * `applyBooking`, the path cal.com's webhook takes: it matches the message by `r` code or
 * address, stops the firm's follow-ups and counts the call.
 */
import { applyBooking, type BookingChange, type BookingOutcome } from "@wren/channel-email/inbox";
import { callBookings } from "@wren/channel-email/schema";
import type { MeetingOutcome } from "@wren/core/calls";
import { type Db, type Queryable, serializable, sqlState } from "@wren/db";
import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";
import type { Rules } from "./rules.js";
import { type BookingSource, bookings, type CalendarBooking } from "./schema.js";
import { isOpen, type Span } from "./slots.js";

/** Someone else took the slot, or it was never open. */
export class SlotTaken extends Error {
  constructor() {
    super("that time was just taken; pick another");
  }
}

/** The booking can't change: gone, already over, or not found. */
export class Unchangeable extends Error {}

const MIN = 60_000;
/** Calls this far either side of a start can touch it (buffer) or share its day (cap). */
const NEAR = 2 * 24 * 60 * MIN;

/** Booked calls on a calendar that touch [from, to), but `except`. */
export async function bookedCalls(
  db: Queryable,
  calendar: string,
  from: Date,
  to: Date,
  except?: number,
): Promise<Span[]> {
  return db
    .select({ start: bookings.start, end: bookings.end })
    .from(bookings)
    .where(
      and(
        eq(bookings.calendar, calendar),
        eq(bookings.state, "booked"),
        lt(bookings.start, to),
        gt(bookings.end, from),
        ...(except === undefined ? [] : [ne(bookings.id, except)]),
      ),
    );
}

/** One call as the Calendar app draws it: booked or cancelled, any that touch the range. */
export interface CallBlock {
  id: number;
  start: Date;
  end: Date;
  name: string;
  offer: string | null;
  state: "booked" | "cancelled";
  /** How it went (`@wren/core/calls`), from its mirror in `call_bookings`. */
  outcome: MeetingOutcome | null;
  meet: string | null;
}

/** Every call on a calendar that touches [from, to), soonest first: the app's week and month. */
export async function callsBetween(
  db: Queryable,
  calendar: string,
  from: Date,
  to: Date,
): Promise<CallBlock[]> {
  return db
    .select({
      id: bookings.id,
      start: bookings.start,
      end: bookings.end,
      name: bookings.name,
      offer: bookings.offer,
      state: bookings.state,
      outcome: callBookings.outcome,
      meet: bookings.meetUrl,
    })
    .from(bookings)
    .leftJoin(callBookings, eq(callBookings.uid, sql`'wren-' || ${bookings.id}`))
    .where(and(eq(bookings.calendar, calendar), lt(bookings.start, to), gt(bookings.end, from)))
    .orderBy(asc(bookings.start));
}

export interface Booker {
  name: string;
  email: string;
  /** Their IANA zone. */
  zone: string;
  offer: string | null;
  code: string | null;
  application: string | null;
  source: BookingSource;
}

/** Take `start` for `booker`. Throws `SlotTaken` when it isn't open, fresh, at write time. */
export async function claim(
  db: Db,
  o: {
    calendar: string;
    rules: Rules;
    start: Date;
    booker: Booker;
    now: Date;
    /** The calendar's busy times around `start`. */
    busy: readonly Span[];
  },
): Promise<CalendarBooking> {
  const t = o.start.getTime();
  try {
    return await serializable(db, async (tx) => {
      const calls = await bookedCalls(tx, o.calendar, new Date(t - NEAR), new Date(t + NEAR));
      if (!isOpen(o.rules, o.start, { now: o.now, busy: o.busy, calls })) throw new SlotTaken();
      const [row] = await tx
        .insert(bookings)
        .values({
          calendar: o.calendar,
          start: o.start,
          end: new Date(t + o.rules.length * MIN),
          ...o.booker,
          email: o.booker.email.trim().toLowerCase(),
          createdAt: o.now,
          updatedAt: o.now,
        })
        .returning();
      if (!row) throw new Error("booking insert returned no row");
      return row;
    });
  } catch (err) {
    if (sqlState(err) === "23505") throw new SlotTaken();
    throw err;
  }
}

export async function bookingById(db: Queryable, id: number): Promise<CalendarBooking | null> {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
  return row ?? null;
}

/**
 * Move a booked call that hasn't started to `start`, which must be open (its own old time
 * doesn't count against it). Clears the reminders sent, so the new time gets its own.
 */
export async function moveBooking(
  db: Db,
  o: { id: number; rules: Rules; start: Date; now: Date; busy: readonly Span[] },
): Promise<{ before: CalendarBooking; after: CalendarBooking }> {
  const t = o.start.getTime();
  try {
    return await serializable(db, async (tx) => {
      const before = await bookingById(tx, o.id);
      if (!before || before.state !== "booked") throw new Unchangeable("that call was cancelled");
      if (before.start <= o.now) throw new Unchangeable("that call has already started");
      if (before.start.getTime() === t) return { before, after: before };
      const calls = await bookedCalls(
        tx,
        before.calendar,
        new Date(t - NEAR),
        new Date(t + NEAR),
        o.id,
      );
      // Its own Google event is busy at the old time; that time is free once it moves.
      const busy = o.busy.filter(
        (b) =>
          b.start.getTime() !== before.start.getTime() || b.end.getTime() !== before.end.getTime(),
      );
      if (!isOpen(o.rules, o.start, { now: o.now, busy, calls })) throw new SlotTaken();
      const [after] = await tx
        .update(bookings)
        .set({
          start: o.start,
          end: new Date(t + o.rules.length * MIN),
          remindedDayAt: null,
          remindedHourAt: null,
          updatedAt: o.now,
        })
        .where(eq(bookings.id, o.id))
        .returning();
      if (!after) throw new Error(`booking ${o.id} update returned no row`);
      return { before, after };
    });
  } catch (err) {
    if (sqlState(err) === "23505") throw new SlotTaken();
    throw err;
  }
}

/** Cancel a booked call. Cancelling one already cancelled returns it as it is. */
export async function cancelBooking(
  db: Queryable,
  o: { id: number; by: string; reason: string | null; now: Date },
): Promise<{ row: CalendarBooking; changed: boolean }> {
  const [row] = await db
    .update(bookings)
    .set({
      state: "cancelled",
      cancelledAt: o.now,
      cancelledBy: o.by,
      reason: o.reason,
      updatedAt: o.now,
    })
    .where(and(eq(bookings.id, o.id), eq(bookings.state, "booked")))
    .returning();
  if (row) return { row, changed: true };
  const was = await bookingById(db, o.id);
  if (!was) throw new Unchangeable("no such call");
  return { row: was, changed: false };
}

/** Note the Google event a booking made. */
export async function setEvent(
  db: Queryable,
  id: number,
  made: { eventId: string; meetUrl: string | null },
): Promise<void> {
  await db
    .update(bookings)
    .set({ googleEventId: made.eventId, meetUrl: made.meetUrl })
    .where(eq(bookings.id, id));
}

/** The `call_bookings` uid of one of ours. */
export const mirrorUid = (id: number) => `wren-${id}`;

/** Hand a change to the shared bookings path: match, stop follow-ups, count. */
export function mirror(
  db: Db,
  row: CalendarBooking,
  change: BookingChange,
  now: Date,
): Promise<BookingOutcome> {
  return applyBooking(
    db,
    {
      change,
      uid: mirrorUid(row.id),
      fromUid: null,
      start: row.start,
      bookedAt: row.createdAt,
      email: row.email.toLowerCase(),
      name: row.name,
      offer: row.offer,
      code: row.code,
    },
    { now },
  );
}
