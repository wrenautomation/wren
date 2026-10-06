/**
 * Calls booked on our own calendar (designs/2026-10-06-calendar.md), in their own Postgres
 * schema. One row per booking: a reschedule moves it in place, a cancel only marks it. A partial
 * unique index keeps one booked call per calendar per start, so two bookers racing for a slot
 * get one row and one refusal. Each booking is mirrored into `call_bookings` as `wren-<id>`, so
 * follow-up stops and booked counts read it like a cal.com one.
 */
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const calendar = pgSchema("calendar");

export const BOOKING_STATES = ["booked", "cancelled"] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

/** How a past call went, set from the portal; null until someone says. */
export const SHOWED = ["held", "no_show"] as const;
export type Showed = (typeof SHOWED)[number];

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
    showed: varchar("showed", { length: 16, enum: SHOWED }),
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
    oneOf("ck_calendar_bookings_showed", t.showed, SHOWED),
    check("ck_calendar_bookings_span", sql`"end" > start`),
  ],
);

export type CalendarBooking = typeof bookings.$inferSelect;

/**
 * `bookings` as console records (`./records.ts`). `status` is where a call shows: upcoming,
 * past (not yet said how it went), held, no-show, or cancelled. `source` is the first tag it
 * carried: utm_source, else ref.
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
  })
  .as(sql`
    select b.id, b.calendar::text calendar, b.name, b.email::text email,
      case when b.state = 'cancelled' then 'cancelled'
        when b.showed is not null then b.showed::text
        when b.start > now() then 'upcoming' else 'past' end status,
      b.start, b.zone::text zone, b.offer::text offer, b.code::text code,
      coalesce(b.source->>'utm_source', b.source->>'ref') source, b.meet_url meet,
      b.created_at booked, b.cancelled_at, b.reason
    from calendar.bookings b`);
