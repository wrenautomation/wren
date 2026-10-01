CREATE TABLE "call_invites" (
	"id" serial NOT NULL,
	"thread_event_id" integer NOT NULL,
	"enrollment_id" integer NOT NULL,
	"state" varchar(32) NOT NULL,
	"start" timestamp with time zone,
	"time_zone" varchar(64),
	"email" varchar(320) NOT NULL,
	"booking_uid" varchar(64),
	"detail" text,
	"reading" jsonb,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_call_invites" PRIMARY KEY("id"),
	CONSTRAINT "uq_call_invites_thread_event_id" UNIQUE("thread_event_id"),
	CONSTRAINT "ck_call_invites_callinvitestate" CHECK (("state")::text = ANY ((ARRAY['booking'::character varying, 'booked'::character varying, 'already_booked'::character varying, 'needs_you'::character varying])::text[])),
	CONSTRAINT "ck_call_invites_booked_has_uid" CHECK (((state)::text <> 'booked'::text) OR (booking_uid IS NOT NULL AND start IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "offered_times" jsonb;--> statement-breakpoint
ALTER TABLE "call_invites" ADD CONSTRAINT "fk_call_invites_thread_event_id_thread_events" FOREIGN KEY ("thread_event_id") REFERENCES "public"."thread_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_invites" ADD CONSTRAINT "fk_call_invites_enrollment_id_enrollments" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_invites" ADD CONSTRAINT "fk_call_invites_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_call_invites_enrollment_id" ON "call_invites" USING btree ("enrollment_id");