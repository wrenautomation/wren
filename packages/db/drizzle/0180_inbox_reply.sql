CREATE TABLE "inbox_replies" (
	"id" serial NOT NULL,
	"thread" varchar(80) NOT NULL,
	"channel" varchar(8) NOT NULL,
	"target" varchar(80) NOT NULL,
	"who" text,
	"body" text NOT NULL,
	"why" text,
	"state" varchar(8) DEFAULT 'waiting' NOT NULL,
	"detail" text,
	"asked_by" varchar(200) NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" varchar(200),
	"decided_at" timestamp with time zone,
	CONSTRAINT "pk_inbox_replies" PRIMARY KEY("id"),
	CONSTRAINT "ck_inbox_replies_channel" CHECK (("channel")::text = ANY ((ARRAY['email'::character varying, 'text'::character varying, 'dm'::character varying, 'comment'::character varying])::text[])),
	CONSTRAINT "ck_inbox_replies_state" CHECK (("state")::text = ANY ((ARRAY['waiting'::character varying, 'sent'::character varying, 'dropped'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "inbox_threads" (
	"thread" varchar(80) NOT NULL,
	"assignee" varchar(200),
	"status" varchar(8),
	"status_at" timestamp with time zone,
	"snooze_until" timestamp with time zone,
	"updated_by" varchar(200) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_inbox_threads" PRIMARY KEY("thread"),
	CONSTRAINT "ck_inbox_threads_status" CHECK (("status")::text = ANY ((ARRAY['open'::character varying, 'waiting'::character varying, 'closed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "inbox_notes" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"thread" varchar(80) NOT NULL,
	"person_id" integer,
	"body" text NOT NULL,
	"by" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_inbox_notes" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "note_mentions" ALTER COLUMN "note_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "note_mentions" ADD COLUMN "inbox_note_id" uuid;--> statement-breakpoint
CREATE INDEX "ix_inbox_replies_state" ON "inbox_replies" USING btree ("state","asked_at");--> statement-breakpoint
CREATE INDEX "ix_inbox_replies_thread" ON "inbox_replies" USING btree ("thread");--> statement-breakpoint
CREATE INDEX "ix_inbox_threads_assignee" ON "inbox_threads" USING btree ("assignee");--> statement-breakpoint
CREATE INDEX "ix_inbox_notes_thread" ON "inbox_notes" USING btree ("thread","at");--> statement-breakpoint
CREATE INDEX "ix_inbox_notes_person" ON "inbox_notes" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "note_mentions" ADD CONSTRAINT "fk_note_mentions_inbox_note" FOREIGN KEY ("inbox_note_id") REFERENCES "public"."inbox_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_note_mentions_inbox_note" ON "note_mentions" USING btree ("inbox_note_id");--> statement-breakpoint
ALTER TABLE "note_mentions" ADD CONSTRAINT "ck_note_mentions_place" CHECK (num_nonnulls("note_mentions"."note_id", "note_mentions"."inbox_note_id") = 1);