CREATE TABLE "studies" (
	"id" serial NOT NULL,
	"slug" varchar(80) NOT NULL,
	"question" text NOT NULL,
	"angles" jsonb NOT NULL,
	"drafts" jsonb NOT NULL,
	"niche" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_studies" PRIMARY KEY("id"),
	CONSTRAINT "uq_studies_slug" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "study_steps" (
	"id" serial NOT NULL,
	"study_id" integer NOT NULL,
	"step" varchar(16) NOT NULL,
	"key" text NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"document_id" integer,
	"detail" jsonb NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_study_steps" PRIMARY KEY("id"),
	CONSTRAINT "uq_study_steps_unit" UNIQUE("study_id","step","key"),
	CONSTRAINT "ck_study_steps_step" CHECK (("step")::text = ANY ((ARRAY['plan'::character varying, 'search'::character varying, 'ask'::character varying, 'read'::character varying, 'claims'::character varying, 'draft'::character varying])::text[])),
	CONSTRAINT "ck_study_steps_outcome" CHECK (("outcome")::text = ANY ((ARRAY['ok'::character varying, 'empty'::character varying, 'refused'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "away_until" date;--> statement-breakpoint
ALTER TABLE "study_steps" ADD CONSTRAINT "fk_study_steps_study_id_studies" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_steps" ADD CONSTRAINT "fk_study_steps_document_id_documents" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_steps" ADD CONSTRAINT "fk_study_steps_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;