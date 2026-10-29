ALTER TABLE "reach_posts" ADD COLUMN "like_fails" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reach_posts" ADD COLUMN "follow_fails" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reach_posts" ADD COLUMN "act_error" text;