CREATE TABLE "findings" (
	"id" serial NOT NULL,
	"kind" varchar(32) NOT NULL,
	"person_id" integer,
	"company_id" integer,
	"fact_key" varchar(400) NOT NULL,
	"value" jsonb NOT NULL,
	"document_id" integer,
	"source_url" text,
	"confidence" real NOT NULL,
	"via" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_findings" PRIMARY KEY("id"),
	CONSTRAINT "uq_findings_fact_key" UNIQUE("fact_key"),
	CONSTRAINT "ck_findings_findingkind" CHECK (("kind")::text = ANY ((ARRAY['job_change'::character varying, 'still_there'::character varying, 'left'::character varying, 'hiring'::character varying, 'post'::character varying, 'news'::character varying])::text[])),
	CONSTRAINT "ck_findings_one_subject" CHECK ((person_id IS NULL) <> (company_id IS NULL)),
	CONSTRAINT "ck_findings_confidence" CHECK (confidence >= 0 AND confidence <= 1)
);
--> statement-breakpoint
CREATE TABLE "person_lookups" (
	"person_id" integer NOT NULL,
	"state" varchar(16) NOT NULL,
	"tried" jsonb NOT NULL,
	"retry_at" timestamp with time zone,
	"run_id" uuid,
	"looked_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_person_lookups" PRIMARY KEY("person_id"),
	CONSTRAINT "ck_person_lookups_lookupstate" CHECK (("state")::text = ANY ((ARRAY['matched'::character varying, 'unresolved'::character varying, 'capped'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "ck_documents_documentkind";--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "fk_findings_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "fk_findings_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "fk_findings_document_id_documents" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_lookups" ADD CONSTRAINT "fk_person_lookups_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_lookups" ADD CONSTRAINT "fk_person_lookups_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_findings_person_id" ON "findings" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_findings_company_id" ON "findings" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "ck_documents_documentkind" CHECK (("kind")::text = ANY ((ARRAY['webpage'::character varying, 'pdf'::character varying, 'snippet'::character varying, 'profile'::character varying])::text[]));