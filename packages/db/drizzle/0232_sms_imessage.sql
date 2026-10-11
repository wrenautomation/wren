ALTER TABLE "sms_contacts" ADD COLUMN "imessage" boolean;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD COLUMN "service" varchar(8);--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "ck_sms_messages_service" CHECK (("service")::text = ANY ((ARRAY['imessage'::character varying, 'rcs'::character varying, 'sms'::character varying])::text[]));--> statement-breakpoint
-- Every text so far went by Telnyx: green.
UPDATE "sms_messages" SET "service" = 'sms' WHERE "provider_id" IS NOT NULL;