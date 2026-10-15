ALTER TABLE "mail_bounce_reads" ALTER COLUMN "read_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_bounce_reads" ADD COLUMN "last_sender_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- A mailbox last read is a mailbox that last sent, as far as anyone knows.
UPDATE "mail_bounce_reads" SET "last_sender_at" = "read_at" WHERE "read_at" IS NOT NULL;