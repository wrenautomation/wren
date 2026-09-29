CREATE TABLE "company_checks" (
	"company_id" integer NOT NULL,
	"state" varchar(16) NOT NULL,
	"finding_id" integer,
	"tried" jsonb NOT NULL,
	"retry_at" timestamp with time zone,
	"run_id" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_company_checks" PRIMARY KEY("company_id"),
	CONSTRAINT "ck_company_checks_state" CHECK (("state")::text = ANY ((ARRAY['hiring'::character varying, 'no_openings'::character varying, 'unresolved'::character varying, 'capped'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"person_id" integer NOT NULL,
	"state" varchar(16) NOT NULL,
	"text" text NOT NULL,
	"citations" jsonb NOT NULL,
	"dropped" jsonb NOT NULL,
	"inputs_hash" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"prompt_version" varchar(16) NOT NULL,
	"llm" jsonb,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_briefs" PRIMARY KEY("person_id"),
	CONSTRAINT "ck_briefs_state" CHECK (("state")::text = ANY ((ARRAY['written'::character varying, 'empty'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "contact_scores" (
	"person_id" integer NOT NULL,
	"score" integer NOT NULL,
	"reasons" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_contact_scores" PRIMARY KEY("person_id")
);
--> statement-breakpoint
ALTER TABLE "company_checks" ADD CONSTRAINT "fk_company_checks_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_checks" ADD CONSTRAINT "fk_company_checks_finding_id_findings" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_checks" ADD CONSTRAINT "fk_company_checks_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "fk_briefs_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "fk_briefs_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_scores" ADD CONSTRAINT "fk_contact_scores_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_contact_scores_score" ON "contact_scores" USING btree ("score");