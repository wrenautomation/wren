-- needs: track
-- Per device and day (UTC): how long, how many acts, where the time went, how often acts were dead,
-- raged or ended in an error. Time is each act's span: the gap to the next act, capped at 30 s.
-- The rates average the labelled acts only; they are NULL until `autobrowse autotrack label` ran.
CREATE OR REPLACE TABLE warehouse.autotrack_daily AS
WITH day AS (
  SELECT
    device, day,
    count(DISTINCT session) AS sessions,
    count(*) AS acts,
    count(DISTINCT date_trunc('minute', acted_at)) AS active_minutes,
    round(sum(span_s), 1) AS active_s,
    count(*) FILTER (WHERE dead IS NOT NULL) AS labelled_acts,
    round(avg(dead::INT), 4) AS dead_rate,
    round(avg(rage::INT), 4) AS rage_rate,
    round(avg(error::INT), 4) AS error_rate,
    round(avg(correction::INT), 4) AS correction_rate
  FROM warehouse.autotrack_acts
  GROUP BY ALL
),
app_time AS (
  SELECT device, day, coalesce(app_name, '(unknown)') AS app, round(sum(span_s), 1) AS seconds
  FROM warehouse.autotrack_acts
  GROUP BY ALL
),
apps AS (
  SELECT device, day, list(struct_pack(app := app, seconds := seconds) ORDER BY seconds DESC) AS apps
  FROM app_time
  GROUP BY ALL
),
domain_time AS (
  SELECT device, day, domain, round(sum(span_s), 1) AS seconds
  FROM warehouse.autotrack_acts
  WHERE domain IS NOT NULL AND domain <> ''
  GROUP BY ALL
),
domains AS (
  SELECT device, day, list(struct_pack(domain := domain, seconds := seconds) ORDER BY seconds DESC) AS domains
  FROM domain_time
  GROUP BY ALL
)
SELECT d.*, a.apps, m.domains
FROM day d
LEFT JOIN apps a USING (device, day)
LEFT JOIN domains m USING (device, day);
