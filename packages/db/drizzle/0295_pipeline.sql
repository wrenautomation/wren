CREATE SCHEMA "pipeline";
--> statement-breakpoint
CREATE TABLE "pipeline"."funnel_versions" (
	"id" serial NOT NULL,
	"funnel" varchar(40) NOT NULL,
	"number" integer NOT NULL,
	"body" jsonb NOT NULL,
	"why" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "pk_funnel_versions" PRIMARY KEY("id"),
	CONSTRAINT "uq_funnel_versions_number" UNIQUE("funnel","number")
);
--> statement-breakpoint
CREATE TABLE "pipeline"."funnels" (
	"id" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"status" varchar(4) DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_funnels" PRIMARY KEY("id"),
	CONSTRAINT "ck_funnels_status" CHECK (("status")::text = ANY ((ARRAY['live'::character varying, 'off'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "pipeline"."journeys" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" integer NOT NULL,
	"funnel" varchar(40) NOT NULL,
	"version" integer NOT NULL,
	"stage" varchar(40) NOT NULL,
	"status" varchar(7) DEFAULT 'open' NOT NULL,
	"drop_reason" text,
	"entry" varchar(40) NOT NULL,
	"entry_ref" jsonb,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"legacy_deal" integer,
	CONSTRAINT "pk_journeys" PRIMARY KEY("id"),
	CONSTRAINT "ck_journeys_status" CHECK (("status")::text = ANY ((ARRAY['open'::character varying, 'done'::character varying, 'dropped'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "pipeline"."offer_versions" (
	"id" serial NOT NULL,
	"offer" varchar(64) NOT NULL,
	"number" integer NOT NULL,
	"hash" varchar(64) NOT NULL,
	"body" jsonb NOT NULL,
	"why" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "pk_offer_versions" PRIMARY KEY("id"),
	CONSTRAINT "uq_offer_versions_number" UNIQUE("offer","number"),
	CONSTRAINT "uq_offer_versions_hash" UNIQUE("offer","hash")
);
--> statement-breakpoint
CREATE TABLE "pipeline"."deals" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"journey" uuid NOT NULL,
	"profile_id" integer NOT NULL,
	"offer" varchar(64) NOT NULL,
	"offer_version" integer NOT NULL,
	"terms_version" integer,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"status" varchar(5) DEFAULT 'open' NOT NULL,
	"collected_cents" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"engagement_id" integer,
	CONSTRAINT "pk_deals" PRIMARY KEY("id"),
	CONSTRAINT "uq_deals_journey" UNIQUE("journey"),
	CONSTRAINT "ck_deals_status" CHECK (("status")::text = ANY ((ARRAY['open'::character varying, 'won'::character varying, 'lost'::character varying, 'ended'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "pipeline"."terms_versions" (
	"id" serial NOT NULL,
	"offer" varchar(64) NOT NULL,
	"plan" varchar(40) NOT NULL,
	"number" integer NOT NULL,
	"effective_from" date NOT NULL,
	"body" jsonb NOT NULL,
	"why" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "pk_terms_versions" PRIMARY KEY("id"),
	CONSTRAINT "uq_terms_versions_number" UNIQUE("offer","plan","number")
);
--> statement-breakpoint
ALTER TABLE "pipeline"."funnel_versions" ADD CONSTRAINT "fk_funnel_versions_funnel_funnels" FOREIGN KEY ("funnel") REFERENCES "pipeline"."funnels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ADD CONSTRAINT "fk_journeys_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."journeys" ADD CONSTRAINT "fk_journeys_funnel_version" FOREIGN KEY ("funnel","version") REFERENCES "pipeline"."funnel_versions"("funnel","number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."deals" ADD CONSTRAINT "fk_deals_journey_journeys" FOREIGN KEY ("journey") REFERENCES "pipeline"."journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."deals" ADD CONSTRAINT "fk_deals_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline"."deals" ADD CONSTRAINT "fk_deals_terms_version_terms_versions" FOREIGN KEY ("terms_version") REFERENCES "pipeline"."terms_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_journeys_profile_funnel_status" ON "pipeline"."journeys" USING btree ("profile_id","funnel","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_journeys_open" ON "pipeline"."journeys" USING btree ("profile_id","funnel") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "ix_deals_profile_id" ON "pipeline"."deals" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "ix_deals_terms_version" ON "pipeline"."deals" USING btree ("terms_version");--> statement-breakpoint
CREATE FUNCTION "pipeline"."never_edited"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pipeline.% rows are never edited or deleted; add a new version', TG_TABLE_NAME;
END $$;--> statement-breakpoint
CREATE TRIGGER "offer_versions_never_edited" BEFORE UPDATE OR DELETE ON "pipeline"."offer_versions" FOR EACH ROW EXECUTE FUNCTION "pipeline"."never_edited"();--> statement-breakpoint
CREATE TRIGGER "terms_versions_never_edited" BEFORE UPDATE OR DELETE ON "pipeline"."terms_versions" FOR EACH ROW EXECUTE FUNCTION "pipeline"."never_edited"();--> statement-breakpoint
CREATE TRIGGER "funnel_versions_never_edited" BEFORE UPDATE OR DELETE ON "pipeline"."funnel_versions" FOR EACH ROW EXECUTE FUNCTION "pipeline"."never_edited"();
