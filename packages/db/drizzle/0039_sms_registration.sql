ALTER TABLE "sms_numbers" ADD COLUMN "country" varchar(2) DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_numbers" ADD COLUMN "registered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sms_numbers" ADD CONSTRAINT "ck_sms_numbers_country" CHECK (("country")::text = ANY ((ARRAY['US'::character varying, 'CA'::character varying])::text[]));