/**
 * The numbers views (designs/2026-10-19-business-map.md). Read only, in schema `pipeline`, over the
 * shape workflows' events and the pipeline tables. No table holds a number.
 *
 * An arrival at node `s_<node>` of `shape.v<n>` is one journey reaching a node, over the edges its
 * data lists. A version carry writes the same arrival again with cause `version`: it is no
 * arrival, so every view skips it. History from before the shape (`funnel.%` workflows) is not
 * counted.
 *
 * `stage_counts`, `stage_flow` and `entry_numbers` are the old views, kept for one release as
 * projections of the new ones (`funnel` is `'shape'`). Nothing new reads them.
 */
import { sql } from "drizzle-orm";
import { bigint, date, doublePrecision, integer, varchar } from "drizzle-orm/pg-core";
import { pipeline } from "./schema.js";

/**
 * Per version, node and day: journeys that arrived at the node, that skipped past it (a move that
 * went over it), and that left it (a move on, a drop, or a loop out).
 */
export const nodeCounts = pipeline
  .view("node_counts", {
    version: integer("version"),
    node: varchar("node", { length: 40 }),
    day: date("day", { mode: "string" }),
    arrived: integer("arrived"),
    skipped: integer("skipped"),
    left: integer("left"),
  })
  .as(sql`
  with arrivals as (
    select substring(e.workflow from '^shape\\.v([0-9]+)$')::int version,
      substr(e.node, 3) node, e.at, e.data
    from events e
    where e.workflow ~ '^shape\\.v[0-9]+$' and e.subject like 'journey:%' and left(e.node, 2) = 's_'
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
    select coalesce((d.data ->> 'version')::int, substring(d.workflow from '^shape\\.v([0-9]+)$')::int),
      d.data ->> 'node', (d.at at time zone 'UTC')::date, 0, 0, 1
    from events d
    where d.workflow ~ '^shape\\.v[0-9]+$' and d.node = 'dropped' and d.data ->> 'node' is not null
  )
  select version, node, day, sum(arrived)::int arrived, sum(skipped)::int skipped,
    sum("left")::int "left"
  from counted group by version, node, day`);

/** Per version, edge and day: journeys that crossed the edge (the edge's ends come from the version's body). */
export const edgeFlow = pipeline
  .view("edge_flow", {
    version: integer("version"),
    edge: varchar("edge", { length: 84 }),
    fromNode: varchar("from_node", { length: 40 }),
    toNode: varchar("to_node", { length: 40 }),
    day: date("day", { mode: "string" }),
    crossings: integer("crossings"),
  })
  .as(sql`
  with arrivals as (
    select substring(e.workflow from '^shape\\.v([0-9]+)$')::int version, e.at, e.data
    from events e
    where e.workflow ~ '^shape\\.v[0-9]+$' and e.subject like 'journey:%' and left(e.node, 2) = 's_'
      and coalesce(e.data -> 'cause' ->> 'kind', '') <> 'version'
  )
  select a.version, x.edge, ed ->> 'from' from_node, ed ->> 'to' to_node,
    (a.at at time zone 'UTC')::date as day, count(*)::int crossings
  from arrivals a
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(a.data -> 'edges') = 'array'
    then a.data -> 'edges' else '[]'::jsonb end) x(edge)
  join pipeline.shape_versions sv on sv.number = a.version
  join lateral jsonb_array_elements(sv.body -> 'edges') ed on ed ->> 'id' = x.edge
  group by a.version, x.edge, ed ->> 'from', ed ->> 'to', (a.at at time zone 'UTC')::date`);

/**
 * Per source node and the day a journey opened: journeys opened, their deals and what the deals
 * collected. Cost is Meta's `ad_days.spend` that day on the source's campaign, for an `ads`
 * source of the newest shape; null for any other (no cost model yet).
 */
export const sourceNumbers = pipeline
  .view("source_numbers", {
    source: varchar("source", { length: 40 }),
    day: date("day", { mode: "string" }),
    opened: integer("opened"),
    deals: integer("deals"),
    collectedCents: bigint("collected_cents", { mode: "number" }),
    cost: doublePrecision("cost"),
  })
  .as(sql`
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
  group by source, day`);

/** Old view, over `node_counts`: journeys that entered a stage (node) and skipped past it. */
export const stageCounts = pipeline
  .view("stage_counts", {
    funnel: varchar("funnel", { length: 40 }),
    version: integer("version"),
    stage: varchar("stage", { length: 40 }),
    day: date("day", { mode: "string" }),
    entered: integer("entered"),
    skipped: integer("skipped"),
  })
  .as(sql`
  select 'shape'::varchar(40) funnel, c.version, c.node stage, c.day, c.arrived entered, c.skipped
  from pipeline.node_counts c`);

/**
 * Old view, over `node_counts` and `edge_flow`: for each flow edge of the newest shape, the
 * journeys that reached its first node, the ones that crossed it, and their share. No median.
 */
export const stageFlow = pipeline
  .view("stage_flow", {
    funnel: varchar("funnel", { length: 40 }),
    stage: varchar("stage", { length: 40 }),
    nextStage: varchar("next_stage", { length: 40 }),
    reached: integer("reached"),
    advanced: integer("advanced"),
    conversion: doublePrecision("conversion"),
    medianSeconds: doublePrecision("median_seconds"),
  })
  .as(sql`
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
  left join advanced a on a.from_node = p.stage and a.to_node = p.next_stage`);

/** Old view, over `source_numbers`: per source node (the old entry) and day. */
export const entryNumbers = pipeline
  .view("entry_numbers", {
    funnel: varchar("funnel", { length: 40 }),
    entry: varchar("entry", { length: 40 }),
    day: date("day", { mode: "string" }),
    opened: integer("opened"),
    deals: integer("deals"),
    collectedCents: bigint("collected_cents", { mode: "number" }),
    cost: doublePrecision("cost"),
  })
  .as(sql`
  select 'shape'::varchar(40) funnel, s.source entry, s.day, s.opened, s.deals, s.collected_cents,
    s.cost
  from pipeline.source_numbers s`);
