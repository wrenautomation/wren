DROP VIEW "learn"."standards";--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "check" jsonb;--> statement-breakpoint
ALTER TABLE "content_playbooks" ADD COLUMN "scope" jsonb;--> statement-breakpoint
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