CREATE VIEW "pipeline"."entry_numbers" AS (
  with opened as (
    select j.funnel, j.entry, (j.opened_at at time zone 'UTC')::date as day, count(*)::int opened,
      count(d.id)::int deals, coalesce(sum(d.collected_cents), 0)::bigint collected_cents,
      null::float cost
    from pipeline.journeys j left join pipeline.deals d on d.journey = j.id
    group by j.funnel, j.entry, (j.opened_at at time zone 'UTC')::date
  ), newest as (
    select distinct on (v.funnel) v.funnel, v.body
    from pipeline.funnel_versions v order by v.funnel, v.number desc
  ), campaigns as (
    select n.funnel, en ->> 'id' entry, en ->> 'campaign' campaign
    from newest n, jsonb_array_elements(n.body -> 'entries') en
    where en ->> 'kind' = 'ads' and en ->> 'campaign' is not null
  ), spent as (
    select c.funnel, c.entry, a.day, 0 opened, 0 deals, 0::bigint collected_cents,
      sum(a.spend)::float cost
    from campaigns c join ad_days a on a.campaign_id = c.campaign
    group by c.funnel, c.entry, a.day
  )
  select funnel, entry, day, sum(opened)::int opened, sum(deals)::int deals,
    sum(collected_cents)::bigint collected_cents, sum(cost)::float cost
  from (select * from opened union all select * from spent) x
  group by funnel, entry, day);--> statement-breakpoint
CREATE VIEW "pipeline"."stage_counts" AS (
  with arrivals as (
    select substring(e.workflow from '^funnel\.(.+)\.v[0-9]+$') funnel,
      substring(e.workflow from '\.v([0-9]+)$')::int version,
      substr(e.node, 3) stage, e.at, e.data
    from events e
    where e.workflow like 'funnel.%' and e.subject like 'journey:%' and left(e.node, 2) = 's_'
      and coalesce(e.data -> 'cause' ->> 'kind', '') <> 'version'
  ), counted as (
    select funnel, version, stage, (at at time zone 'UTC')::date as day, 1 entered, 0 skipped
    from arrivals
    union all
    select a.funnel, a.version, sk.stage, (a.at at time zone 'UTC')::date as day, 0, 1
    from arrivals a,
      jsonb_array_elements_text(case when jsonb_typeof(a.data -> 'skipped') = 'array'
        then a.data -> 'skipped' else '[]'::jsonb end) sk(stage)
  )
  select funnel, version, stage, day, sum(entered)::int entered, sum(skipped)::int skipped
  from counted group by funnel, version, stage, day);--> statement-breakpoint
CREATE VIEW "pipeline"."stage_flow" AS (
  with newest as (
    select distinct on (v.funnel) v.funnel, v.body
    from pipeline.funnel_versions v order by v.funnel, v.number desc
  ), ordered as (
    select n.funnel, s.stage ->> 'key' key, s.ord
    from newest n, jsonb_array_elements(n.body -> 'stages') with ordinality s(stage, ord)
  ), pairs as (
    select a.funnel, a.key stage, b.key next_stage
    from ordered a join ordered b on b.funnel = a.funnel and b.ord = a.ord + 1
  ), arrivals as (
    select substring(e.workflow from '^funnel\.(.+)\.v[0-9]+$') funnel, e.subject journey,
      substr(e.node, 3) stage, e.at, e.data
    from events e
    where e.workflow like 'funnel.%' and e.subject like 'journey:%' and left(e.node, 2) = 's_'
      and coalesce(e.data -> 'cause' ->> 'kind', '') <> 'version'
  ), reached as (
    select distinct funnel, journey, stage from (
      select funnel, journey, stage from arrivals
      union all
      select a.funnel, a.journey, sk.stage
      from arrivals a,
        jsonb_array_elements_text(case when jsonb_typeof(a.data -> 'skipped') = 'array'
          then a.data -> 'skipped' else '[]'::jsonb end) sk(stage)
    ) x
  ), stays as (
    select funnel, stage,
      extract(epoch from lead(at) over (partition by journey order by at) - at) seconds
    from arrivals
  ), medians as (
    select funnel, stage, percentile_cont(0.5) within group (order by seconds) median
    from stays where seconds is not null group by funnel, stage
  ), counts as (
    select funnel, stage, count(*)::int n from reached group by funnel, stage
  ), advances as (
    select p.funnel, p.stage, count(*)::int n
    from pairs p
    join reached r on r.funnel = p.funnel and r.stage = p.stage
    join reached q on q.funnel = p.funnel and q.journey = r.journey and q.stage = p.next_stage
    group by p.funnel, p.stage
  )
  select p.funnel, p.stage, p.next_stage, coalesce(c.n, 0) reached, coalesce(d.n, 0) advanced,
    case when coalesce(c.n, 0) > 0 then coalesce(d.n, 0)::float / c.n end conversion,
    m.median median_seconds
  from pairs p
  left join counts c on c.funnel = p.funnel and c.stage = p.stage
  left join advances d on d.funnel = p.funnel and d.stage = p.stage
  left join medians m on m.funnel = p.funnel and m.stage = p.stage);