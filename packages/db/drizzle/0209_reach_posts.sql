-- Others' posts on LinkedIn, X and Instagram (was linkedin_posts): platform + ref keys a post,
-- the author's handle, our like and follow. Draft records and touches move with it.
ALTER TABLE "linkedin_posts" RENAME TO "reach_posts";--> statement-breakpoint
ALTER SEQUENCE "linkedin_posts_id_seq" RENAME TO "reach_posts_id_seq";--> statement-breakpoint
ALTER TABLE "reach_posts" RENAME COLUMN "urn" TO "ref";--> statement-breakpoint
ALTER TABLE "reach_posts" RENAME CONSTRAINT "pk_linkedin_posts" TO "pk_reach_posts";--> statement-breakpoint
ALTER TABLE "reach_posts" RENAME CONSTRAINT "ck_linkedin_posts_state" TO "ck_reach_posts_state";--> statement-breakpoint
ALTER INDEX "ix_linkedin_posts_state" RENAME TO "ix_reach_posts_state";--> statement-breakpoint
ALTER TABLE "reach_posts" DROP CONSTRAINT "uq_linkedin_posts_urn";--> statement-breakpoint
ALTER TABLE "reach_posts" ADD COLUMN "platform" varchar(12) DEFAULT 'linkedin' NOT NULL;--> statement-breakpoint
ALTER TABLE "reach_posts" ADD COLUMN "handle" varchar(120);--> statement-breakpoint
ALTER TABLE "reach_posts" ADD COLUMN "liked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reach_posts" ADD COLUMN "followed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reach_posts" ADD CONSTRAINT "uq_reach_posts_platform_ref" UNIQUE("platform","ref");--> statement-breakpoint
ALTER TABLE "reach_posts" ADD CONSTRAINT "ck_reach_posts_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'x'::character varying, 'instagram'::character varying])::text[]));--> statement-breakpoint
UPDATE "reach_posts" SET "handle" = lower(substring("author_url" from 'linkedin\.com/in/([^/?#]+)')) WHERE "author_url" ~* 'linkedin\.com/in/';--> statement-breakpoint
ALTER TABLE "draft_events" DROP CONSTRAINT "ck_draft_events_kind";--> statement-breakpoint
UPDATE "draft_events" SET "kind" = 'post_comment' WHERE "kind" = 'linkedin_comment';--> statement-breakpoint
UPDATE "draft_events" SET "item" = 'onpost:' || substring("item" from 8) WHERE "item" LIKE 'lipost:%';--> statement-breakpoint
UPDATE "draft_events" SET "ref" = 'sent:onpost:' || substring("ref" from 13) WHERE "ref" LIKE 'sent:lipost:%';--> statement-breakpoint
ALTER TABLE "draft_events" ADD CONSTRAINT "ck_draft_events_kind" CHECK (("kind")::text = ANY ((ARRAY['post'::character varying, 'comment'::character varying, 'thread'::character varying, 'dm'::character varying, 'invite'::character varying, 'video'::character varying, 'invite_note'::character varying, 'post_comment'::character varying])::text[]));--> statement-breakpoint
UPDATE "runs" SET "argv" = jsonb_set("argv", '{record}', '"onpost"') WHERE "argv"->>'record' = 'lipost';--> statement-breakpoint
UPDATE "runs" SET "argv" = jsonb_set("argv", '{item}', to_jsonb('onpost:' || substring("argv"->>'item' from 8))) WHERE "argv"->>'item' LIKE 'lipost:%';--> statement-breakpoint
UPDATE "touches" SET "ref" = 'rp:' || substring("ref" from 4), "source" = 'reach_posts' WHERE "ref" LIKE 'lp:%';
--> statement-breakpoint
UPDATE "wren_settings" SET "settings" = ("settings" - 'companies') || jsonb_build_object('pages', "settings"->'companies') WHERE "component" = 'linkedin.comments' AND "settings"->'companies' IS NOT NULL;
