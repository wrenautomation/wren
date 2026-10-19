-- Business Map, phase A (designs/2026-10-19-business-map.md). Additive: old code keeps running on it.
-- The legacy journey columns (funnel, stage, version) turn nullable and stay until M3 drops them.
CREATE TABLE "pipeline"."shape_versions" (
	"number" integer NOT NULL,
	"body" jsonb NOT NULL,
	"depths" jsonb NOT NULL,
	"note" text NOT NULL,
	"parent" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "pk_shape_versions" PRIMARY KEY("number")
);
--> statement-breakpoint
DROP VIEW "public"."spine_executions";--> statement-breakpoint
DROP VIEW "pipeline"."entry_numbers";--> statement-breakpoint
DROP VIEW "pipeline"."stage_counts";--> statement-breakpoint
DROP VIEW "pipeline"."stage_flow";--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ALTER COLUMN "funnel" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ALTER COLUMN "version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ALTER COLUMN "stage" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ADD COLUMN "shape_version" integer;--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ADD COLUMN "node" varchar(40);--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ADD COLUMN "trail" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline"."deals" ADD COLUMN "node" varchar(40);--> statement-breakpoint
ALTER TABLE "pipeline"."shape_versions" ADD CONSTRAINT "fk_shape_versions_parent_shape_versions" FOREIGN KEY ("parent") REFERENCES "pipeline"."shape_versions"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ADD CONSTRAINT "fk_journeys_shape_version" FOREIGN KEY ("shape_version") REFERENCES "pipeline"."shape_versions"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_journeys_profile_status" ON "pipeline"."journeys" USING btree ("profile_id","status");--> statement-breakpoint
ALTER TABLE "pipeline"."deals" ADD CONSTRAINT "uq_deals_journey_node" UNIQUE("journey","node");--> statement-breakpoint
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
  join lateral jsonb_array_elements(sv.body -> 'edges') ed on ed ->> 'id' = x.edge
  group by a.version, x.edge, ed ->> 'from', ed ->> 'to', (a.at at time zone 'UTC')::date);--> statement-breakpoint
CREATE VIEW "pipeline"."node_counts" AS (
  with arrivals as (
    select substring(e.workflow from '^shape\.v([0-9]+)$')::int version,
      substr(e.node, 3) node, e.at, e.data
    from events e
    where e.workflow ~ '^shape\.v[0-9]+$' and e.subject like 'journey:%' and left(e.node, 2) = 's_'
      and coalesce(e.data -> 'cause' ->> 'kind', '') <> 'version'
  ), counted as (
    select version, node, (at at time zone 'UTC')::date as day, 1 arrived, 0 skipped, 0 "left"
    from arrivals
    union all
    select a.version, sk.node, (a.at at time zone 'UTC')::date, 0, 1, 0
    from arrivals a,
      jsonb_array_elements_text(case when jsonb_typeof(a.data -> 'skipped') = 'array'
        then a.data -> 'skipped' else '[]'::jsonb end) sk(node)
    union all
    select version, data ->> 'from', (at at time zone 'UTC')::date, 0, 0, 1
    from arrivals where data ->> 'from' is not null and data -> 'loop' is null
    union all
    select version, data -> 'loop' ->> 'node', (at at time zone 'UTC')::date, 0, 0, 1
    from arrivals where data -> 'loop' ->> 'node' is not null
    union all
    select coalesce((d.data ->> 'version')::int, substring(d.workflow from '^shape\.v([0-9]+)$')::int),
      d.data ->> 'node', (d.at at time zone 'UTC')::date, 0, 0, 1
    from events d
    where d.workflow ~ '^shape\.v[0-9]+$' and d.node = 'dropped' and d.data ->> 'node' is not null
  )
  select version, node, day, sum(arrived)::int arrived, sum(skipped)::int skipped,
    sum("left")::int "left"
  from counted group by version, node, day);--> statement-breakpoint
CREATE VIEW "pipeline"."source_numbers" AS (
  with opened as (
    select j.entry source, (j.opened_at at time zone 'UTC')::date as day, count(distinct j.id)::int opened,
      count(d.id)::int deals, coalesce(sum(d.collected_cents), 0)::bigint collected_cents,
      null::float cost
    from pipeline.journeys j left join pipeline.deals d on d.journey = j.id
    group by j.entry, (j.opened_at at time zone 'UTC')::date
  ), newest as (
    select v.body from pipeline.shape_versions v order by v.number desc limit 1
  ), campaigns as (
    select n ->> 'id' source, n ->> 'campaign' campaign
    from newest, jsonb_array_elements(newest.body -> 'nodes') n
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
CREATE VIEW "public"."spine_executions" AS (
  select x.*, coalesce(case
      when subject ~ '^mail:[0-9]{1,9}$' then (select coalesce(nullif(m.from_name, ''),
        m.from_address) || ': ' || coalesce(nullif(m.subject, ''), 'Email')
        from watch.mail m where m.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^item:[0-9]{1,9}$' then (select i.title from learn.items i
        where i.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^(lead|reply):sms:[0-9]{1,9}$' then (select coalesce(nullif(s.name, ''),
        c.name, 'Lead') || case when x.subject like 'lead:%' then ': Text lead' else ': Text reply' end
        from sms_contacts s left join companies c on c.id = s.company_id
        where s.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^(lead|reply):reach:[0-9]{1,9}$' then (select coalesce(nullif(r.name, ''),
        r.handle) || case when x.subject like 'lead:%' then ': DM lead' else ': DM reply' end
        from reach_contacts r where r.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^(lead|reply):email:[0-9]{1,9}$' then (select coalesce(nullif(p.full_name, ''),
        c.name, e.to_email) || case when x.subject like 'lead:%' then ': Email lead'
        else ': Email reply' end
        from enrollments e left join people p on p.id = e.person_id
        left join companies c on c.id = e.company_id
        where e.id = split_part(x.subject, ':', 3)::int)
      when subject ~ '^company:[0-9]{1,9}$' then (select c.name from companies c
        where c.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^account:[0-9]{1,9}:' then (select initcap(a.site) || ': ' || a.ref
        from client_accounts a where a.id = split_part(x.subject, ':', 2)::int)
      when subject ~ '^journey:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (select coalesce(nullif(pr.name, ''), 'Someone') || ': ' ||
        coalesce(j.node, j.stage)
        from pipeline.journeys j join profiles pr on pr.id = j.profile_id
        where j.id = substr(x.subject, 9)::uuid)
    end, case split_part(subject, ':', 1) when 'mail' then 'Email' when 'item' then 'Learn item'
      when 'company' then 'Company' when 'account' then 'Account' when 'journey' then 'Journey'
      when 'lead' then case split_part(subject, ':', 2) when 'reach' then 'DM lead'
        when 'email' then 'Email lead' else 'Text lead' end
      when 'reply' then case split_part(subject, ':', 2) when 'reach' then 'DM reply'
        when 'email' then 'Email reply' else 'Text reply' end
    end || ' (gone)', subject) title, who.person, who.firm
  from (select workflow || '/' || subject id, workflow, subject, min(kind) kind,
    case when bool_or(error is not null) then 'failed'
      when bool_or(due is not null) then 'waiting' else 'done' end state,
    (array_agg(node order by (error is not null) desc, (due is not null) desc, at desc))[1] node,
    min(at) entered, max(coalesce(sent_at, at)) last_at, min(due) due,
    (array_agg(until order by due nulls last) filter (where due is not null))[1] until,
    max(error) error, count(*)::int steps
  from events group by workflow, subject) x
  left join lateral (
    select nullif(s.name, '') person, c.name firm from sms_contacts s
      left join companies c on c.id = s.company_id
      where s.id = case when x.subject ~ '^(lead|reply):sms:[0-9]{1,9}$'
        then split_part(x.subject, ':', 3)::int end
    union all
    select coalesce(nullif(r.name, ''), r.handle), c.name from reach_contacts r
      left join companies c on c.id = r.company_id
      where r.id = case when x.subject ~ '^(lead|reply):reach:[0-9]{1,9}$'
        then split_part(x.subject, ':', 3)::int end
    union all
    select coalesce(nullif(p.full_name, ''), e.to_email), c.name from enrollments e
      left join people p on p.id = e.person_id left join companies c on c.id = e.company_id
      where e.id = case when x.subject ~ '^(lead|reply):email:[0-9]{1,9}$'
        then split_part(x.subject, ':', 3)::int end
    union all
    select null, c.name from companies c
      where c.id = case when x.subject ~ '^company:[0-9]{1,9}$'
        then split_part(x.subject, ':', 2)::int end
    union all
    select coalesce(nullif(m.from_name, ''), m.from_address), null from watch.mail m
      where m.id = case when x.subject ~ '^mail:[0-9]{1,9}$'
        then split_part(x.subject, ':', 2)::int end
    union all
    select nullif(pr.name, ''), null from pipeline.journeys j
      join profiles pr on pr.id = j.profile_id
      where j.id = case when x.subject ~ '^journey:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then substr(x.subject, 9)::uuid end
  ) who on true);--> statement-breakpoint
CREATE VIEW "pipeline"."entry_numbers" AS (
  select 'shape'::varchar(40) funnel, s.source entry, s.day, s.opened, s.deals, s.collected_cents,
    s.cost
  from pipeline.source_numbers s);--> statement-breakpoint
CREATE VIEW "pipeline"."stage_counts" AS (
  select 'shape'::varchar(40) funnel, c.version, c.node stage, c.day, c.arrived entered, c.skipped
  from pipeline.node_counts c);--> statement-breakpoint
CREATE VIEW "pipeline"."stage_flow" AS (
  with newest as (
    select v.body from pipeline.shape_versions v order by v.number desc limit 1
  ), pairs as (
    select ed ->> 'from' stage, ed ->> 'to' next_stage
    from newest, jsonb_array_elements(newest.body -> 'edges') ed
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
  left join advanced a on a.from_node = p.stage and a.to_node = p.next_stage);--> statement-breakpoint
-- A shape version is never edited or deleted, as with the funnel versions before it.
CREATE TRIGGER "shape_versions_never_edited" BEFORE UPDATE OR DELETE ON "pipeline"."shape_versions" FOR EACH ROW EXECUTE FUNCTION "pipeline"."never_edited"();--> statement-breakpoint
-- A journey opening or moving wakes the segments pass (0298). Its place is now `node`, so the
-- trigger watches it too. A version carry sets `version` only and wakes nothing.
DROP TRIGGER journeys_segments_wake ON pipeline.journeys;--> statement-breakpoint
CREATE TRIGGER journeys_segments_wake AFTER INSERT OR UPDATE OF node, stage, status ON pipeline.journeys
  FOR EACH STATEMENT EXECUTE FUNCTION wren_wake('Segments/fleet');
