ALTER TABLE "video_edits" ADD COLUMN "overlays" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "video_edits" ADD COLUMN "crops" jsonb DEFAULT '{}'::jsonb NOT NULL;