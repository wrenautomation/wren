CREATE TABLE "reach_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform" varchar(16) NOT NULL,
	"account" varchar(120) NOT NULL,
	"handle" varchar(120),
	"state" varchar(16) DEFAULT 'warming' NOT NULL,
	"paused_reason" text,
	"started_on" date NOT NULL,
	"health" jsonb,
	"health_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "uq_reach_accounts_platform_account" UNIQUE("platform","account"),
	CONSTRAINT "ck_reach_accounts_platform" CHECK (("platform")::text = ANY ((ARRAY['reddit'::character varying, 'linkedin'::character varying])::text[])),
	CONSTRAINT "ck_reach_accounts_state" CHECK (("state")::text = ANY ((ARRAY['warming'::character varying, 'active'::character varying, 'paused'::character varying, 'retired'::character varying])::text[])),
	CONSTRAINT "ck_reach_accounts_paused_reason_iff_paused" CHECK (((state)::text = 'paused'::text) = (paused_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "reach_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(16) NOT NULL,
	"handle" varchar(120) NOT NULL,
	"url" text NOT NULL,
	"name" text,
	"headline" text,
	"found_in" varchar(200) NOT NULL,
	"company_id" integer,
	"person_id" integer,
	"niche" varchar(32),
	"profile" jsonb,
	"enriched_at" timestamp with time zone,
	"account_id" uuid,
	"state" varchar(16) DEFAULT 'new' NOT NULL,
	"state_reason" text,
	"sequence" varchar(64),
	"enrolled_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reach_contacts_platform_handle" UNIQUE("platform","handle"),
	CONSTRAINT "ck_reach_contacts_platform" CHECK (("platform")::text = ANY ((ARRAY['reddit'::character varying, 'linkedin'::character varying])::text[])),
	CONSTRAINT "ck_reach_contacts_state" CHECK (("state")::text = ANY ((ARRAY['new'::character varying, 'enrolled'::character varying, 'connected'::character varying, 'replied'::character varying, 'finished'::character varying, 'unreachable'::character varying, 'opted_out'::character varying, 'blocked'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "reach_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"account_id" uuid,
	"direction" varchar(4) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"step" smallint,
	"template" varchar(120),
	"subject" text,
	"body" text NOT NULL,
	"state" varchar(16) NOT NULL,
	"state_reason" text,
	"due_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"ref" varchar(200),
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reach_messages_direction" CHECK (("direction")::text = ANY ((ARRAY['out'::character varying, 'in'::character varying])::text[])),
	CONSTRAINT "ck_reach_messages_kind" CHECK (("kind")::text = ANY ((ARRAY['connect'::character varying, 'sequence'::character varying, 'manual'::character varying, 'inbound'::character varying])::text[])),
	CONSTRAINT "ck_reach_messages_state" CHECK (("state")::text = ANY ((ARRAY['queued'::character varying, 'sending'::character varying, 'sent'::character varying, 'failed'::character varying, 'unknown'::character varying, 'skipped'::character varying, 'received'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "reach_templates" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(200) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reach_contacts" ADD CONSTRAINT "fk_reach_contacts_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_contacts" ADD CONSTRAINT "fk_reach_contacts_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_contacts" ADD CONSTRAINT "fk_reach_contacts_account_id_reach_accounts" FOREIGN KEY ("account_id") REFERENCES "public"."reach_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_messages" ADD CONSTRAINT "fk_reach_messages_contact_id_reach_contacts" FOREIGN KEY ("contact_id") REFERENCES "public"."reach_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_messages" ADD CONSTRAINT "fk_reach_messages_account_id_reach_accounts" FOREIGN KEY ("account_id") REFERENCES "public"."reach_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_messages" ADD CONSTRAINT "fk_reach_messages_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_reach_contacts_state" ON "reach_contacts" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ix_reach_contacts_company_id" ON "reach_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_reach_messages_contact_id" ON "reach_messages" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "ix_reach_messages_due" ON "reach_messages" USING btree ("state","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reach_messages_in_ref" ON "reach_messages" USING btree ("contact_id","ref") WHERE (direction)::text = 'in'::text;