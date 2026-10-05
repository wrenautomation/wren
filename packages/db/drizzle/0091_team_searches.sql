CREATE TABLE "team_searches" (
	"company_id" integer NOT NULL,
	"state" varchar(16) NOT NULL,
	"query" text NOT NULL,
	"profiles" jsonb NOT NULL,
	"kept" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"run_id" uuid,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_team_searches" PRIMARY KEY("company_id"),
	CONSTRAINT "ck_team_searches_lookupstate" CHECK (("state")::text = ANY ((ARRAY['matched'::character varying, 'unresolved'::character varying, 'capped'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "team_searches" ADD CONSTRAINT "fk_team_searches_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_searches" ADD CONSTRAINT "fk_team_searches_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_team_searches_run_id" ON "team_searches" USING btree ("run_id");