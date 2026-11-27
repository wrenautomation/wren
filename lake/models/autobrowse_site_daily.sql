-- needs: track
-- Per site and day (UTC): calls by path and how many failed, call time, flow outcomes, captchas,
-- model tokens, and compiled-workflow runs by status. Reads the three autobrowse_* tables above it.
CREATE OR REPLACE TABLE warehouse.autobrowse_site_daily AS
WITH calls AS (
  SELECT
    site, day,
    count(*) AS calls,
    count(*) FILTER (WHERE NOT ok) AS calls_failed,
    count(*) FILTER (WHERE via = 'api') AS calls_api,
    count(*) FILTER (WHERE via = 'browser') AS calls_browser,
    count(*) FILTER (WHERE via = 'cache') AS calls_cache,
    CAST(quantile_cont(ms, 0.5) AS BIGINT) AS call_ms_p50,
    CAST(quantile_cont(ms, 0.95) AS BIGINT) AS call_ms_p95
  FROM warehouse.autobrowse_calls
  GROUP BY ALL
),
flows AS (
  SELECT
    site, day,
    count(*) AS flows,
    count(*) FILTER (WHERE outcome = 'ok') AS flows_ok,
    count(*) FILTER (WHERE outcome = 'failed') AS flows_failed,
    count(*) FILTER (WHERE outcome = 'human') AS flows_human,
    sum(captchaTries) AS captcha_tries,
    count(*) FILTER (WHERE captchaSolved) AS captchas_solved,
    sum(llmCalls) AS llm_calls,
    sum(inputTokens) AS input_tokens,
    sum(outputTokens) AS output_tokens
  FROM warehouse.autobrowse_flows
  GROUP BY ALL
),
runs AS (
  SELECT
    site, day,
    count(*) AS engine_runs,
    count(*) FILTER (WHERE status = 'done') AS engine_done,
    count(*) FILTER (WHERE status = 'failed') AS engine_failed,
    count(*) FILTER (WHERE status = 'waiting') AS engine_waiting
  FROM warehouse.autobrowse_engine_runs
  GROUP BY ALL
)
SELECT *
FROM calls
FULL JOIN flows USING (site, day)
FULL JOIN runs USING (site, day)
ORDER BY day, site;
