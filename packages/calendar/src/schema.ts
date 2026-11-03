/**
 * Calls booked on our own calendar (designs/2026-10-06-calendar.md), in their own Postgres
 * schema. One row per booking: a reschedule moves it in place, a cancel only marks it. A partial
 * unique index keeps one booked call per calendar per start, so two bookers racing for a slot
 * get one row and one refusal. Each booking is mirrored into `call_bookings` as `wren-<id>`, so
 * follow-up stops and booked counts read it like a cal.com one.
 */
import { MEETING_OUTCOMES } from "@wren/core/calls";
import { oneOf } from "@wren/db/columns";
import { enrollments, messages } from "@wren/starling-email/schema";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const calendar = pgSchema("calendar");

export const BOOKING_STATES = ["booked", "cancelled"] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

/** Where the booker came from: the link's tags, as the lander read them. */
export interface BookingSource {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  ref?: string;
  /** The lander's visitor cookie. */
  visitor?: string;
  /** The page they booked on. */
  page?: string;
}

export const bookings = calendar.table(
  "bookings",
  {
    id: serial("id"),
    /** Whose calendar: "wren", or a client's slug once clients have one. */
    calendar: varchar("calendar", { length: 64 }).notNull().default("wren"),
    state: varchar("state", { length: 16, enum: BOOKING_STATES }).notNull().default("booked"),
    start: timestamp("start", { withTimezone: true }).notNull(),
    end: timestamp("end", { withTimezone: true }).notNull(),
    name: text("name").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    /** The booker's IANA zone, as their browser gave it: what their mail's times read in. */
    zone: varchar("zone", { length: 64 }).notNull(),
    offer: varchar("offer", { length: 64 }),
    /** The link's `?r=` code: the message it came from. */
    code: varchar("code", { length: 40 }),
    /** The lander's application id, when they applied first: what text consent is found by. */
    application: varchar("application", { length: 64 }),
    source: jsonb("source").$type<BookingSource>().notNull().default({}),
    /** The Google event; null until it is made, or with no Google account set. */
    googleEventId: varchar("google_event_id", { length: 1024 }),
    meetUrl: text("meet_url"),
    remindedDayAt: timestamp("reminded_day_at", { withTimezone: true }),
    remindedHourAt: timestamp("reminded_hour_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** "booker", or the team member's address. */
    cancelledBy: varchar("cancelled_by", { length: 320 }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_bookings" }),
    uniqueIndex("uq_calendar_bookings_slot").on(t.calendar, t.start).where(sql`state = 'booked'`),
    index("ix_calendar_bookings_email").on(sql`lower(${t.email})`),
    index("ix_calendar_bookings_start").on(t.start),
    oneOf("ck_calendar_bookings_state", t.state, BOOKING_STATES),
    check("ck_calendar_bookings_span", sql`"end" > start`),
  ],
);

export type CalendarBooking = typeof bookings.$inferSelect;

/**
 * `bookings` as console records (`./records.ts`). `status` is where a call shows: upcoming,
 * past (not yet said how it went), its outcome, or cancelled. The outcome lives on the call's
 * mirror in `call_bookings` (uid `wren-<id>`), one for every call (`@wren/core/calls`).
 * `source` is the first tag it carried: utm_source, else ref.
 */
export const bookingRecords = calendar
  .view("booking_records", {
    id: integer("id"),
    calendar: text("calendar"),
    name: text("name"),
    email: text("email"),
    status: text("status"),
    start: timestamp("start", { withTimezone: true }),
    zone: text("zone"),
    offer: text("offer"),
    code: text("code"),
    source: text("source"),
    meet: text("meet"),
    booked: timestamp("booked", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    reason: text("reason"),
    outcomeReason: text("outcome_reason"),
    markedBy: text("marked_by"),
    marked: timestamp("marked", { withTimezone: true }),
  })
  .as(sql`
    select b.id, b.calendar::text calendar, b.name, b.email::text email,
      case when b.state = 'cancelled' then 'cancelled'
        when cb.outcome is not null then cb.outcome::text
        when b.start > now() then 'upcoming' else 'past' end status,
      b.start, b.zone::text zone, b.offer::text offer, b.code::text code,
      coalesce(b.source->>'utm_source', b.source->>'ref') source, b.meet_url meet,
      b.created_at booked, b.cancelled_at, b.reason, cb.outcome_reason,
      cb.outcome_by marked_by, cb.outcome_at marked
    from calendar.bookings b
    left join public.call_bookings cb on cb.uid = 'wren-' || b.id`);

/**
 * A call booked on Wren's cal.com, one row per booking (designs/2026-10-04-booking-webhook.md).
 * cal.com's webhook (through the phone Worker) and `wren email bookings sync` both write it.
 * A reschedule moves the row to the new uid and time; a cancel only marks it. The message and
 * enrollment are what it matched: the link's `r` code, else the attendee's address. No match
 * still keeps the row.
 */
export const CALL_BOOKING_STATES = ["booked", "cancelled"] as const;
export type CallBookingState = (typeof CALL_BOOKING_STATES)[number];

export const callBookings = pgTable(
  "call_bookings",
  {
    id: serial("id").notNull(),
    uid: varchar("uid", { length: 64 }).notNull(),
    state: varchar("state", { length: 16, enum: CALL_BOOKING_STATES }).notNull(),
    start: timestamp("start", { withTimezone: true }),
    email: varchar("email", { length: 320 }),
    name: text("name"),
    offer: varchar("offer", { length: 64 }),
    /** The link's `?r=` code, as cal.com hands it back in `metadata.r`. */
    code: varchar("code", { length: 40 }),
    messageId: integer("message_id"),
    enrollmentId: integer("enrollment_id"),
    /** When it was booked on cal.com: what the counts date it by. */
    bookedAt: timestamp("booked_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /** How it went, marked by a person once it's over (`@wren/core/calls`); null until then. */
    outcome: varchar("outcome", { length: 16, enum: MEETING_OUTCOMES }),
    /** Why a not yet (or any outcome) went that way, in the rep's words. */
    outcomeReason: text("outcome_reason"),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    /** Who marked it: their email. */
    outcomeBy: text("outcome_by"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_call_bookings" }),
    unique("uq_call_bookings_uid").on(t.uid),
    index("ix_call_bookings_enrollment_id").on(t.enrollmentId),
    index("ix_call_bookings_message_id").on(t.messageId),
    foreignKey({
      columns: [t.messageId],
      foreignColumns: [messages.id],
      name: "fk_call_bookings_message_id_messages",
    }),
    foreignKey({
      columns: [t.enrollmentId],
      foreignColumns: [enrollments.id],
      name: "fk_call_bookings_enrollment_id_enrollments",
    }),
    oneOf("ck_call_bookings_callbookingstate", t.state, CALL_BOOKING_STATES),
    oneOf("ck_call_bookings_outcome", t.outcome, MEETING_OUTCOMES),
  ],
);
export type CallBooking = typeof callBookings.$inferSelect;

/**
 * The pre-call brief of a booked call, one per call (designs/2026-10-07-close-brief-outcome.md):
 * built when it's booked, rebuilt before it starts. `brief` is `CallBrief` (`calls/brief.ts`),
 * every item with its source and date. `start` is the call time it was built for, so a moved
 * call's old send skips.
 */
export const callBriefs = pgTable(
  "call_briefs",
  {
    callBookingId: integer("call_booking_id").notNull(),
    start: timestamp("start", { withTimezone: true }),
    brief: jsonb("brief").notNull(),
    /** The model that wrote its questions; null when code alone did. */
    model: varchar("model", { length: 64 }),
    builtAt: timestamp("built_at", { withTimezone: true }).notNull(),
    /** When the rep was pinged with it. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.callBookingId], name: "pk_call_briefs" }),
    foreignKey({
      columns: [t.callBookingId],
      foreignColumns: [callBookings.id],
      name: "fk_call_briefs_call_booking_id_call_bookings",
    }).onDelete("cascade"),
  ],
);
export type CallBriefRow = typeof callBriefs.$inferSelect;

/**
 * A call recorded on William's Mac (designs/2026-10-16-call-recording.md): OBS records it, `wren
 * calls add` transcribes it there, uploads the mp4 to the files bucket (`file_key`) and writes the
 * notes. `call_booking_id` is the booked call it was, null for a manual one no booking matched.
 */
export const CALL_RECORDING_BY = ["desk", "manual"] as const;
export const callRecordings = pgTable(
  "call_recordings",
  {
    id: serial("id").notNull(),
    callBookingId: integer("call_booking_id"),
    /** Its mp4 in the files bucket, under `calls/`. */
    fileKey: text("file_key").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    durationS: integer("duration_s").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    transcript: text("transcript").notNull(),
    /** Timed lines, `{ start, end, text }` in seconds. */
    segments: jsonb("segments").notNull(),
    /** `CallNotes` (`calls/recording.ts`); null when the model gave none. */
    notes: jsonb("notes"),
    /** The model that wrote the notes. */
    model: varchar("model", { length: 64 }),
    /** The desk started it for a booking, or a person did. */
    by: varchar("by", { length: 8, enum: CALL_RECORDING_BY }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_call_recordings" }),
    unique("uq_call_recordings_file_key").on(t.fileKey),
    index("ix_call_recordings_call_booking_id").on(t.callBookingId),
    foreignKey({
      columns: [t.callBookingId],
      foreignColumns: [callBookings.id],
      name: "fk_call_recordings_call_booking_id_call_bookings",
    }).onDelete("cascade"),
    oneOf("ck_call_recordings_by", t.by, CALL_RECORDING_BY),
  ],
);
export type CallRecordingRow = typeof callRecordings.$inferSelect;
