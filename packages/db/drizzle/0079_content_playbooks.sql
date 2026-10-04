CREATE TABLE "content_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform" varchar(16) NOT NULL,
	"sop" varchar(64) NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "ck_content_playbooks_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "playbook_id" uuid;--> statement-breakpoint
CREATE INDEX "ix_content_playbooks_platform_created_at" ON "content_playbooks" USING btree ("platform","created_at");--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_playbook_id_content_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."content_playbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_content_drafts_playbook_id" ON "content_drafts" USING btree ("playbook_id");