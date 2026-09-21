ALTER TABLE "content_drafts" ADD COLUMN "redraft_of" uuid;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_redraft_of_content_drafts_id_fk" FOREIGN KEY ("redraft_of") REFERENCES "public"."content_drafts"("id") ON DELETE set null ON UPDATE no action;