CREATE TABLE "pipeline"."journey_research" (
	"journey" uuid NOT NULL,
	"stage" varchar(40) NOT NULL,
	"profile_id" integer NOT NULL,
	"level" varchar(5) NOT NULL,
	"state" varchar(7) DEFAULT 'queued' NOT NULL,
	"icp" jsonb,
	"lookup_id" integer,
	"result" jsonb,
	"note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_journey_research" PRIMARY KEY("journey","stage"),
	CONSTRAINT "ck_journey_research_state" CHECK (("state")::text = ANY ((ARRAY['queued'::character varying, 'started'::character varying, 'read'::character varying, 'skipped'::character varying])::text[])),
	CONSTRAINT "ck_journey_research_level" CHECK (("level")::text = ANY ((ARRAY['light'::character varying, 'full'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "pipeline"."journey_research" ADD CONSTRAINT "fk_journey_research_journey_journeys" FOREIGN KEY ("journey") REFERENCES "pipeline"."journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_journey_research_profile_id" ON "pipeline"."journey_research" USING btree ("profile_id");