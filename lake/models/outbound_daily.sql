-- What Wren sent, per channel and day: email, texts, and each reach kind (DMs, comments, invites).
CREATE OR REPLACE TABLE warehouse.outbound_daily AS
SELECT 'email' AS channel, CAST(sent_at AS DATE) AS day, count(*) AS sent
FROM wren.messages
WHERE sent_at IS NOT NULL
GROUP BY ALL
UNION ALL
SELECT 'sms', CAST(sent_at AS DATE), count(*)
FROM wren.sms_messages
WHERE direction = 'out' AND sent_at IS NOT NULL
GROUP BY ALL
UNION ALL
SELECT 'reach:' || kind, CAST(sent_at AS DATE), count(*)
FROM wren.reach_messages
WHERE direction = 'out' AND sent_at IS NOT NULL
GROUP BY ALL;
