CREATE TABLE "client_report_sends" (
	"id" serial NOT NULL,
	"report_id" integer NOT NULL,
	"from" timestamp with time zone NOT NULL,
	"to" timestamp with time zone NOT NULL,
	"closed" boolean NOT NULL,
	"lines" jsonb NOT NULL,
	"sent_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why" text,
	"by" varchar(320),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_client_report_sends" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "client_reports" (
	"id" serial NOT NULL,
	"client" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"tiles" jsonb NOT NULL,
	"every" varchar(8) NOT NULL,
	"zone" varchar(64) NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"on" boolean DEFAULT true NOT NULL,
	"next_at" timestamp with time zone,
	"by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_client_reports" PRIMARY KEY("id"),
	CONSTRAINT "ck_client_reports_every" CHECK (("every")::text = ANY ((ARRAY['week'::character varying, 'month'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "client_report_sends" ADD CONSTRAINT "fk_client_report_sends_report" FOREIGN KEY ("report_id") REFERENCES "public"."client_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_client_report_sends_report" ON "client_report_sends" USING btree ("report_id","at");--> statement-breakpoint
CREATE INDEX "ix_client_reports_client" ON "client_reports" USING btree ("client");