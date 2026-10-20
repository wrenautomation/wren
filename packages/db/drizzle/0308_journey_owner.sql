-- A journey's owner is a column now (wa-32i): the team member who works it. Null is nobody.
ALTER TABLE "pipeline"."journeys" ADD COLUMN "owner" text;--> statement-breakpoint
-- Once, from what the console showed until now: the address on the newest hand arrival at a step
-- node (the cause's `ref`). A name that is not an address was never a team member; it stays null.
UPDATE "pipeline"."journeys" j SET "owner" = o."ref"
FROM (
	SELECT DISTINCT ON (e."subject") e."subject", lower(e."data" -> 'cause' ->> 'ref') AS "ref"
	FROM "public"."events" e
	WHERE e."subject" LIKE 'journey:%'
		AND e."workflow" LIKE 'shape.%'
		AND left(e."node", 2) = 's_'
		AND e."data" -> 'cause' ->> 'kind' = 'manual'
	ORDER BY e."subject", e."at" DESC
) o
WHERE o."subject" = 'journey:' || j."id"::text
	AND o."ref" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
