CREATE VIEW "public"."spine_events" AS (
  select id::text id, workflow, node, port, subject, kind,
    case when error is not null then 'failed' when due is not null then 'waiting' else 'passed' end state,
    at, due, error
  from events);