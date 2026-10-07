CREATE TABLE "draft_events" (
	"id" serial NOT NULL,
	"item" varchar(200) NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"kind" varchar(16) NOT NULL,
	"platform" varchar(16),
	"event" varchar(16) NOT NULL,
	"via" varchar(8) NOT NULL,
	"by" varchar(200),
	"text" text,
	"title" text,
	"ask" text,
	"reason" varchar(16),
	"note" text,
	"llm" jsonb,
	"slot" timestamp with time zone,
	"external_id" varchar(255),
	"url" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_id" uuid,
	"ref" varchar(200),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_draft_events" PRIMARY KEY("id"),
	CONSTRAINT "uq_draft_events_ref" UNIQUE("ref"),
	CONSTRAINT "ck_draft_events_kind" CHECK (("kind")::text = ANY ((ARRAY['post'::character varying, 'comment'::character varying, 'thread'::character varying, 'dm'::character varying, 'invite'::character varying, 'video'::character varying, 'invite_note'::character varying, 'linkedin_comment'::character varying])::text[])),
	CONSTRAINT "ck_draft_events_event" CHECK (("event")::text = ANY ((ARRAY['generated'::character varying, 'edited'::character varying, 'approved'::character varying, 'rejected'::character varying, 'scheduled'::character varying, 'sent'::character varying, 'failed'::character varying])::text[])),
	CONSTRAINT "ck_draft_events_via" CHECK (("via")::text = ANY ((ARRAY['model'::character varying, 'person'::character varying, 'claude'::character varying, 'wren'::character varying])::text[])),
	CONSTRAINT "ck_draft_events_reason" CHECK (("reason")::text = ANY ((ARRAY['voice'::character varying, 'facts'::character varying, 'length'::character varying, 'salesy'::character varying, 'topic'::character varying, 'timing'::character varying, 'repeat'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "content_metrics" ADD COLUMN "follows" integer;--> statement-breakpoint
CREATE INDEX "ix_draft_events_item_id" ON "draft_events" USING btree ("item","id");--> statement-breakpoint
CREATE INDEX "ix_draft_events_kind_at" ON "draft_events" USING btree ("kind","at");