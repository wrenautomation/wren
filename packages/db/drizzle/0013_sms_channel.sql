CREATE TABLE "sms_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"e164" varchar(16) NOT NULL,
	"company_id" integer,
	"person_id" integer,
	"source_document_id" integer,
	"source_url" text,
	"source_kind" varchar(16) NOT NULL,
	"basis" varchar(16) NOT NULL,
	"basis_detail" text,
	"line_type" varchar(16) DEFAULT 'unknown' NOT NULL,
	"carrier" varchar(128),
	"looked_up_at" timestamp with time zone,
	"lookup" jsonb,
	"number_id" uuid,
	"state" varchar(16) DEFAULT 'new' NOT NULL,
	"state_reason" text,
	"niche" varchar(32),
	"sequence" varchar(64),
	"enrolled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sms_contacts_e164_company" UNIQUE("e164","company_id"),
	CONSTRAINT "ck_sms_contacts_contactbasis" CHECK (("basis")::text = ANY ((ARRAY['published'::character varying, 'opt_in'::character varying])::text[])),
	CONSTRAINT "ck_sms_contacts_linetype" CHECK (("line_type")::text = ANY ((ARRAY['mobile'::character varying, 'landline'::character varying, 'voip'::character varying, 'toll_free'::character varying, 'unknown'::character varying])::text[])),
	CONSTRAINT "ck_sms_contacts_contactstate" CHECK (("state")::text = ANY ((ARRAY['new'::character varying, 'enrolled'::character varying, 'replied'::character varying, 'opted_out'::character varying, 'finished'::character varying, 'stopped'::character varying, 'unreachable'::character varying])::text[])),
	CONSTRAINT "ck_sms_contacts_e164" CHECK ((e164)::text ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "ck_sms_contacts_sequence_iff_enrolled_at" CHECK ((sequence IS NULL) = (enrolled_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sms_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(16) NOT NULL,
	"provider_event_id" varchar(64) NOT NULL,
	"type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text,
	CONSTRAINT "uq_sms_events_provider_event" UNIQUE("provider","provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"direction" varchar(4) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"step" smallint,
	"template" varchar(64),
	"number_id" uuid,
	"from_e164" varchar(16),
	"to_e164" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"state" varchar(16) NOT NULL,
	"provider_id" varchar(64),
	"parts" smallint,
	"cost_usd" double precision,
	"error_code" varchar(32),
	"detail" text,
	"due_at" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"disposition" varchar(16),
	"disposition_source" varchar(16),
	"classification" jsonb,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sms_messages_direction" CHECK (("direction")::text = ANY ((ARRAY['out'::character varying, 'in'::character varying])::text[])),
	CONSTRAINT "ck_sms_messages_messagekind" CHECK (("kind")::text = ANY ((ARRAY['sequence'::character varying, 'manual'::character varying, 'inbound'::character varying])::text[])),
	CONSTRAINT "ck_sms_messages_messagestate" CHECK (("state")::text = ANY ((ARRAY['queued'::character varying, 'sending'::character varying, 'sent'::character varying, 'delivered'::character varying, 'failed'::character varying, 'unknown'::character varying, 'skipped'::character varying, 'received'::character varying])::text[])),
	CONSTRAINT "ck_sms_messages_disposition" CHECK (("disposition")::text = ANY ((ARRAY['interested'::character varying, 'not_interested'::character varying, 'question'::character varying, 'wrong_person'::character varying, 'opt_out'::character varying, 'other'::character varying])::text[])),
	CONSTRAINT "ck_sms_messages_dispositionsource" CHECK (("disposition_source")::text = ANY ((ARRAY['rule'::character varying, 'llm'::character varying, 'operator'::character varying])::text[])),
	CONSTRAINT "ck_sms_messages_step_iff_sequence" CHECK ((step IS NOT NULL) = ((kind)::text = 'sequence'::text)),
	CONSTRAINT "ck_sms_messages_inbound_shape" CHECK (((direction)::text = 'in'::text) = ((kind)::text = 'inbound'::text) AND ((direction)::text = 'in'::text) = ((state)::text = 'received'::text)),
	CONSTRAINT "ck_sms_messages_sent_has_provider_id" CHECK (((state)::text <> ALL ((ARRAY['sent'::character varying, 'delivered'::character varying])::text[])) OR (provider_id IS NOT NULL)),
	CONSTRAINT "ck_sms_messages_disposition_source" CHECK ((disposition IS NULL) = (disposition_source IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sms_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"e164" varchar(16) NOT NULL,
	"provider" varchar(16) NOT NULL,
	"provider_id" varchar(64),
	"state" varchar(16) DEFAULT 'active' NOT NULL,
	"paused_reason" text,
	"paused_at" timestamp with time zone,
	"ramp_started_on" date NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "uq_sms_numbers_e164" UNIQUE("e164"),
	CONSTRAINT "ck_sms_numbers_numberstate" CHECK (("state")::text = ANY ((ARRAY['active'::character varying, 'paused'::character varying, 'retired'::character varying])::text[])),
	CONSTRAINT "ck_sms_numbers_paused_reason_iff_paused" CHECK (((state)::text = 'paused'::text) = (paused_reason IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "suppressions" DROP CONSTRAINT "ck_suppressions_suppressionkind";--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD CONSTRAINT "fk_sms_contacts_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD CONSTRAINT "fk_sms_contacts_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD CONSTRAINT "fk_sms_contacts_number_id_sms_numbers" FOREIGN KEY ("number_id") REFERENCES "public"."sms_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "fk_sms_messages_contact_id_sms_contacts" FOREIGN KEY ("contact_id") REFERENCES "public"."sms_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "fk_sms_messages_number_id_sms_numbers" FOREIGN KEY ("number_id") REFERENCES "public"."sms_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "fk_sms_messages_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_contacts_enrolled_e164" ON "sms_contacts" USING btree ("e164") WHERE (state)::text = 'enrolled'::text;--> statement-breakpoint
CREATE INDEX "ix_sms_contacts_company_id" ON "sms_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_sms_contacts_state" ON "sms_contacts" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ix_sms_messages_contact_id" ON "sms_messages" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "ix_sms_messages_state_due" ON "sms_messages" USING btree ("state","due_at");--> statement-breakpoint
CREATE INDEX "ix_sms_messages_number_attempted" ON "sms_messages" USING btree ("number_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_messages_provider_id" ON "sms_messages" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_messages_contact_step" ON "sms_messages" USING btree ("contact_id","step") WHERE (kind)::text = 'sequence'::text;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "ck_suppressions_suppressionkind" CHECK (("kind")::text = ANY ((ARRAY['email'::character varying, 'domain'::character varying, 'phone'::character varying])::text[]));