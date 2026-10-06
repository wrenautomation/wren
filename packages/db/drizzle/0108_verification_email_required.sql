ALTER TABLE "verifications" DROP CONSTRAINT "ck_verifications_attributed";--> statement-breakpoint
ALTER TABLE "verifications" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "ck_verifications_email_lowercase" CHECK (email = lower(email));