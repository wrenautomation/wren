CREATE TABLE "changes" (
	"id" serial NOT NULL,
	"record" varchar(64) NOT NULL,
	"record_id" varchar(200) NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"version" varchar(16) NOT NULL,
	"by" varchar(200) NOT NULL,
	"via" varchar(16) NOT NULL,
	"run_id" uuid,
	"undoes" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_changes" PRIMARY KEY("id"),
	CONSTRAINT "uq_changes_undoes" UNIQUE("undoes"),
	CONSTRAINT "ck_changes_via" CHECK (("via")::text = ANY ((ARRAY['person'::character varying, 'claude'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "fk_changes_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "fk_changes_undoes_changes" FOREIGN KEY ("undoes") REFERENCES "public"."changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_changes_record_record_id" ON "changes" USING btree ("record","record_id","id");--> statement-breakpoint
CREATE INDEX "ix_changes_run_id" ON "changes" USING btree ("run_id");