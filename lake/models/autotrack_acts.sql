-- needs: track
-- One row per act autotrack recorded (click, drag, scroll, text, key), joined to what it meant:
-- designs/2026-10-13-autotrack.md (autotrack repo), "Signal". Reads the track bucket's gzipped events
-- and labels in place (lake-track.ts). Times are UTC.
--   web:    the browser extension's click on the same act (within 150 ms and 4 px) gives the page's
--           target and url; `domain` otherwise comes from the latest web event in the last 30 s, for a browser's acts only.
--   app:    Wren's portal tells what a command meant (its `app` events): those within 5 s after the act.
--   labels: intent and rule signals from `autobrowse autotrack label`; NULL when not labelled yet.
CREATE OR REPLACE TABLE warehouse.autotrack_acts AS
WITH ev AS (
  SELECT
    regexp_extract(filename, '([^/]+)/([^/]+)/([^/]+)/events\.jsonl\.gz$', 1) AS device,
    regexp_extract(filename, '([^/]+)/([^/]+)/([^/]+)/events\.jsonl\.gz$', 2) AS session,
    regexp_extract(filename, '([^/]+)/([^/]+)/([^/]+)/events\.jsonl\.gz$', 3) AS segment,
    * EXCLUDE (filename)
  FROM {{track_events}}
),
acts AS (
  SELECT
    *,
    row_number() OVER (PARTITION BY device, session ORDER BY ts, t) AS n,
    least(coalesce(lead(ts) OVER (PARTITION BY device, session ORDER BY ts, t) - ts, 0), 30000) / 1000.0 AS span_s
  FROM ev
  WHERE kind IN ('click', 'drag', 'scroll', 'text', 'key')
),
web_clicks AS (
  SELECT device, session, ts, x, y, url, title, target, effects
  FROM ev
  WHERE kind = 'web' AND act = 'click' AND x IS NOT NULL AND y IS NOT NULL
),
joined AS (
  SELECT a.device, a.session, a.n, w.url, w.title, w.target, w.effects
  FROM acts a
  JOIN web_clicks w
    ON w.device = a.device AND w.session = a.session
   AND abs(w.ts - a.ts) < 150 AND abs(w.x - a.x) <= 4 AND abs(w.y - a.y) <= 4
  WHERE a.kind = 'click'
  QUALIFY row_number() OVER (PARTITION BY a.device, a.session, a.n ORDER BY abs(w.ts - a.ts)) = 1
),
web_urls AS (
  SELECT device, session, ts, url FROM ev WHERE kind = 'web' AND url IS NOT NULL
),
recent AS (
  SELECT a.device, a.session, a.n, u.url
  FROM acts a
  ASOF JOIN web_urls u
    ON a.device = u.device AND a.session = u.session AND a.ts >= u.ts
  WHERE a.ts - u.ts <= 30000
    AND regexp_matches(
      lower(coalesce(json_extract_string(a.app, '$.id'), '') || ' ' || coalesce(json_extract_string(a.app, '$.name'), '')),
      'chrome|msedge|microsoft edge|brave|firefox|safari|opera|vivaldi|thebrowser'
    )
),
cmds AS (
  SELECT
    e.device, e.session, a.n,
    struct_pack(
      action := e.action,
      ok := TRY_CAST(json_extract_string(e.detail, '$.ok') AS BOOLEAN),
      error := json_extract_string(e.detail, '$.error'),
      ids := json_extract(e.detail, '$.ids'),
      lag_ms := e.ts - a.ts
    ) AS cmd,
    e.ts
  FROM (SELECT * FROM ev WHERE kind = 'app') e
  ASOF JOIN (SELECT * FROM acts WHERE kind IN ('click', 'key')) a
    ON e.device = a.device AND e.session = a.session AND e.ts >= a.ts
  WHERE e.ts - a.ts <= 5000
),
app_actions AS (
  SELECT device, session, n, list(cmd ORDER BY ts) AS app_actions FROM cmds GROUP BY ALL
),
lab AS (
  SELECT
    regexp_extract(filename, 'labels/([^/]+)/([^/]+)\.json$', 1) AS device,
    regexp_extract(filename, 'labels/([^/]+)/([^/]+)\.json$', 2) AS session,
    unnest(from_json(acts, '["JSON"]')) AS a
  FROM {{track_labels}}
),
labelled AS (
  SELECT
    device, session,
    TRY_CAST(round(TRY_CAST(json_extract_string(a, '$.t') AS DOUBLE)) AS BIGINT) AS t,
    json_extract_string(a, '$.episode') AS episode,
    json_extract_string(a, '$.intent') AS intent,
    a -> '$.signals' AS signals
  FROM lab
  QUALIFY row_number() OVER (PARTITION BY device, session, t) = 1
)
SELECT
  a.device, a.session, a.segment, a.n AS act, a.t,
  to_timestamp(a.ts / 1000.0)::TIMESTAMP AS acted_at,
  CAST(to_timestamp(a.ts / 1000.0)::TIMESTAMP AS DATE) AS day,
  a.kind, a.span_s,
  json_extract_string(a.app, '$.name') AS app_name,
  json_extract_string(a.app, '$.id') AS app_id,
  json_extract_string(a.window, '$.title') AS window_title,
  coalesce(j.url, r.url) AS url,
  lower(regexp_replace(regexp_extract(coalesce(j.url, r.url), '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)', 1), '^www\.', '')) AS domain,
  coalesce(json_extract_string(j.target, '$.role'), json_extract_string(a.element, '$.role')) AS element_role,
  coalesce(json_extract_string(j.target, '$.name'), json_extract_string(a.element, '$.name')) AS element_name,
  a.element,
  j.target AS web_target,
  j.effects AS web_effects,
  a.x, a.y, a.button, a.count, a.dx, a.dy,
  a.text, a.redacted, a.key, a.mods,
  TRY_CAST(json_extract_string(a.out, '$.screen') AS BOOLEAN) AS out_screen,
  TRY_CAST(json_extract_string(a.out, '$.focus') AS BOOLEAN) AS out_focus,
  TRY_CAST(json_extract_string(a.out, '$.dialog') AS BOOLEAN) AS out_dialog,
  TRY_CAST(json_extract_string(a.out, '$.window') AS BOOLEAN) AS out_window,
  ap.app_actions,
  l.episode,
  l.intent,
  TRY_CAST(json_extract_string(l.signals, '$.dwell') AS BIGINT) AS dwell,
  TRY_CAST(json_extract_string(l.signals, '$.hover') AS BIGINT) AS hover,
  TRY_CAST(json_extract_string(l.signals, '$.dead') AS BOOLEAN) AS dead,
  TRY_CAST(json_extract_string(l.signals, '$.rage') AS BOOLEAN) AS rage,
  TRY_CAST(json_extract_string(l.signals, '$.correction') AS BOOLEAN) AS correction,
  TRY_CAST(json_extract_string(l.signals, '$.error') AS BOOLEAN) AS error
FROM acts a
LEFT JOIN joined j USING (device, session, n)
LEFT JOIN recent r USING (device, session, n)
LEFT JOIN app_actions ap USING (device, session, n)
LEFT JOIN labelled l ON l.device = a.device AND l.session = a.session AND l.t = a.t;
