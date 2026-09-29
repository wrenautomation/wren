CREATE TABLE "client_profile" (
	"one" boolean DEFAULT true NOT NULL,
	"firm" text NOT NULL,
	"sells" text NOT NULL,
	"fee_avg" integer,
	"voice" text NOT NULL,
	"recruiters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_recruiter" varchar(320),
	"signature" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_client_profile" PRIMARY KEY("one"),
	CONSTRAINT "ck_client_profile_one" CHECK ("client_profile"."one")
);
--> statement-breakpoint
CREATE TABLE "compositions" (
	"id" serial NOT NULL,
	"person_id" integer NOT NULL,
	"state" varchar(16) NOT NULL,
	"enrollment_id" integer,
	"detail" text,
	"inputs_hash" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"prompt_version" varchar(16) NOT NULL,
	"llm" jsonb,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_compositions" PRIMARY KEY("id"),
	CONSTRAINT "ck_compositions_state" CHECK (("state")::text = ANY ((ARRAY['drafted'::character varying, 'failed'::character varying])::text[])),
	CONSTRAINT "ck_compositions_enrollment_iff_drafted" CHECK (("compositions"."enrollment_id" is not null) = ("compositions"."state" = 'drafted'))
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" serial NOT NULL,
	"thread_event_id" integer NOT NULL,
	"enrollment_id" integer NOT NULL,
	"person_id" integer,
	"recruiter_email" varchar(320) NOT NULL,
	"forward_message_id" varchar(255) NOT NULL,
	"forwarded_at" timestamp with time zone,
	"meeting_booked_at" timestamp with time zone,
	"booked_by" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_handoffs" PRIMARY KEY("id"),
	CONSTRAINT "uq_handoffs_thread_event_id" UNIQUE("thread_event_id"),
	CONSTRAINT "ck_handoffs_booked_by_iff_booked" CHECK (("handoffs"."booked_by" is null) = ("handoffs"."meeting_booked_at" is null))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "ck_messages_approvalsource";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "products" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "fk_compositions_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "fk_compositions_enrollment_id_enrollments" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "fk_compositions_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "fk_handoffs_thread_event_id_thread_events" FOREIGN KEY ("thread_event_id") REFERENCES "public"."thread_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "fk_handoffs_enrollment_id_enrollments" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "fk_handoffs_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_compositions_person_id" ON "compositions" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "ck_messages_approvalsource" CHECK (("approved_by")::text = ANY ((ARRAY['operator'::character varying, 'auto'::character varying, 'client'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "caps";