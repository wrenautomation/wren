CREATE TABLE "content_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"views" integer NOT NULL,
	"reactions" integer NOT NULL,
	"comments" integer NOT NULL,
	"shares" integer NOT NULL,
	"fetched_with" varchar(16) NOT NULL,
	CONSTRAINT "ck_content_metrics_views_non_negative" CHECK ("views" >= 0),
	CONSTRAINT "ck_content_metrics_reactions_non_negative" CHECK ("reactions" >= 0),
	CONSTRAINT "ck_content_metrics_comments_non_negative" CHECK ("comments" >= 0),
	CONSTRAINT "ck_content_metrics_shares_non_negative" CHECK ("shares" >= 0)
);
--> statement-breakpoint
ALTER TABLE "content_metrics" ADD CONSTRAINT "content_metrics_draft_id_content_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."content_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_content_metrics_draft_id_created_at" ON "content_metrics" USING btree ("draft_id","created_at");