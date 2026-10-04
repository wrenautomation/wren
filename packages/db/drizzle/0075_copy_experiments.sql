CREATE TABLE "experiment_alleles" (
	"id" serial NOT NULL,
	"experiment_id" integer NOT NULL,
	"locus" varchar(64) NOT NULL,
	"allele" varchar(12) NOT NULL,
	"text" text NOT NULL,
	"state" varchar(16) NOT NULL,
	"origin" varchar(16) NOT NULL,
	"journal_id" integer,
	"angle" varchar(32),
	"judge_score" double precision,
	"born_version" varchar(12),
	"retired_reason" varchar(32),
	"decided_by" varchar(32),
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_experiment_alleles" PRIMARY KEY("id"),
	CONSTRAINT "uq_experiment_alleles_locus" UNIQUE("experiment_id","locus","allele"),
	CONSTRAINT "ck_experiment_alleles_state" CHECK (("state")::text = ANY ((ARRAY['candidate'::character varying, 'live'::character varying, 'retired'::character varying, 'rejected'::character varying])::text[])),
	CONSTRAINT "ck_experiment_alleles_origin" CHECK (("origin")::text = ANY ((ARRAY['seed'::character varying, 'mutation'::character varying, 'manual'::character varying, 'import'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "experiment_journal" (
	"id" serial NOT NULL,
	"experiment_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"locus" varchar(64),
	"detail" jsonb NOT NULL,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_experiment_journal" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "experiment_snapshots" (
	"id" serial NOT NULL,
	"experiment_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stats" jsonb NOT NULL,
	"shares" jsonb NOT NULL,
	"p_best" jsonb NOT NULL,
	"strategies" jsonb NOT NULL,
	CONSTRAINT "pk_experiment_snapshots" PRIMARY KEY("id"),
	CONSTRAINT "uq_experiment_snapshots_generation" UNIQUE("experiment_id","generation")
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" serial NOT NULL,
	"niche" varchar(32) NOT NULL,
	"template" varchar(64) NOT NULL,
	"state" varchar(16) NOT NULL,
	"live_version" varchar(12) NOT NULL,
	"file_version" varchar(12) NOT NULL,
	"settings" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"stop_reason" varchar(16),
	CONSTRAINT "pk_experiments" PRIMARY KEY("id"),
	CONSTRAINT "ck_experiments_state" CHECK (("state")::text = ANY ((ARRAY['running'::character varying, 'paused'::character varying, 'settled'::character varying, 'stopped'::character varying])::text[])),
	CONSTRAINT "ck_experiments_stop_reason" CHECK (("stop_reason")::text = ANY ((ARRAY['settled'::character varying, 'budget'::character varying, 'stopped'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "parent_version" varchar(12);--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "experiment_id" integer;--> statement-breakpoint
ALTER TABLE "experiment_alleles" ADD CONSTRAINT "fk_experiment_alleles_experiment_id_experiments" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_journal" ADD CONSTRAINT "fk_experiment_journal_experiment_id_experiments" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_snapshots" ADD CONSTRAINT "fk_experiment_snapshots_experiment_id_experiments" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_experiment_journal_experiment_id" ON "experiment_journal" USING btree ("experiment_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_experiments_open_template" ON "experiments" USING btree ("niche","template") WHERE (state)::text <> 'stopped'::text;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "fk_template_versions_experiment_id_experiments" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_template_versions_experiment_id" ON "template_versions" USING btree ("experiment_id" int4_ops) WHERE (experiment_id IS NOT NULL);