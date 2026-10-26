-- Pain points line (designs/2026-10-25-ingestion-engine.md, phase 3): per source, the journeys that
-- replied (moved on a touch or reply of theirs) and booked. entry_numbers reads this view, so it is
-- replaced in place (columns added at the end).
CREATE OR REPLACE VIEW "pipeline"."source_numbers" AS (
  with moved as (
    select substr(e.subject, 9) journey,
      bool_or(e.data -> 'cause' ->> 'kind' in ('touch', 'reply')) replied,
      bool_or(e.data -> 'cause' ->> 'kind' = 'booking') booked
    from events e
    where e.workflow ~ '^shape\.v[0-9]+$' and e.subject like 'journey:%' and left(e.node, 2) = 's_'
      and e.data ->> 'from' is not null
    group by 1
  ), opened as (
    select j.entry source, (j.opened_at at time zone 'UTC')::date as day, count(distinct j.id)::int opened,
      count(d.id)::int deals, coalesce(sum(d.collected_cents), 0)::bigint collected_cents,
      null::float cost, count(distinct j.id) filter (where m.replied)::int replied,
      count(distinct j.id) filter (where m.booked)::int booked
    from pipeline.instances j left join pipeline.deals d on d.journey = j.id
      left join moved m on m.journey = j.id::text
    group by j.entry, (j.opened_at at time zone 'UTC')::date
  ), newest as (
    select v.run from pipeline.shape_versions v order by v.number desc limit 1
  ), campaigns as (
    select n ->> 'id' source, n ->> 'campaign' campaign
    from newest, jsonb_array_elements(newest.run -> 'nodes') n
    where n ->> 'kind' = 'source' and n ->> 'via' = 'ads' and n ->> 'campaign' is not null
  ), spent as (
    select c.source, a.day, 0 opened, 0 deals, 0::bigint collected_cents, sum(a.spend)::float cost,
      0 replied, 0 booked
    from campaigns c join ad_days a on a.campaign_id = c.campaign
      or lower(a.campaign_name) = lower(c.campaign)
      or trim(both '-' from regexp_replace(lower(a.campaign_name), '[^a-z0-9]+', '-', 'g')) = lower(c.campaign)
    group by c.source, a.day
  )
  select source, day, sum(opened)::int opened, sum(deals)::int deals,
    sum(collected_cents)::bigint collected_cents, sum(cost)::float cost,
    sum(replied)::int replied, sum(booked)::int booked
  from (select * from opened union all select * from spent) x
  group by source, day);