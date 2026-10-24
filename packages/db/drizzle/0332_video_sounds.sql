ALTER TABLE "video_edits" ADD COLUMN "sounds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "video_edits" ADD COLUMN "music" jsonb;