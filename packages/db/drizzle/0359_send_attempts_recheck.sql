ALTER TABLE "send_attempts" ADD COLUMN "recheck_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "send_attempts" ADD COLUMN "recheck_when" varchar(8);--> statement-breakpoint
ALTER TABLE "send_attempts" ADD COLUMN "ask_service" varchar(40);--> statement-breakpoint
ALTER TABLE "send_attempts" ADD COLUMN "ask_key" varchar(200);