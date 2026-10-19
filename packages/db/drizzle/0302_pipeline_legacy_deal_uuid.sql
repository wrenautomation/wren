DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "pipeline"."journeys" WHERE "legacy_deal" IS NOT NULL) THEN
		RAISE EXCEPTION 'pipeline.journeys.legacy_deal holds integers; only the fold sets it, as a uuid';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ALTER COLUMN "legacy_deal" SET DATA TYPE uuid USING NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_journeys_legacy_deal" ON "pipeline"."journeys" USING btree ("legacy_deal") WHERE legacy_deal is not null;
