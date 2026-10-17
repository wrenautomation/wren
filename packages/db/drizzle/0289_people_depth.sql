CREATE TABLE "profile_findings" (
	"id" serial NOT NULL,
	"profile_id" integer NOT NULL,
	"lookup_id" integer,
	"kind" varchar(16) NOT NULL,
	"platform" varchar(24),
	"value" text NOT NULL,
	"url" text,
	"source" varchar(24) NOT NULL,
	"confidence" double precision NOT NULL,
	"detail" jsonb,
	"state" varchar(8) DEFAULT 'found' NOT NULL,
	"decided_by" varchar(320),
	"decided_at" timestamp with time zone,
	"ref" varchar(400) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_profile_findings" PRIMARY KEY("id"),
	CONSTRAINT "uq_profile_findings_profile_ref" UNIQUE("profile_id","ref"),
	CONSTRAINT "ck_profile_findings_kind" CHECK (("kind")::text = ANY ((ARRAY['handle'::character varying, 'link'::character varying, 'employer'::character varying])::text[])),
	CONSTRAINT "ck_profile_findings_state" CHECK (("state")::text = ANY ((ARRAY['found'::character varying, 'kept'::character varying, 'dropped'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "profile_lookups" (
	"id" serial NOT NULL,
	"profile_id" integer NOT NULL,
	"state" varchar(12) NOT NULL,
	"by" varchar(320),
	"subject" jsonb,
	"tried" jsonb,
	"outcome" varchar(24),
	"error" text,
	"retry_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_profile_lookups" PRIMARY KEY("id"),
	CONSTRAINT "ck_profile_lookups_state" CHECK (("state")::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'done'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "decision_calls" DROP CONSTRAINT "ck_decision_calls_kind";--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "ck_decisions_kind";--> statement-breakpoint
ALTER TABLE "touches" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "profile_findings" ADD CONSTRAINT "fk_profile_findings_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_findings" ADD CONSTRAINT "fk_profile_findings_lookup_id_profile_lookups" FOREIGN KEY ("lookup_id") REFERENCES "public"."profile_lookups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_lookups" ADD CONSTRAINT "fk_profile_lookups_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_profile_lookups_profile_id" ON "profile_lookups" USING btree ("profile_id","created_at");--> statement-breakpoint
ALTER TABLE "decision_calls" ADD CONSTRAINT "ck_decision_calls_kind" CHECK (("kind")::text = ANY ((ARRAY['comment_quality'::character varying, 'learn_worth'::character varying, 'lead_fit'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "ck_decisions_kind" CHECK (("kind")::text = ANY ((ARRAY['comment_quality'::character varying, 'learn_worth'::character varying, 'lead_fit'::character varying])::text[]));