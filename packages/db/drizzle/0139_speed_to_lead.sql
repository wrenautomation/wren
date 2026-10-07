CREATE TABLE "speed_runs" (
	"id" serial NOT NULL,
	"workflow" varchar(64) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"lead_at" timestamp with time zone NOT NULL,
	"name" text,
	"phone" varchar(64),
	"e164" varchar(16),
	"email" text,
	"source" text,
	"consent" boolean NOT NULL,
	"consent_detail" text,
	"zone" varchar(64),
	"sms_contact_id" integer,
	"first_touch" varchar(16) NOT NULL,
	"first_touch_at" timestamp with time zone,
	"first_touch_detail" text,
	"call" varchar(16),
	"call_at" timestamp with time zone,
	"call_detail" text,
	"booked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_speed_runs" PRIMARY KEY("id"),
	CONSTRAINT "uq_speed_runs_workflow_subject" UNIQUE("workflow","subject"),
	CONSTRAINT "ck_speed_runs_first_touch" CHECK (("first_touch")::text = ANY ((ARRAY['queued'::character varying, 'sent'::character varying, 'would_send'::character varying, 'no_consent'::character varying, 'no_phone'::character varying, 'refused'::character varying])::text[])),
	CONSTRAINT "ck_speed_runs_call" CHECK (("call")::text = ANY ((ARRAY['alerted'::character varying, 'dialed'::character varying, 'skipped'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "sms_contacts" DROP CONSTRAINT "ck_sms_contacts_source_kind";--> statement-breakpoint
ALTER TABLE "hooks" ADD COLUMN "fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD COLUMN "zone" varchar(64);--> statement-breakpoint
ALTER TABLE "speed_runs" ADD CONSTRAINT "fk_speed_runs_sms_contact_id_sms_contacts" FOREIGN KEY ("sms_contact_id") REFERENCES "public"."sms_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_speed_runs_sms_contact_id" ON "speed_runs" USING btree ("sms_contact_id");--> statement-breakpoint
CREATE INDEX "ix_speed_runs_lead_at" ON "speed_runs" USING btree ("lead_at");--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD CONSTRAINT "ck_sms_contacts_source_kind" CHECK (("source_kind")::text = ANY ((ARRAY['tel_link'::character varying, 'page_text'::character varying, 'manual'::character varying, 'inbound'::character varying, 'form'::character varying, 'hook'::character varying])::text[]));