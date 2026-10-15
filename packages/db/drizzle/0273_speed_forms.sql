ALTER TABLE "speed_runs" DROP CONSTRAINT "ck_speed_runs_first_touch";--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD COLUMN "booking_link" text;--> statement-breakpoint
ALTER TABLE "speed_runs" ADD COLUMN "first_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "speed_runs" ADD COLUMN "email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "speed_runs" ADD COLUMN "email_detail" text;--> statement-breakpoint
ALTER TABLE "speed_runs" ADD COLUMN "notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "speed_runs" ADD CONSTRAINT "ck_speed_runs_first_touch" CHECK (("first_touch")::text = ANY ((ARRAY['queued'::character varying, 'sent'::character varying, 'would_send'::character varying, 'no_consent'::character varying, 'no_phone'::character varying, 'refused'::character varying, 'booked'::character varying])::text[]));