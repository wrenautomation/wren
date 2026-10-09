CREATE TABLE "site_form_splits" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40),
	"form" uuid NOT NULL,
	"state" varchar(8) DEFAULT 'running' NOT NULL,
	"b" jsonb NOT NULL,
	"weight" integer DEFAULT 50 NOT NULL,
	"winner" varchar(1),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" text NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_site_form_splits" PRIMARY KEY("id"),
	CONSTRAINT "ck_site_form_splits_state" CHECK (("state")::text = ANY ((ARRAY['running'::character varying, 'shipped'::character varying, 'stopped'::character varying])::text[])),
	CONSTRAINT "ck_site_form_splits_winner" CHECK (("winner")::text = ANY ((ARRAY['A'::character varying, 'B'::character varying])::text[])),
	CONSTRAINT "ck_site_form_splits_weight" CHECK ("site_form_splits"."weight" between 1 and 99),
	CONSTRAINT "ck_site_form_splits_ended" CHECK (("site_form_splits"."state" = 'running') = ("site_form_splits"."ended_at" is null))
);
--> statement-breakpoint
ALTER TABLE "site_events" ADD COLUMN "form_split" uuid;--> statement-breakpoint
ALTER TABLE "site_events" ADD COLUMN "arm" varchar(1);--> statement-breakpoint
ALTER TABLE "site_forms" ADD COLUMN "form_split" uuid;--> statement-breakpoint
ALTER TABLE "site_forms" ADD COLUMN "arm" varchar(1);--> statement-breakpoint
ALTER TABLE "site_form_splits" ADD CONSTRAINT "fk_site_form_splits_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_form_splits" ADD CONSTRAINT "fk_site_form_splits_form" FOREIGN KEY ("form") REFERENCES "public"."site_form_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_site_form_splits_running" ON "site_form_splits" USING btree ("form") WHERE "site_form_splits"."state" = 'running';--> statement-breakpoint
CREATE INDEX "ix_site_form_splits_form" ON "site_form_splits" USING btree ("form");--> statement-breakpoint
CREATE INDEX "ix_site_form_splits_client" ON "site_form_splits" USING btree ("client");--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "fk_site_events_form_split" FOREIGN KEY ("form_split") REFERENCES "public"."site_form_splits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_forms" ADD CONSTRAINT "fk_site_forms_form_split" FOREIGN KEY ("form_split") REFERENCES "public"."site_form_splits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_site_events_form_split" ON "site_events" USING btree ("form_split") WHERE "site_events"."form_split" is not null;--> statement-breakpoint
CREATE INDEX "ix_site_forms_form_split" ON "site_forms" USING btree ("form_split") WHERE "site_forms"."form_split" is not null;--> statement-breakpoint
ALTER TABLE "site_events" ADD CONSTRAINT "ck_site_events_arm" CHECK (("arm")::text = ANY ((ARRAY['A'::character varying, 'B'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "site_forms" ADD CONSTRAINT "ck_site_forms_arm" CHECK (("arm")::text = ANY ((ARRAY['A'::character varying, 'B'::character varying])::text[]));