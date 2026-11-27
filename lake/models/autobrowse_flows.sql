-- needs: track
-- One row per flow run (autobrowse's flows ledger): the outcome (ok, failed, human, interrupted),
-- acts, captcha tries and the model tokens it spent. `captchas` holds each captcha as JSON.
CREATE OR REPLACE TABLE warehouse.autobrowse_flows AS
SELECT
  CAST(startedAt AS DATE) AS day,
  * EXCLUDE (filename)
FROM {{track_flows}}
WHERE startedAt IS NOT NULL;
