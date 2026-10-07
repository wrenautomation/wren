DROP VIEW "public"."marketing_draft_records";--> statement-breakpoint
ALTER TABLE "content_ideas" DROP CONSTRAINT "ck_content_ideas_source";--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "stage" varchar(16) DEFAULT 'reach' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "points_to" varchar(16) DEFAULT 'site' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "video_draft" uuid;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "linked" boolean;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "fk_content_drafts_video_draft_content_drafts" FOREIGN KEY ("video_draft") REFERENCES "public"."content_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_content_drafts_video_draft" ON "content_drafts" USING btree ("video_draft");--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "ck_content_drafts_stage" CHECK (("stage")::text = ANY ((ARRAY['reach'::character varying, 'trust'::character varying, 'convert'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "ck_content_drafts_points_to" CHECK (("points_to")::text = ANY ((ARRAY['video'::character varying, 'site'::character varying, 'booking'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "ck_content_ideas_source" CHECK (("source")::text = ANY ((ARRAY['cli'::character varying, 'api'::character varying, 'ads'::character varying, 'build_log'::character varying, 'question'::character varying, 'promo'::character varying])::text[]));--> statement-breakpoint
-- A video's long upload builds trust; its Shorts and Reels point at it.
UPDATE "content_drafts" SET "stage" = 'trust' WHERE "platform" = 'youtube' AND coalesce("extra"->>'kind', 'video') = 'video';--> statement-breakpoint
UPDATE "content_drafts" d SET "points_to" = 'video', "video_draft" = v."id"
  FROM "content_ideas" i, "content_ideas" vi, "content_drafts" v
  WHERE i."id" = d."idea_id" AND i."ref" LIKE 'video:%/%' AND vi."ref" = split_part(i."ref", '/', 1)
    AND v."idea_id" = vi."id" AND v."platform" = 'youtube';--> statement-breakpoint
CREATE VIEW "public"."marketing_draft_records" AS (
  select d.id::text id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title, d.text,
    d.status::text state, length(d.text) chars,
    case when d.edited then 'edited' else 'model' end written, d.note, d.error,
    d.stage::text stage, d.points_to::text "to",
    d.scheduled_for scheduled, d.created_at created
  from content_drafts d
  where d.status <> 'published');