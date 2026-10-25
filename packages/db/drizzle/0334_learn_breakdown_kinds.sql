DROP VIEW "learn"."hook_records";--> statement-breakpoint
DROP VIEW "learn"."breakdown_records";--> statement-breakpoint
ALTER TABLE "learn"."items" DROP CONSTRAINT "ck_learn_items_kind";--> statement-breakpoint
ALTER TABLE "learn"."breakdowns" ADD COLUMN "kind" varchar(8);--> statement-breakpoint
ALTER TABLE "learn"."breakdowns" ADD COLUMN "facts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "learn"."breakdowns" b SET "kind" = i."kind", "facts" = jsonb_build_object('format', b."format") FROM "learn"."items" i WHERE i."id" = b."item_id";--> statement-breakpoint
ALTER TABLE "learn"."breakdowns" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_learn_breakdowns_kind" ON "learn"."breakdowns" USING btree ("kind");--> statement-breakpoint
ALTER TABLE "learn"."breakdowns" ADD CONSTRAINT "ck_learn_breakdowns_kind" CHECK (("kind")::text = ANY ((ARRAY['article'::character varying, 'video'::character varying, 'reel'::character varying, 'post'::character varying, 'film'::character varying, 'episode'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "learn"."items" ADD CONSTRAINT "ck_learn_items_kind" CHECK (("kind")::text = ANY ((ARRAY['article'::character varying, 'video'::character varying, 'reel'::character varying, 'post'::character varying, 'film'::character varying, 'episode'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "learn"."breakdown_records" AS (
    select i.id, i.title, coalesce(i.creator, s.name) creator, coalesce(s.name, 'Saved') source,
      i.source_id, case when i.source_id is null then 'saved' else 'followed' end followed,
      i.type::text type, i.kind::text kind, b.hook_style::text hook_style, b.hook, b.hook_why,
      b.topic, b.facts->>'format' format,
      (select string_agg(case when x.value->>'t' is null then '' else
          '[' || ((x.value->>'t')::int / 60) || ':' || lpad(((x.value->>'t')::int % 60)::text, 2, '0') || '] ' end
          || (x.value->>'beat'), chr(10) order by x.ordinality)
        from jsonb_array_elements(b.beats) with ordinality x) beats,
      b.cta_kind::text cta_kind, b.cta,
      (i.stats->>'likes')::int likes, (i.stats->>'comments')::int comments,
      (i.stats->>'views')::int views,
      coalesce((i.stats->>'views')::int,
        nullif(coalesce((i.stats->>'likes')::int, 0) + coalesce((i.stats->>'comments')::int, 0), 0)) reach,
      i.score::int score, coalesce(i.published_at, i.created_at) at, i.stats_at, i.url open
    from learn.breakdowns b join learn.items i on i.id = b.item_id
      left join learn.sources s on s.id = i.source_id
    where i.client = 'wren');--> statement-breakpoint
CREATE VIEW "learn"."hook_records" AS (
    select r.hook_style id, r.hook_style style, count(*)::int reels, count(distinct r.creator)::int creators,
      (percentile_cont(0.5) within group (order by r.reach))::int median_reach,
      max(r.reach)::int top_reach,
      (array_agg(r.title order by r.reach desc nulls last))[1] top,
      (array_agg(r.creator order by r.reach desc nulls last))[1] top_creator,
      max(r.at) last_at
    from learn.breakdown_records r
    group by r.hook_style);
