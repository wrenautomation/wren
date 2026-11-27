-- needs: track
-- One row per compiled-workflow run (autobrowse's engine ledger): its status (done, failed,
-- waiting), the gate it waits on, and each step as JSON. `failed_step` is the first failed step's name.
CREATE OR REPLACE TABLE warehouse.autobrowse_engine_runs AS
SELECT
  CAST(startedAt AS DATE) AS day,
  * EXCLUDE (filename),
  json_array_length(steps) AS step_count,
  (
    SELECT s ->> 'name'
    FROM unnest(CAST(steps AS JSON[])) AS u(s)
    WHERE s ->> 'status' = 'failed'
    LIMIT 1
  ) AS failed_step
FROM {{track_engine}}
WHERE startedAt IS NOT NULL;
