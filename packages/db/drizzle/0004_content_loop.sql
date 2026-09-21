CREATE TABLE "content_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idea_id" uuid NOT NULL,
	"platform" varchar(16) NOT NULL,
	"text" text NOT NULL,
	"title" varchar(200),
	"media" jsonb,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"scheduled_for" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_id" varchar(255),
	"url" varchar(2048),
	"error" text,
	"prompt_version" varchar(16) NOT NULL,
	"llm" jsonb,
	CONSTRAINT "ck_content_drafts_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying])::text[])),
	CONSTRAINT "ck_content_drafts_status" CHECK (("status")::text = ANY ((ARRAY['draft'::character varying, 'approved'::character varying, 'rejected'::character varying, 'publishing'::character varying, 'published'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "content_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"text" text NOT NULL,
	"media" jsonb,
	"source" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	CONSTRAINT "ck_content_ideas_source" CHECK (("source")::text = ANY ((ARRAY['cli'::character varying, 'api'::character varying])::text[])),
	CONSTRAINT "ck_content_ideas_status" CHECK (("status")::text = ANY ((ARRAY['open'::character varying, 'drafted'::character varying, 'archived'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_idea_id_content_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."content_ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_content_drafts_idea_id" ON "content_drafts" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "ix_content_drafts_status_scheduled_for" ON "content_drafts" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "ix_content_drafts_platform_created_at" ON "content_drafts" USING btree ("platform","created_at");--> statement-breakpoint
CREATE INDEX "ix_content_ideas_status_created_at" ON "content_ideas" USING btree ("status","created_at");