DROP VIEW "public"."marketing_post_records";--> statement-breakpoint
CREATE VIEW "public"."marketing_post_records" AS (
  select concat_ws('/', d.idea_id, d.platform, d.id) id, d.platform::text platform,
    coalesce(d.title, left(split_part(d.text, chr(10), 1), 120))::text title,
    d.published_at published, d.stage::text stage, case
      when d.platform = 'youtube' then case d.extra->>'kind' when 'short' then 'short'
        when 'community' then 'post' else 'long' end
      when d.platform = 'tiktok' then 'video'
      when d.platform = 'instagram' and d.extra->>'kind' = 'video' then 'reel'
      when (d.platform = 'instagram' and d.extra->>'kind' = 'carousel')
        or (d.platform = 'linkedin' and d.extra->>'kind' = 'document') then 'carousel'
      when d.platform = 'x' and d.extra->>'kind' = 'thread' then 'thread'
      when d.platform = 'facebook' and d.media->>'kind' = 'video' then 'reel'
      when d.platform in ('x', 'linkedin') and d.media->>'kind' = 'video' then 'video'
      else 'post' end format,
    m.views, m.reactions, m.comments, m.shares,
    m.reactions + m.comments + m.shares engaged,
    case when m.views > 0
      then round((m.reactions + m.comments + m.shares) * 100.0 / m.views, 2)::float8 end score,
    i.impressions, i.reach, i.ctr / 100 ctr, i.avg_view_pct / 100 avg_view_pct, i.avg_view_secs,
    i.hold, i.watch_minutes, i.saves, i.follows, i.link_clicks,
    coalesce(l.clicks, 0) clicks, coalesce(l.forms, 0) forms, coalesce(l.calls, 0) calls,
    coalesce(l.won, 0) won, coalesce(l.revenue_first, 0) / 100.0 revenue_first,
    coalesce(l.revenue_last, 0) / 100.0 revenue_last, 'USD'::text currency,
    coalesce(c.theirs, 0) theirs, coalesce(c.answered, 0) answered,
    m.as_of measured, d.url::text url,
    case when d.published_at >= now() - interval '7 days' then 'recent' else 'earlier' end recent
  from content_drafts d
  join content_ideas idea on idea.id = d.idea_id
  left join lateral (
    select c.views, c.reactions, c.comments, c.shares, c.as_of from content_metrics c
    where c.draft_id = d.id order by c.created_at desc limit 1) m on true
  left join lateral (
    select max(v.value) filter (where v.metric = 'impressions') impressions,
      max(v.value) filter (where v.metric = 'reach') reach,
      max(v.value) filter (where v.metric = 'ctr') ctr,
      max(v.value) filter (where v.metric = 'avg_view_pct') avg_view_pct,
      max(v.value) filter (where v.metric = 'avg_view_secs') avg_view_secs,
      max(v.value) filter (where v.metric = 'hold_30s') hold,
      max(v.value) filter (where v.metric = 'watch_minutes') watch_minutes,
      max(v.value) filter (where v.metric = 'saves') saves,
      max(v.value) filter (where v.metric = 'follows') follows,
      max(v.value) filter (where v.metric = 'link_clicks') link_clicks
    from (select distinct on (p.metric) p.metric, p.value from post_metric_days p
      where p.draft_id = d.id and p.key = '' order by p.metric, p.day desc) v) i on true
  left join lateral (
    select sum(k.clicks)::int clicks, sum(k.forms_first)::int forms, sum(k.calls_first)::int calls,
      sum(k.won_first)::int won, sum(k.revenue_first)::int revenue_first,
      sum(k.revenue_last)::int revenue_last
    from link_days k
    where k.content = left(d.id::text, 8)
      or (d.platform = 'youtube' and k.source = 'youtube' and k.content = ''
        and d.extra->>'kind' is distinct from 'short' and substring(idea.ref from '^video:([0-9]+)(~|$)') is not null
        and (k.campaign = substring(idea.ref from '^video:([0-9]+)(~|$)')
          or k.campaign like substring(idea.ref from '^video:([0-9]+)(~|$)') || '-%'))) l on true
  left join lateral (
    select count(*) filter (where o.sort is distinct from 'ours' and o.state <> 'dropped')::int theirs,
      count(*) filter (where o.sort is distinct from 'ours' and o.state = 'answered')::int answered
    from comments o where o.post = d.published_id and o.platform::text = d.platform::text) c on true
  where d.status = 'published');