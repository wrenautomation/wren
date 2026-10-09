ALTER TABLE "review_asks" ADD COLUMN "via" varchar(8) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_asks" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ix_review_asks_email" ON "review_asks" USING btree ("email");--> statement-breakpoint
ALTER TABLE "review_asks" ADD CONSTRAINT "ck_review_asks_via" CHECK (("via")::text = ANY ((ARRAY['text'::character varying, 'email'::character varying])::text[]));