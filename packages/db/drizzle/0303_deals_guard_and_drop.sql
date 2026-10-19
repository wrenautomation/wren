DO $$
DECLARE
	loose integer;
	saved text;
BEGIN
	-- A Wren deal needs its journey. A client's deal lives in main but its journey in the client's
	-- own database, so the fold removes the row after it folds: any left is unfolded.
	SELECT count(*) INTO loose FROM "deals" d
	WHERE d."client" IS NOT NULL
		OR NOT EXISTS (SELECT 1 FROM "pipeline"."journeys" j WHERE j."legacy_deal" = d."id");
	IF loose > 0 THEN
		RAISE EXCEPTION 'deals: % row(s) are not folded into journeys. Run "wren pipeline fold-deals" (--dry first), then migrate.', loose;
	END IF;
	SELECT string_agg(DISTINCT w."workflow", ', ') INTO saved FROM (
		SELECT DISTINCT ON ("client", "workflow", "live") "workflow", "edits"
		FROM "workflow_saves" ORDER BY "client", "workflow", "live", "id" DESC
	) w WHERE w."edits"::text LIKE '%trigger.deal%';
	IF saved IS NOT NULL THEN
		RAISE EXCEPTION 'trigger.deal is used by a workflow save (%). Rewire it to trigger.journey, then migrate.', saved;
	END IF;
	SELECT string_agg(DISTINCT t."id", ', ') INTO saved
	FROM "workflow_templates" t WHERE t."edits"::text LIKE '%trigger.deal%';
	IF saved IS NOT NULL THEN
		RAISE EXCEPTION 'trigger.deal is used by a workflow template (%). Rewire it to trigger.journey, then migrate.', saved;
	END IF;
END $$;--> statement-breakpoint
DROP TABLE "deal_moves" CASCADE;--> statement-breakpoint
DROP TABLE "deal_pipelines" CASCADE;--> statement-breakpoint
DROP TABLE "deals" CASCADE;--> statement-breakpoint
-- A client with the old Opportunities app now has Journeys in its place.
UPDATE "clients" SET "products" = ("products" - 'deals.board') || '{"pipeline.journeys": {}}'::jsonb WHERE "products" -> 'deals.board' IS NOT NULL;--> statement-breakpoint
-- The webhook event "deal.moved" is now "journey.moved".
UPDATE "webhook_subscriptions" SET "events" = array_replace("events", 'deal.moved', 'journey.moved') WHERE 'deal.moved' = ANY("events");
