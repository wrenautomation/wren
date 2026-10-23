CREATE VIEW "pipeline"."move_flow" AS (
  with arrivals as (
    select substring(e.workflow from '^shape\.v([0-9]+)$')::int version,
      substr(e.node, 3) node, e.at, e.data
    from events e
    where e.workflow ~ '^shape\.v[0-9]+$' and e.subject like 'journey:%' and left(e.node, 2) = 's_'
      and coalesce(e.data -> 'cause' ->> 'kind', '') <> 'version'
  ), moved as (
    select version, data ->> 'from' from_node, node to_node, (at at time zone 'UTC')::date as day,
      case when jsonb_typeof(data -> 'skipped') = 'array' and jsonb_array_length(data -> 'skipped') > 0
        then 1 else 0 end skips,
      case when data -> 'loop' is not null then 1 else 0 end loops
    from arrivals
    union all
    select coalesce((d.data ->> 'version')::int, substring(d.workflow from '^shape\.v([0-9]+)$')::int),
      d.data ->> 'node', 'dropped', (d.at at time zone 'UTC')::date, 0, 0
    from events d
    where d.workflow ~ '^shape\.v[0-9]+$' and d.node = 'dropped' and d.data ->> 'node' is not null
  )
  select version, from_node, to_node, day, count(*)::int moves, sum(skips)::int skips,
    sum(loops)::int loops
  from moved group by version, from_node, to_node, day);