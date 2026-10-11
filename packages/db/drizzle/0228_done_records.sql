CREATE VIEW "public"."done_records" AS (
  select e.id, e.item, e.kind, e.platform, e.event, e.via, e.by,
    coalesce(nullif(e.title, ''), left(regexp_replace(e.text, '[[:space:]]+', ' ', 'g'), 140), e.item) what,
    e.text words, e.note, e.url,
    case split_part(e.item, ':', 1)
      when 'draft' then '/marketing/drafts/' when 'comment' then '/marketing/comments/'
      when 'thread' then '/marketing/threads/' when 'video' then '/marketing/videos/'
      when 'dm' then '/marketing/dms/' when 'invite' then '/marketing/dms/'
      when 'note' then '/marketing/dms/' end || split_part(e.item, ':', 2) as open,
    e.at,
    case when e.at >= (date_trunc('day', now() at time zone 'America/New_York')
        at time zone 'America/New_York') then 'today'
      when e.at >= now() - interval '7 days' then 'week' else 'older' end as day
  from draft_events e
  where e.via in ('person', 'claude') or e.event in ('scheduled', 'sent', 'failed'));