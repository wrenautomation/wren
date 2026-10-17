-- One-time (designs/2026-10-16-maybe-sent.md, 2026-10-16 send verdicts). The 10-16 bug marked
-- drafts `failed` when their publish "may have gone through" or "already went through". The
-- send verdict replaces those words: such a draft waits in To approve as unsure (`publishing`
-- with an unsure `draft:` ledger row), and a person settles it. This file is the only reader
-- of those words.
INSERT INTO "send_attempts" ("item", "state", "platform", "words", "target", "tries", "why", "started_at", "updated_at")
SELECT
  'draft:' || d."id"::text,
  'unsure',
  d."platform",
  d."text",
  left(regexp_replace(coalesce(nullif(d."title", ''), d."text"), '\s+', ' ', 'g'), 120),
  1,
  left('An earlier version marked it failed, though it may have gone out: ' || d."error", 1000),
  now(),
  now()
FROM "content_drafts" d
WHERE d."status" = 'failed'
  AND (d."error" ILIKE '%may have gone through%' OR d."error" ILIKE '%already went through%')
ON CONFLICT ("item") DO NOTHING;--> statement-breakpoint
UPDATE "content_drafts"
SET "status" = 'publishing',
    "error" = left('May have gone out: ' || "error" || '. It waits in To approve.', 1000)
WHERE "status" = 'failed'
  AND ("error" ILIKE '%may have gone through%' OR "error" ILIKE '%already went through%');
