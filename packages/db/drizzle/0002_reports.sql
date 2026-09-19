CREATE TABLE "reports" (
	"id" serial NOT NULL,
	"kind" varchar(32) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"stats" jsonb NOT NULL,
	"body" text NOT NULL,
	"sent_to" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	CONSTRAINT "pk_reports" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "fk_reports_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_reports_kind_period_end" ON "reports" USING btree ("kind","period_end");