-- needs: track
-- One row per labelled episode (a goal worth a sentence): the model's or the person's goal, how it
-- ended, and what its acts add up to. Empty until `autobrowse autotrack label` has run.
CREATE OR REPLACE TABLE warehouse.autotrack_episodes AS
WITH lab AS (
  SELECT
    regexp_extract(filename, 'labels/([^/]+)/([^/]+)\.json$', 1) AS device,
    regexp_extract(filename, 'labels/([^/]+)/([^/]+)\.json$', 2) AS session,
    unnest(from_json(episodes, '["JSON"]')) AS e
  FROM {{track_labels}}
),
episodes AS (
  SELECT
    device, session,
    json_extract_string(e, '$.id') AS episode,
    json_extract_string(e, '$.goal') AS goal,
    json_extract_string(e, '$.goalBy') AS goal_by,
    json_extract_string(e, '$.outcome') AS outcome,
    TRY_CAST(json_extract_string(e, '$.confidence') AS DOUBLE) AS confidence
  FROM lab
),
sums AS (
  SELECT
    device, session, episode,
    count(*) AS acts,
    min(acted_at) AS started_at,
    max(acted_at) AS ended_at,
    round(sum(span_s), 1) AS active_s,
    count(*) FILTER (WHERE dead) AS dead,
    count(*) FILTER (WHERE rage) AS rage,
    count(*) FILTER (WHERE correction) AS corrections,
    count(*) FILTER (WHERE error) AS errors,
    list_sort(list(DISTINCT app_name) FILTER (WHERE app_name IS NOT NULL)) AS apps,
    list_sort(list(DISTINCT domain) FILTER (WHERE domain IS NOT NULL AND domain <> '')) AS domains
  FROM warehouse.autotrack_acts
  WHERE episode IS NOT NULL
  GROUP BY ALL
)
SELECT e.*, s.acts, s.started_at, s.ended_at, s.active_s, s.dead, s.rage, s.corrections, s.errors, s.apps, s.domains
FROM episodes e
LEFT JOIN sums s USING (device, session, episode);
