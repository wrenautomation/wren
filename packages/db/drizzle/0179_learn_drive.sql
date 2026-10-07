CREATE TABLE "learn"."collections" (
	"id" serial NOT NULL,
	"name" varchar(80) NOT NULL,
	"parent_id" integer,
	"by" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_collections" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "learn"."item_tags" (
	"item_id" integer NOT NULL,
	"tag" varchar(40) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_item_tags" PRIMARY KEY("item_id","tag")
);
--> statement-breakpoint
DROP VIEW "learn"."item_records";--> statement-breakpoint
DROP VIEW "learn"."saved_records";--> statement-breakpoint
DROP VIEW "learn"."source_records";--> statement-breakpoint
ALTER TABLE "learn"."items" RENAME COLUMN "done_at" TO "archived_at";--> statement-breakpoint
ALTER TABLE "learn"."sources" DROP CONSTRAINT "ck_learn_sources_kind";--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "type" varchar(12) DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "duration" integer;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "media_url" text;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "moments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "played_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "starred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "later_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "collection_id" integer;--> statement-breakpoint
ALTER TABLE "learn"."sources" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "learn"."collections" ADD CONSTRAINT "fk_collections_parent_id_collections" FOREIGN KEY ("parent_id") REFERENCES "learn"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."item_tags" ADD CONSTRAINT "fk_item_tags_item_id_items" FOREIGN KEY ("item_id") REFERENCES "learn"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_learn_collections_parent" ON "learn"."collections" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_learn_item_tags_tag" ON "learn"."item_tags" USING btree ("tag");--> statement-breakpoint
ALTER TABLE "learn"."items" ADD CONSTRAINT "fk_items_collection_id_collections" FOREIGN KEY ("collection_id") REFERENCES "learn"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_learn_items_collection" ON "learn"."items" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "ix_learn_items_type" ON "learn"."items" USING btree ("type");--> statement-breakpoint
ALTER TABLE "learn"."items" ADD CONSTRAINT "ck_learn_items_type" CHECK (("type")::text = ANY ((ARRAY['youtube'::character varying, 'shorts'::character varying, 'podcast'::character varying, 'newsletter'::character varying, 'blog'::character varying, 'reddit'::character varying, 'x'::character varying, 'instagram'::character varying, 'tiktok'::character varying, 'releases'::character varying, 'link'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "learn"."sources" ADD CONSTRAINT "ck_learn_sources_kind" CHECK (("kind")::text = ANY ((ARRAY['youtube'::character varying, 'podcast'::character varying, 'newsletter'::character varying, 'blog'::character varying, 'reddit'::character varying, 'forum'::character varying, 'releases'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "learn"."item_records" AS (
    select i.id, i.title, i.kind::text kind, i.type::text type, i.creator,
      coalesce(s.name, 'Saved') source, s.kind::text source_kind, i.source_id,
      i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.archived_at is not null then 'archived'
        when i.read_at is null and i.read_failure is not null then 'failed'
        when i.read_at is null and i.needs_mac is not null then 'mac'
        when i.read_at is null then 'reading'
        when i.verdict is null then 'scoring'
        when i.verdict = 'show' then 'show' when i.verdict = 'hold' then 'hold'
        else 'drop' end state,
      case when i.archived_at is not null then 'archived' when i.opened_at is not null then 'read'
        else 'unread' end status,
      i.read_failure failure,
      (select string_agg(t.tag, ', ' order by t.tag) from learn.item_tags t
        where t.item_id = i.id) tags,
      col.name collection, i.starred_at is not null starred, i.later_at is not null later,
      i.duration,
      (select string_agg(x.sop, ', ' order by x.sop) from learn.sop_sources x
        where x.item_id = i.id) sops,
      coalesce(i.published_at, i.created_at) at, i.saved_at, i.saved_via::text saved_via,
      i.created_at, i.url open,
      length(coalesce(i.transcript, i.text))::int chars
    from learn.items i left join learn.sources s on s.id = i.source_id
      left join learn.collections col on col.id = i.collection_id);--> statement-breakpoint
CREATE VIEW "learn"."saved_records" AS (select * from (
    select i.id, i.title, i.kind::text kind, i.type::text type, i.creator,
      coalesce(s.name, 'Saved') source, s.kind::text source_kind, i.source_id,
      i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.archived_at is not null then 'archived'
        when i.read_at is null and i.read_failure is not null then 'failed'
        when i.read_at is null and i.needs_mac is not null then 'mac'
        when i.read_at is null then 'reading'
        when i.verdict is null then 'scoring'
        when i.verdict = 'show' then 'show' when i.verdict = 'hold' then 'hold'
        else 'drop' end state,
      case when i.archived_at is not null then 'archived' when i.opened_at is not null then 'read'
        else 'unread' end status,
      i.read_failure failure,
      (select string_agg(t.tag, ', ' order by t.tag) from learn.item_tags t
        where t.item_id = i.id) tags,
      col.name collection, i.starred_at is not null starred, i.later_at is not null later,
      i.duration,
      (select string_agg(x.sop, ', ' order by x.sop) from learn.sop_sources x
        where x.item_id = i.id) sops,
      coalesce(i.published_at, i.created_at) at, i.saved_at, i.saved_via::text saved_via,
      i.created_at, i.url open,
      length(coalesce(i.transcript, i.text))::int chars
    from learn.items i left join learn.sources s on s.id = i.source_id
      left join learn.collections col on col.id = i.collection_id) x where x.saved_at is not null);--> statement-breakpoint
CREATE VIEW "learn"."source_records" AS (
    select s.id, s.name, s.url, s.page, s.kind::text kind, s.avatar_url, s.tell::text tell,
      case when s.stopped_at is not null then 'stopped' when s.failure is not null then 'failing'
        else 'following' end state,
      count(i.id)::int items, (count(i.id) filter (where i.verdict = 'show'))::int shown,
      s.fetched_at, s.failure, s.by::text by, s.created_at
    from learn.sources s left join learn.items i on i.source_id = s.id
    group by s.id);--> statement-breakpoint
-- Backfill: each source's kind by its host, each item's type, YouTube thumbnails.
UPDATE "learn"."sources" SET "kind" = 'reddit' WHERE "url" ~* '^https?://([^/]*\.)?reddit\.com/';--> statement-breakpoint
UPDATE "learn"."sources" SET "kind" = 'newsletter'
  WHERE "kind" = 'blog' AND "url" ~* '^https?://([^/]*\.)?(substack\.com|beehiiv\.com|buttondown\.(email|com))/';--> statement-breakpoint
UPDATE "learn"."items" i SET "type" = CASE
    WHEN i."url" ~* '^https?://([^/]*\.)?youtube\.com/shorts/' THEN 'shorts'
    WHEN i."url" ~* '^https?://([^/]*\.)?(youtube\.com|youtu\.be)/' THEN 'youtube'
    WHEN i."url" ~* '^https?://([^/]*\.)?instagram\.com/' THEN 'instagram'
    WHEN i."url" ~* '^https?://([^/]*\.)?tiktok\.com/' THEN 'tiktok'
    WHEN i."url" ~* '^https?://([^/]*\.)?(x\.com|twitter\.com)/' THEN 'x'
    WHEN i."url" ~* '^https?://([^/]*\.)?reddit\.com/' OR s."kind" = 'reddit' THEN 'reddit'
    WHEN i."kind" = 'episode' OR s."kind" = 'podcast' THEN 'podcast'
    WHEN s."kind" = 'newsletter'
      OR i."url" ~* '^https?://([^/]*\.)?(substack\.com|beehiiv\.com|buttondown\.(email|com))/' THEN 'newsletter'
    WHEN s."kind" = 'releases' THEN 'releases'
    WHEN s."kind" = 'youtube' THEN 'youtube'
    WHEN s."kind" IN ('blog', 'forum') THEN 'blog'
    ELSE 'link' END
  FROM "learn"."items" j LEFT JOIN "learn"."sources" s ON s."id" = j."source_id"
  WHERE j."id" = i."id";--> statement-breakpoint
UPDATE "learn"."items" SET "thumbnail_url" = 'https://i.ytimg.com/vi/' || coalesce(
    substring("url" from '[?&]v=([A-Za-z0-9_-]{6,})'),
    substring("url" from '/shorts/([A-Za-z0-9_-]{6,})'),
    substring("url" from 'youtu\.be/([A-Za-z0-9_-]{6,})')) || '/hqdefault.jpg'
  WHERE "type" IN ('youtube', 'shorts') AND "thumbnail_url" IS NULL
    AND coalesce(substring("url" from '[?&]v=([A-Za-z0-9_-]{6,})'),
      substring("url" from '/shorts/([A-Za-z0-9_-]{6,})'),
      substring("url" from 'youtu\.be/([A-Za-z0-9_-]{6,})')) IS NOT NULL;
