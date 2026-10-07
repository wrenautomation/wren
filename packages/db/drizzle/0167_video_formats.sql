ALTER TABLE "video_edits" ADD COLUMN "formats" jsonb DEFAULT '["long"]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "video_edits" SET "formats" = '["vertical"]'::jsonb WHERE ("tracks"->'main'->>'height')::numeric > ("tracks"->'main'->>'width')::numeric;
