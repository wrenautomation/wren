ALTER TABLE "creator_posts" DROP CONSTRAINT "ck_creator_posts_kind";--> statement-breakpoint
ALTER TABLE "creator_posts" ALTER COLUMN "kind" SET DATA TYPE varchar(16);