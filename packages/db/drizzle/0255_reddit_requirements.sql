CREATE TABLE "reddit_requirements" (
	"subreddit" varchar(64) NOT NULL,
	"source" varchar(16) NOT NULL,
	"min_age_days" integer,
	"min_karma" integer,
	"min_comment_karma" integer,
	"other" text,
	"hold" boolean DEFAULT false NOT NULL,
	"item" varchar(80),
	"evidence" text,
	"learned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "pk_reddit_requirements" PRIMARY KEY("subreddit","source"),
	CONSTRAINT "ck_reddit_requirements_source" CHECK (("source")::text = ANY ((ARRAY['removal'::character varying, 'rules'::character varying, 'manual'::character varying])::text[])),
	CONSTRAINT "ck_reddit_requirements_floors" CHECK (coalesce("reddit_requirements"."min_age_days", 0) >= 0 and coalesce("reddit_requirements"."min_karma", 0) >= 0 and coalesce("reddit_requirements"."min_comment_karma", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "reddit_requirements" ADD CONSTRAINT "fk_reddit_requirements_subreddit_reddit_places" FOREIGN KEY ("subreddit") REFERENCES "public"."reddit_places"("subreddit") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 2026-10-14: AutoModerator removed our comment in r/SalesTechniques (thread:t3_1x5mdo1): the
-- account must be 10+ days old with 50+ karma. Seeded where the place is known.
INSERT INTO "reddit_requirements" ("subreddit", "source", "min_age_days", "min_karma", "item", "evidence")
SELECT "subreddit", 'removal', 10, 50, 'thread:t3_1x5mdo1',
  'AutoModerator removed our comment 2026-10-14: account must be 10+ days old with 50+ karma'
FROM "reddit_places" WHERE "subreddit" = 'salestechniques'
ON CONFLICT DO NOTHING;
