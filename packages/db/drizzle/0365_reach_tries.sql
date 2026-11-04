ALTER TABLE "reach_messages" ADD COLUMN "tries" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- At least once (designs/2026-11-04-at-least-once.md) is for new sends: unsure rows from before stay a person's.
-- A parked row holds no invocation (parkUnsure now clears it), so Send again can mark it.
UPDATE "send_attempts" SET "tries" = greatest("tries", 2), "invocation" = NULL WHERE "state" = 'unsure';--> statement-breakpoint
-- A DM in flight or unsure before today counts its one try.
UPDATE "reach_messages" SET "tries" = 1 WHERE "state" IN ('sending', 'unknown');
