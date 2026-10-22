-- entry_numbers reads this view, so it is replaced in place (same columns).
CREATE OR REPLACE VIEW "pipeline"."source_numbers" AS (
  with opened as (
    select j.entry source, (j.opened_at at time zone 'UTC')::date as day, count(distinct j.id)::int opened,
      count(d.id)::int deals, coalesce(sum(d.collected_cents), 0)::bigint collected_cents,
      null::float cost
    from pipeline.journeys j left join pipeline.deals d on d.journey = j.id
    group by j.entry, (j.opened_at at time zone 'UTC')::date
  ), newest as (
    select v.run from pipeline.shape_versions v order by v.number desc limit 1
  ), campaigns as (
    select n ->> 'id' source, n ->> 'campaign' campaign
    from newest, jsonb_array_elements(newest.run -> 'nodes') n
    where n ->> 'kind' = 'source' and n ->> 'via' = 'ads' and n ->> 'campaign' is not null
  ), spent as (
    select c.source, a.day, 0 opened, 0 deals, 0::bigint collected_cents, sum(a.spend)::float cost
    from campaigns c join ad_days a on a.campaign_id = c.campaign
      or lower(a.campaign_name) = lower(c.campaign)
      or trim(both '-' from regexp_replace(lower(a.campaign_name), '[^a-z0-9]+', '-', 'g')) = lower(c.campaign)
    group by c.source, a.day
  )
  select source, day, sum(opened)::int opened, sum(deals)::int deals,
    sum(collected_cents)::bigint collected_cents, sum(cost)::float cost
  from (select * from opened union all select * from spent) x
  group by source, day);