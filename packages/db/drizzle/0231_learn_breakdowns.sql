CREATE TABLE "learn"."breakdowns" (
	"item_id" integer NOT NULL,
	"hook_style" varchar(16) NOT NULL,
	"hook" text NOT NULL,
	"hook_why" text NOT NULL,
	"topic" text NOT NULL,
	"format" varchar(16) NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta_kind" varchar(12) NOT NULL,
	"cta" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_breakdowns" PRIMARY KEY("item_id"),
	CONSTRAINT "ck_learn_breakdowns_hook_style" CHECK (("hook_style")::text = ANY ((ARRAY['contrarian'::character varying, 'demo-first'::character varying, 'result-first'::character varying, 'identity-call'::character varying, 'list-tease'::character varying, 'question'::character varying, 'story'::character varying, 'warning'::character varying, 'news'::character varying, 'how-to'::character varying, 'pattern-break'::character varying, 'other'::character varying])::text[])),
	CONSTRAINT "ck_learn_breakdowns_format" CHECK (("format")::text = ANY ((ARRAY['talking-head'::character varying, 'screen-demo'::character varying, 'voiceover'::character varying, 'text-on-screen'::character varying, 'mixed'::character varying])::text[])),
	CONSTRAINT "ck_learn_breakdowns_cta_kind" CHECK (("cta_kind")::text = ANY ((ARRAY['comment-word'::character varying, 'follow'::character varying, 'link'::character varying, 'dm'::character varying, 'save-share'::character varying, 'none'::character varying, 'other'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "stats" jsonb;--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "stats_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learn"."breakdowns" ADD CONSTRAINT "fk_breakdowns_item_id_items" FOREIGN KEY ("item_id") REFERENCES "learn"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_learn_breakdowns_hook_style" ON "learn"."breakdowns" USING btree ("hook_style");--> statement-breakpoint
CREATE VIEW "learn"."breakdown_records" AS (
    select i.id, i.title, coalesce(i.creator, s.name) creator, coalesce(s.name, 'Saved') source,
      i.source_id, case when i.source_id is null then 'saved' else 'followed' end followed,
      i.type::text type, i.kind::text kind, b.hook_style::text hook_style, b.hook, b.hook_why,
      b.topic, b.format::text format,
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