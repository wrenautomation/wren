CREATE TABLE "company_lookups" (
	"company_id" integer NOT NULL,
	"state" varchar(16) NOT NULL,
	"tried" jsonb NOT NULL,
	"retry_at" timestamp with time zone,
	"run_id" uuid,
	"looked_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_company_lookups" PRIMARY KEY("company_id"),
	CONSTRAINT "ck_company_lookups_lookupstate" CHECK (("state")::text = ANY ((ARRAY['matched'::character varying, 'unresolved'::character varying, 'capped'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "findings" DROP CONSTRAINT "ck_findings_findingkind";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "linkedin_url" varchar(512);--> statement-breakpoint
ALTER TABLE "company_lookups" ADD CONSTRAINT "fk_company_lookups_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_lookups" ADD CONSTRAINT "fk_company_lookups_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_company_lookups_run_id" ON "company_lookups" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "ck_findings_findingkind" CHECK (("kind")::text = ANY ((ARRAY['job_change'::character varying, 'still_there'::character varying, 'left'::character varying, 'hiring'::character varying, 'post'::character varying, 'news'::character varying, 'profile'::character varying])::text[]));