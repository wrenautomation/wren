CREATE SCHEMA "calendar";
--> statement-breakpoint
CREATE TABLE "calendar"."bookings" (
	"id" serial NOT NULL,
	"calendar" varchar(64) DEFAULT 'wren' NOT NULL,
	"state" varchar(16) DEFAULT 'booked' NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"name" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"zone" varchar(64) NOT NULL,
	"offer" varchar(64),
	"code" varchar(40),
	"application" varchar(64),
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"google_event_id" varchar(1024),
	"meet_url" text,
	"showed" varchar(16),
	"reminded_day_at" timestamp with time zone,
	"reminded_hour_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" varchar(320),
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_bookings" PRIMARY KEY("id"),
	CONSTRAINT "ck_calendar_bookings_state" CHECK (("state")::text = ANY ((ARRAY['booked'::character varying, 'cancelled'::character varying])::text[])),
	CONSTRAINT "ck_calendar_bookings_showed" CHECK (("showed")::text = ANY ((ARRAY['held'::character varying, 'no_show'::character varying])::text[])),
	CONSTRAINT "ck_calendar_bookings_span" CHECK ("end" > start)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_calendar_bookings_slot" ON "calendar"."bookings" USING btree ("calendar","start") WHERE state = 'booked';--> statement-breakpoint
CREATE INDEX "ix_calendar_bookings_email" ON "calendar"."bookings" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "ix_calendar_bookings_start" ON "calendar"."bookings" USING btree ("start");--> statement-breakpoint
CREATE VIEW "calendar"."booking_records" AS (
    select b.id, b.calendar::text calendar, b.name, b.email::text email,
      case when b.state = 'cancelled' then 'cancelled'
        when b.showed is not null then b.showed::text
        when b.start > now() then 'upcoming' else 'past' end status,
      b.start, b.zone::text zone, b.offer::text offer, b.code::text code,
      coalesce(b.source->>'utm_source', b.source->>'ref') source, b.meet_url meet,
      b.created_at booked, b.cancelled_at, b.reason
    from calendar.bookings b);