ALTER TABLE "comments" DROP CONSTRAINT "ck_comments_kind";--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "stars" smallint;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "ck_comments_stars" CHECK (stars IS NULL OR (stars BETWEEN 1 AND 5));--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "ck_comments_kind" CHECK (("kind")::text = ANY ((ARRAY['post_reply'::character varying, 'comment_reply'::character varying, 'username_mention'::character varying, 'review'::character varying])::text[]));
