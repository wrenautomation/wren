CREATE TABLE "call_briefs" (
	"call_booking_id" integer NOT NULL,
	"start" timestamp with time zone,
	"brief" jsonb NOT NULL,
	"model" varchar(64),
	"built_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_call_briefs" PRIMARY KEY("call_booking_id")
);
--> statement-breakpoint
DROP VIEW "calendar"."booking_records";--> statement-breakpoint
ALTER TABLE "calendar"."bookings" DROP CONSTRAINT "ck_calendar_bookings_showed";--> statement-breakpoint
ALTER TABLE "call_bookings" ADD COLUMN "outcome" varchar(16);--> statement-breakpoint
ALTER TABLE "call_bookings" ADD COLUMN "outcome_reason" text;--> statement-breakpoint
ALTER TABLE "call_bookings" ADD COLUMN "outcome_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_bookings" ADD COLUMN "outcome_by" text;--> statement-breakpoint
ALTER TABLE "call_briefs" ADD CONSTRAINT "fk_call_briefs_call_booking_id_call_bookings" FOREIGN KEY ("call_booking_id") REFERENCES "public"."call_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_bookings" ADD CONSTRAINT "ck_call_bookings_outcome" CHECK (("outcome")::text = ANY ((ARRAY['won'::character varying, 'not_yet'::character varying, 'no_show'::character varying, 'not_fit'::character varying])::text[]));--> statement-breakpoint
-- A no-show marked on the calendar moves to its mirror; "held" says nothing about how it went.
UPDATE "call_bookings" cb SET "outcome" = 'no_show', "outcome_at" = b."updated_at", "outcome_by" = 'migration'
  FROM "calendar"."bookings" b WHERE cb."uid" = 'wren-' || b."id" AND b."showed" = 'no_show';--> statement-breakpoint
ALTER TABLE "calendar"."bookings" DROP COLUMN "showed";--> statement-breakpoint
CREATE VIEW "calendar"."booking_records" AS (
    select b.id, b.calendar::text calendar, b.name, b.email::text email,
      case when b.state = 'cancelled' then 'cancelled'
        when cb.outcome is not null then cb.outcome::text
        when b.start > now() then 'upcoming' else 'past' end status,
      b.start, b.zone::text zone, b.offer::text offer, b.code::text code,
      coalesce(b.source->>'utm_source', b.source->>'ref') source, b.meet_url meet,
      b.created_at booked, b.cancelled_at, b.reason, cb.outcome_reason,
      cb.outcome_by marked_by, cb.outcome_at marked
    from calendar.bookings b
    left join public.call_bookings cb on cb.uid = 'wren-' || b.id);