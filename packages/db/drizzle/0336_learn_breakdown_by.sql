ALTER TABLE "learn"."breakdowns" ADD COLUMN "by" varchar(8) DEFAULT 'model' NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."breakdowns" ADD CONSTRAINT "ck_learn_breakdowns_by" CHECK (("by")::text = ANY ((ARRAY['model'::character varying, 'hand'::character varying])::text[]));--> statement-breakpoint
-- A creator's image and text posts were saved as articles before `post` existed (0334 did not re-kind items).
UPDATE "learn"."items" SET "kind" = 'post' WHERE "kind" = 'article' AND "type" IN ('instagram', 'x') AND "url" ~ '/(p|status|post)/';
