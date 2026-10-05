ALTER TABLE "topics" ADD COLUMN "keyword" varchar(32);--> statement-breakpoint
CREATE INDEX "ix_consents_topic_id" ON "consents" USING btree ("topic_id");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "uq_topics_keyword" UNIQUE("keyword");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "ck_topics_keyword" CHECK ("topics"."keyword" IS NULL OR ("topics"."channel" = 'sms' AND "topics"."keyword" ~ '^[A-Z0-9]{2,32}$'));