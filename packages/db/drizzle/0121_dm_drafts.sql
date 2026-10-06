ALTER TABLE "reach_contacts" ADD COLUMN "draft" text;--> statement-breakpoint
ALTER TABLE "reach_contacts" ADD COLUMN "draft_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reach_contacts" ADD COLUMN "draft_for" integer;