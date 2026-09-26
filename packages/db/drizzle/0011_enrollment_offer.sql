-- Every enrollment composed before offers existed pitched the free audit (agencies and RIA arms alike).
ALTER TABLE "enrollments" ADD COLUMN "offer" varchar(64);--> statement-breakpoint
UPDATE "enrollments" SET "offer" = 'ops-audit' WHERE "offer" IS NULL;--> statement-breakpoint
ALTER TABLE "enrollments" ALTER COLUMN "offer" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_enrollments_offer" ON "enrollments" USING btree ("offer");
