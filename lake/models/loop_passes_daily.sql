-- Every loop pass by day (runs ledger): how many, how long, how many recorded an error.
CREATE OR REPLACE TABLE warehouse.loop_passes_daily AS
SELECT
  command,
  CAST(started_at AS DATE) AS day,
  count(*) AS passes,
  round(avg(epoch(finished_at - started_at)), 2) AS avg_s,
  round(max(epoch(finished_at - started_at)), 2) AS max_s,
  count(*) FILTER (WHERE stats ->> 'error' IS NOT NULL) AS errored
FROM wren.runs
GROUP BY ALL;
