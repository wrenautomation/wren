ALTER TABLE "note_mentions" ADD COLUMN "mailed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ix_note_mentions_unmailed" ON "note_mentions" USING btree ("at") WHERE "note_mentions"."mailed_at" is null and "note_mentions"."seen_at" is null;--> statement-breakpoint
-- Mentions made before mail existed are not mailed now.
UPDATE "note_mentions" SET "mailed_at" = "at" WHERE "mailed_at" IS NULL;
