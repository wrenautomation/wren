ALTER TABLE "sms_contacts" ADD COLUMN "source_ref" varchar(64);--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD CONSTRAINT "uq_sms_contacts_source_ref" UNIQUE("source_kind","source_ref");