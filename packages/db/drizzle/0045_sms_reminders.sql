ALTER TABLE "sms_messages" DROP CONSTRAINT "ck_sms_messages_messagekind";--> statement-breakpoint
ALTER TABLE "sms_messages" ADD COLUMN "ref" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_messages_reminder_ref" ON "sms_messages" USING btree ("template","ref") WHERE (kind)::text = 'reminder'::text;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "ck_sms_messages_messagekind" CHECK (("kind")::text = ANY ((ARRAY['sequence'::character varying, 'manual'::character varying, 'reminder'::character varying, 'inbound'::character varying])::text[]));