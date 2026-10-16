CREATE TABLE "decision_calls" (
	"id" serial NOT NULL,
	"kind" varchar(40) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"label" varchar(40) NOT NULL,
	"keep" boolean NOT NULL,
	"source" varchar(40) NOT NULL,
	"by" varchar(320),
	"decision_id" integer,
	"agreed" boolean,
	"override" boolean DEFAULT false NOT NULL,
	"ref" varchar(300),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_decision_calls" PRIMARY KEY("id"),
	CONSTRAINT "uq_decision_calls_ref" UNIQUE("ref"),
	CONSTRAINT "ck_decision_calls_kind" CHECK (("kind")::text = ANY ((ARRAY['comment_quality'::character varying, 'learn_worth'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" serial NOT NULL,
	"kind" varchar(40) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"mode" varchar(10) NOT NULL,
	"backend" varchar(20) NOT NULL,
	"model" varchar(100) NOT NULL,
	"state" jsonb NOT NULL,
	"questions" jsonb NOT NULL,
	"answers" jsonb,
	"label" varchar(40),
	"p" double precision,
	"confidence" double precision,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error" text,
	"ref" varchar(300),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_decisions" PRIMARY KEY("id"),
	CONSTRAINT "uq_decisions_ref" UNIQUE("ref"),
	CONSTRAINT "ck_decisions_kind" CHECK (("kind")::text = ANY ((ARRAY['comment_quality'::character varying, 'learn_worth'::character varying])::text[])),
	CONSTRAINT "ck_decisions_mode" CHECK (("mode")::text = ANY ((ARRAY['off'::character varying, 'shadow'::character varying, 'recommend'::character varying, 'gate'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "decision_calls" ADD CONSTRAINT "fk_decision_calls_decision_id_decisions" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_decision_calls_subject" ON "decision_calls" USING btree ("kind","subject","at");--> statement-breakpoint
CREATE INDEX "ix_decisions_subject" ON "decisions" USING btree ("kind","subject","at");--> statement-breakpoint
CREATE INDEX "ix_decisions_kind_at" ON "decisions" USING btree ("kind","at");