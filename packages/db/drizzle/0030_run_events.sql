CREATE TABLE "run_events" (
	"seq" serial NOT NULL,
	"run_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"step" varchar(64) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"line" text NOT NULL,
	"subject" text,
	"count" integer,
	"source" jsonb,
	"detail" text,
	"trace_id" varchar(32),
	CONSTRAINT "pk_run_events" PRIMARY KEY("seq"),
	CONSTRAINT "ck_run_events_kind" CHECK (("kind")::text = ANY ((ARRAY['started'::character varying, 'did'::character varying, 'found'::character varying, 'waiting'::character varying, 'failed'::character varying, 'done'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "fk_run_events_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_run_events_run_id_seq" ON "run_events" USING btree ("run_id","seq");