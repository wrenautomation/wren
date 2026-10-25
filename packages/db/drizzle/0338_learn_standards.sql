DROP VIEW "learn"."hook_records";
--> statement-breakpoint
DROP VIEW "learn"."breakdown_records";--> statement-breakpoint
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
      c.calls, c.calls > 0 called
    from learn.breakdowns b join learn.items i on i.id = b.item_id
      left join learn.sources s on s.id = i.source_id
      left join lateral (select count(*)::int calls from decision_calls c
        where c.kind = 'learn_fact'
          and (c.subject = 'learn:' || b.item_id or c.subject like 'learn:' || b.item_id || '/%')) c on true
    where i.client = 'wren');
--> statement-breakpoint
CREATE VIEW "learn"."hook_records" AS (
    select r.hook_style id, r.hook_style style, count(*)::int reels, count(distinct r.creator)::int creators,
      (percentile_cont(0.5) within group (order by r.reach))::int median_reach,
      max(r.reach)::int top_reach,
      (array_agg(r.title order by r.reach desc nulls last))[1] top,
      (array_agg(r.creator order by r.reach desc nulls last))[1] top_creator,
      max(r.at) last_at
    from learn.breakdown_records r
    group by r.hook_style);
--> statement-breakpoint
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
    from learn.breakdown_records r join learn.breakdowns b on b.item_id = r.id);
