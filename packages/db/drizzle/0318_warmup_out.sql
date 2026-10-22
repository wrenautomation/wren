-- Warmup is not sales (wa-amo). Rows stored before the filter leave the numbers too.
-- Instantly warmup mail in the Monitor: dropped, unless already done.
UPDATE "watch"."mail" SET "verdict" = 'drop', "why" = 'Instantly warmup mail.', "rule_id" = NULL
WHERE "done_at" IS NULL
  AND "subject" ~ '\|\s*(\S+\s+)?[A-Z0-9]{7}(\s+\S+)?\s*$' AND "subject" ~ '\|.*[0-9]';--> statement-breakpoint
-- Reddit comments in karma places, and their replies to them: the threads and comments keep them.
DELETE FROM "touches" WHERE "id" IN (
  SELECT a."id" FROM "touches" a
  JOIN "touches" t ON a."answers" = t."id"
  JOIN "reddit_threads" r ON t."ref" = 'rt:' || r."id"
  JOIN "reddit_places" p ON p."subreddit" = r."subreddit"
  WHERE p."purpose" = 'karma'
);--> statement-breakpoint
DELETE FROM "touches" t USING "reddit_threads" r, "reddit_places" p
WHERE t."ref" = 'rt:' || r."id" AND p."subreddit" = r."subreddit" AND p."purpose" = 'karma';
