ALTER TABLE "comment_keywords" ADD COLUMN "button" varchar(20);--> statement-breakpoint
ALTER TABLE "comment_keywords" ADD COLUMN "followup" text;--> statement-breakpoint
ALTER TABLE "keyword_hits" ADD COLUMN "followed_at" timestamp with time zone;