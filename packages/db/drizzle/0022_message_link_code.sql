ALTER TABLE "messages" ADD COLUMN "link_code" varchar(40);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "uq_messages_link_code" UNIQUE("link_code");