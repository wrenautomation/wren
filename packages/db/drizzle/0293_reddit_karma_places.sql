ALTER TABLE "reddit_places" ADD COLUMN "purpose" varchar(16) DEFAULT 'reach' NOT NULL;--> statement-breakpoint
ALTER TABLE "reddit_places" ADD CONSTRAINT "ck_reddit_places_purpose" CHECK (("purpose")::text = ANY ((ARRAY['reach'::character varying, 'karma'::character varying])::text[]));
