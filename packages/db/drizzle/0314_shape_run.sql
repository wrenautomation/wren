-- The graph a version runs, as a column: SQL readers (the numbers views, journeyShape) never lower
-- a metro body. A graph body is its own run. A metro body (none stored yet) has no backfill and
-- fails SET NOT NULL below, on purpose.
-- Views that read the shape drop first (dependents before what they read) and come back reading `run`.
DROP VIEW "pipeline"."stage_flow";--> statement-breakpoint
DROP VIEW "pipeline"."entry_numbers";--> statement-breakpoint
DROP VIEW "pipeline"."edge_flow";--> statement-breakpoint
DROP VIEW "pipeline"."source_numbers";--> statement-breakpoint
ALTER TABLE "pipeline"."shape_versions" ADD COLUMN "run" jsonb;--> statement-breakpoint
-- 0306 refuses an edit of a version. The backfill derives a column, it changes no version, so the guard is off for it alone.
ALTER TABLE "pipeline"."shape_versions" DISABLE TRIGGER "shape_versions_never_edited";--> statement-breakpoint
UPDATE "pipeline"."shape_versions" SET "run" = "body" WHERE "body" ->> 'model' IS NULL;--> statement-breakpoint
ALTER TABLE "pipeline"."shape_versions" ENABLE TRIGGER "shape_versions_never_edited";--> statement-breakpoint
ALTER TABLE "pipeline"."shape_versions" ALTER COLUMN "run" SET NOT NULL;--> statement-breakpoint
CREATE VIEW "pipeline"."edge_flow" AS (
  with arrivals as (
    select substring(e.workflow from '^shape\.v([0-9]+)$')::int version, e.at, e.data
    from events e
    where e.workflow ~ '^shape\.v[0-9]+$' and e.subject like 'journey:%' and left(e.node, 2) = 's_'
      and coalesce(e.data -> 'cause' ->> 'kind', '') <> 'version'
  )
  select a.version, x.edge, ed ->> 'from' from_node, ed ->> 'to' to_node,
    (a.at at time zone 'UTC')::date as day, count(*)::int crossings
  from arrivals a
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(a.data -> 'edges') = 'array'
    then a.data -> 'edges' else '[]'::jsonb end) x(edge)
  join pipeline.shape_versions sv on sv.number = a.version
  join lateral jsonb_array_elements(sv.run -> 'edges') ed on ed ->> 'id' = x.edge
  group by a.version, x.edge, ed ->> 'from', ed ->> 'to', (a.at at time zone 'UTC')::date);--> statement-breakpoint
CREATE VIEW "pipeline"."source_numbers" AS (
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
    group by c.source, a.day
  )
  select source, day, sum(opened)::int opened, sum(deals)::int deals,
    sum(collected_cents)::bigint collected_cents, sum(cost)::float cost
  from (select * from opened union all select * from spent) x
  group by source, day);--> statement-breakpoint
CREATE VIEW "pipeline"."entry_numbers" AS (
  select 'shape'::varchar(40) funnel, s.source entry, s.day, s.opened, s.deals, s.collected_cents,
    s.cost
  from pipeline.source_numbers s);--> statement-breakpoint
CREATE VIEW "pipeline"."stage_flow" AS (
  with newest as (
    select v.run from pipeline.shape_versions v order by v.number desc limit 1
  ), pairs as (
    select ed ->> 'from' stage, ed ->> 'to' next_stage
    from newest, jsonb_array_elements(newest.run -> 'edges') ed
    where ed ->> 'kind' = 'flow'
  ), reached as (
    select node, sum(arrived)::int n from pipeline.node_counts group by node
  ), advanced as (
    select from_node, to_node, sum(crossings)::int n from pipeline.edge_flow group by from_node, to_node
  )
  select 'shape'::varchar(40) funnel, p.stage, p.next_stage, coalesce(r.n, 0) reached,
    coalesce(a.n, 0) advanced,
    case when coalesce(r.n, 0) > 0 then coalesce(a.n, 0)::float / r.n end conversion,
    null::float median_seconds
  from pairs p
  left join reached r on r.node = p.stage
  left join advanced a on a.from_node = p.stage and a.to_node = p.next_stage);
