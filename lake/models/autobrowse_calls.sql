-- needs: track
-- One row per site call attempt autobrowse made (its calls ledger, src/runs/ledger.ts), shipped by
-- the desk to the track bucket (src/runs/ledger-ship.ts). `via`: api, browser or cache; NULL on old lines.
-- `body` names the answer in the desk's bodies ledger, which stays on the Mac. Times are UTC.
CREATE OR REPLACE TABLE warehouse.autobrowse_calls AS
SELECT
  CAST("at" AS DATE) AS day,
  * EXCLUDE (filename)
FROM {{track_calls}}
WHERE "at" IS NOT NULL;
