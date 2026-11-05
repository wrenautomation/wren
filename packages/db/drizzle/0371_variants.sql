CREATE SCHEMA "variants";
--> statement-breakpoint
CREATE TABLE "variants"."batches" (
	"id" serial NOT NULL,
	"subject_id" integer NOT NULL,
	"why" text NOT NULL,
	"agent" varchar(120),
	"state" varchar(8) DEFAULT 'open' NOT NULL,
	"note" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_batches" PRIMARY KEY("id"),
	CONSTRAINT "ck_variants_batches_state" CHECK (("state")::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "variants"."guides" (
	"id" serial NOT NULL,
	"text" text NOT NULL,
	"source" varchar(8) DEFAULT 'william' NOT NULL,
	"ref" text,
	"subject_id" integer,
	"kind" varchar(8),
	"state" varchar(8) DEFAULT 'testing' NOT NULL,
	"by" varchar(320),
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_guides" PRIMARY KEY("id"),
	CONSTRAINT "ck_variants_guides_source" CHECK (("source")::text = ANY ((ARRAY['william'::character varying, 'study'::character varying, 'sop'::character varying, 'skill'::character varying, 'agent'::character varying])::text[])),
	CONSTRAINT "ck_variants_guides_kind" CHECK (("kind")::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'page'::character varying])::text[])),
	CONSTRAINT "ck_variants_guides_state" CHECK (("state")::text = ANY ((ARRAY['testing'::character varying, 'locked'::character varying, 'dropped'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "variants"."notes" (
	"id" serial NOT NULL,
	"sample_id" integer NOT NULL,
	"anchor" jsonb,
	"tone" varchar(4),
	"text" text,
	"by" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_notes" PRIMARY KEY("id"),
	CONSTRAINT "ck_variants_notes_tone" CHECK (("tone")::text = ANY ((ARRAY['good'::character varying, 'bad'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "variants"."samples" (
	"id" serial NOT NULL,
	"batch_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"body" text,
	"media" text,
	"poster" text,
	"parent_id" integer,
	"guides" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"change" text,
	"agent" varchar(120),
	"verdict" varchar(8),
	"kept_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_samples" PRIMARY KEY("id"),
	CONSTRAINT "ck_variants_samples_verdict" CHECK (("verdict")::text = ANY ((ARRAY['amazing'::character varying, 'good'::character varying, 'bad'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "variants"."subjects" (
	"id" serial NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" text NOT NULL,
	"kind" varchar(8) NOT NULL,
	"brief" text,
	"seeds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" varchar(8) DEFAULT 'open' NOT NULL,
	"by" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_subjects" PRIMARY KEY("id"),
	CONSTRAINT "uq_variants_subjects_slug" UNIQUE("slug"),
	CONSTRAINT "ck_variants_subjects_kind" CHECK (("kind")::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'page'::character varying])::text[])),
	CONSTRAINT "ck_variants_subjects_state" CHECK (("state")::text = ANY ((ARRAY['open'::character varying, 'paused'::character varying, 'done'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "variants"."batches" ADD CONSTRAINT "fk_batches_subject_id_subjects" FOREIGN KEY ("subject_id") REFERENCES "variants"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants"."guides" ADD CONSTRAINT "fk_guides_subject_id_subjects" FOREIGN KEY ("subject_id") REFERENCES "variants"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants"."notes" ADD CONSTRAINT "fk_notes_sample_id_samples" FOREIGN KEY ("sample_id") REFERENCES "variants"."samples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants"."samples" ADD CONSTRAINT "fk_samples_batch_id_batches" FOREIGN KEY ("batch_id") REFERENCES "variants"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants"."samples" ADD CONSTRAINT "fk_samples_subject_id_subjects" FOREIGN KEY ("subject_id") REFERENCES "variants"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_variants_batches_subject" ON "variants"."batches" USING btree ("subject_id","state");--> statement-breakpoint
CREATE INDEX "ix_variants_notes_sample" ON "variants"."notes" USING btree ("sample_id");--> statement-breakpoint
CREATE INDEX "ix_variants_samples_batch" ON "variants"."samples" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ix_variants_samples_subject" ON "variants"."samples" USING btree ("subject_id");