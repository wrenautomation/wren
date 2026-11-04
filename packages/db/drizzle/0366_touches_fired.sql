ALTER TABLE "touches" ADD COLUMN "fired_at" timestamp with time zone;--> statement-breakpoint
-- WA-1062: history is never told. The last hour stays untold: the old cursor may not have read
-- it, and the executor enters a subject once, so a second tell costs nothing.
UPDATE "touches" SET "fired_at" = "created_at" WHERE "created_at" < now() - interval '1 hour';--> statement-breakpoint
CREATE INDEX "ix_touches_unfired" ON "touches" USING btree ("id") WHERE fired_at IS NULL;
