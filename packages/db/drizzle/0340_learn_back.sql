CREATE TABLE "learn"."checks" (
	"item_id" integer NOT NULL,
	"sop" text NOT NULL,
	"path" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"kind" varchar(8) NOT NULL,
	"measure" varchar(12) NOT NULL,
	"with_n" integer NOT NULL,
	"with_median" real NOT NULL,
	"all_n" integer NOT NULL,
	"all_median" real NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_checks" PRIMARY KEY("item_id","sop","path","value"),
	CONSTRAINT "ck_learn_checks_kind" CHECK (("kind")::text = ANY ((ARRAY['article'::character varying, 'video'::character varying, 'reel'::character varying, 'post'::character varying, 'film'::character varying, 'episode'::character varying])::text[])),
	CONSTRAINT "ck_learn_checks_measure" CHECK (("measure")::text = ANY ((ARRAY['hook'::character varying, 'watched'::character varying, 'engagement'::character varying])::text[]))
);
--> statement-breakpoint
DROP VIEW "learn"."standards";--> statement-breakpoint
DROP VIEW "learn"."hook_records";--> statement-breakpoint
DROP VIEW "learn"."breakdown_records";--> statement-breakpoint
ALTER TABLE "learn"."items" ADD COLUMN "draft_id" uuid;--> statement-breakpoint
ALTER TABLE "learn"."checks" ADD CONSTRAINT "fk_checks_item_id_items" FOREIGN KEY ("item_id") REFERENCES "learn"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_learn_checks_sop" ON "learn"."checks" USING btree ("sop");--> statement-breakpoint
ALTER TABLE "learn"."items" ADD CONSTRAINT "uq_learn_items_draft_id" UNIQUE("draft_id");--> statement-breakpoint
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
      i.score::int score, coalesce(i.published_at, i.created_at) at, i.stats_at, i.url open,
      c.calls, c.calls > 0 called,
      case when k.why is not null then 'check' end "check", k.why check_why
    from learn.breakdowns b join learn.items i on i.id = b.item_id
      left join learn.sources s on s.id = i.source_id
      left join lateral (select count(*)::int calls from decision_calls c
        where c.kind = 'learn_fact'
          and (c.subject = 'learn:' || b.item_id or c.subject like 'learn:' || b.item_id || '/%')) c on true
      left join lateral (select string_agg(k.label || ' ' || k.value || ': our ' || k.with_n
          || ' with it ' || m.word || ' ' || round(k.with_median::numeric * 100, 1) || '%, all our '
          || k.all_n || ' ' || m.word || ' ' || round(k.all_median::numeric * 100, 1) || '% (' || k.sop || ')', chr(10)
          order by k.sop, k.path) why
        from learn.checks k
          cross join lateral (select case k.measure when 'hook' then 'hold at 3 s'
            when 'watched' then 'watched' else 'engaged' end word) m
        where k.item_id = b.item_id) k on true
    where i.client = 'wren' and i.draft_id is null);--> statement-breakpoint
CREATE VIEW "learn"."hook_records" AS (
    select r.hook_style id, r.hook_style style, count(*)::int reels, count(distinct r.creator)::int creators,
      (percentile_cont(0.5) within group (order by r.reach))::int median_reach,
      max(r.reach)::int top_reach,
      (array_agg(r.title order by r.reach desc nulls last))[1] top,
      (array_agg(r.creator order by r.reach desc nulls last))[1] top_creator,
      max(r.at) last_at
    from learn.breakdown_records r
    group by r.hook_style);--> statement-breakpoint
CREATE VIEW "learn"."standards" AS (
    select r.id, r.kind, r.type platform, r.creator, r.title, r.reach, r.at, b."by"::text "by",
      r.hook_style, r.cta_kind,
      b.facts->>'format' format, b.facts->>'shape' shape, b.facts->>'link' link,
      (b.facts->>'chars')::int chars, (b.facts->>'lines')::int lines,
      (b.facts->>'first_line_chars')::int first_line_chars, (b.facts->>'hashtags')::int hashtags,
      (b.facts->>'duration_s')::numeric duration_s, (b.facts->>'cuts')::int cuts,
      (b.facts->>'shot_median_s')::numeric shot_median_s, (b.facts->>'shot_p90_s')::numeric shot_p90_s,
      (b.facts->>'first_product_s')::numeric first_product_s, (b.facts->>'logo_s')::numeric logo_s,
      (b.facts->>'cta_s')::numeric cta_s, b.facts->>'cuts_trust' cuts_trust,
      (b.facts->>'music')::boolean music, (b.facts->>'vo')::boolean vo, r.calls
    from learn.breakdown_records r join learn.breakdowns b on b.item_id = r.id
      join learn.items i on i.id = r.id
      left join lateral (select c.label from decision_calls c
        where c.kind = 'learn_fact' and c.subject = 'learn:' || r.id
        order by c.at desc, c.id desc limit 1) his on true
    where i.archived_at is null and his.label is distinct from 'drop'
      and (b."by" = 'hand' or i.saved_by is not null or i.source_id is not null
        or his.label = 'keep'));
