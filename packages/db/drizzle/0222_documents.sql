CREATE TABLE "doc_counters" (
	"client" varchar(40) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_doc_counters" PRIMARY KEY("client","kind"),
	CONSTRAINT "ck_doc_counters_kind" CHECK (("kind")::text = ANY ((ARRAY['contract'::character varying, 'proposal'::character varying, 'estimate'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "doc_events" (
	"id" bigserial NOT NULL,
	"document" uuid NOT NULL,
	"type" varchar(10) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" text NOT NULL,
	"ip" varchar(64),
	"agent" text,
	"note" text,
	CONSTRAINT "pk_doc_events" PRIMARY KEY("id"),
	CONSTRAINT "ck_doc_events_type" CHECK (("type")::text = ANY ((ARRAY['made'::character varying, 'asked'::character varying, 'sent'::character varying, 'viewed'::character varying, 'signed'::character varying, 'declined'::character varying, 'paid'::character varying, 'voided'::character varying, 'expired'::character varying, 'reminded'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "doc_templates" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"name" varchar(120) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deposit_pct" integer,
	"expires_days" integer DEFAULT 30 NOT NULL,
	"starter" varchar(20),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_doc_templates" PRIMARY KEY("id"),
	CONSTRAINT "ck_doc_templates_kind" CHECK (("kind")::text = ANY ((ARRAY['contract'::character varying, 'proposal'::character varying, 'estimate'::character varying])::text[])),
	CONSTRAINT "ck_doc_templates_deposit" CHECK ("doc_templates"."deposit_pct" between 1 and 100),
	CONSTRAINT "ck_doc_templates_expires" CHECK ("doc_templates"."expires_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "docs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40) NOT NULL,
	"template" uuid,
	"kind" varchar(10) NOT NULL,
	"number" varchar(16) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer,
	"name" text,
	"email" text,
	"contact" integer,
	"channel" varchar(8) DEFAULT 'email' NOT NULL,
	"status" varchar(8) DEFAULT 'draft' NOT NULL,
	"why" text,
	"token_hash" varchar(64),
	"expires_days" integer DEFAULT 30 NOT NULL,
	"expires_at" timestamp with time zone,
	"sha256" varchar(64),
	"message" integer,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"signer_name" text,
	"signer_email" text,
	"signed_ip" varchar(64),
	"signed_agent" text,
	"consent_version" varchar(16),
	"declined_why" text,
	"pay_link" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	CONSTRAINT "pk_docs" PRIMARY KEY("id"),
	CONSTRAINT "ck_docs_kind" CHECK (("kind")::text = ANY ((ARRAY['contract'::character varying, 'proposal'::character varying, 'estimate'::character varying])::text[])),
	CONSTRAINT "ck_docs_channel" CHECK (("channel")::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying])::text[])),
	CONSTRAINT "ck_docs_status" CHECK (("status")::text = ANY ((ARRAY['draft'::character varying, 'waiting'::character varying, 'sending'::character varying, 'sent'::character varying, 'viewed'::character varying, 'signed'::character varying, 'declined'::character varying, 'expired'::character varying, 'void'::character varying, 'failed'::character varying])::text[])),
	CONSTRAINT "ck_docs_totals" CHECK ("docs"."total_cents" = "docs"."subtotal_cents" + "docs"."tax_cents"),
	CONSTRAINT "ck_docs_deposit" CHECK ("docs"."deposit_cents" is null or ("docs"."deposit_cents" >= 50 and "docs"."deposit_cents" <= "docs"."total_cents")),
	CONSTRAINT "ck_docs_signed" CHECK ("docs"."status" <> 'signed' or ("docs"."signer_name" is not null and "docs"."signed_at" is not null and "docs"."sha256" is not null))
);
--> statement-breakpoint
ALTER TABLE "sms_messages" DROP CONSTRAINT "ck_sms_messages_messagekind";--> statement-breakpoint
ALTER TABLE "pay_links" ADD COLUMN "document" uuid;--> statement-breakpoint
ALTER TABLE "doc_counters" ADD CONSTRAINT "fk_doc_counters_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_events" ADD CONSTRAINT "fk_doc_events_document" FOREIGN KEY ("document") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "fk_doc_templates_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "fk_docs_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "fk_docs_template" FOREIGN KEY ("template") REFERENCES "public"."doc_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_doc_events_document" ON "doc_events" USING btree ("document","at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_doc_templates_starter" ON "doc_templates" USING btree ("client","starter");--> statement-breakpoint
CREATE INDEX "ix_docs_client_created" ON "docs" USING btree ("client","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_docs_number" ON "docs" USING btree ("client","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_docs_token" ON "docs" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_docs_status" ON "docs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_docs_template" ON "docs" USING btree ("template");--> statement-breakpoint
CREATE INDEX "ix_pay_links_document" ON "pay_links" USING btree ("document");--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "ck_sms_messages_messagekind" CHECK (("kind")::text = ANY ((ARRAY['sequence'::character varying, 'manual'::character varying, 'reminder'::character varying, 'inbound'::character varying, 'follow_up'::character varying, 'text_back'::character varying, 'review'::character varying, 'pay'::character varying, 'doc'::character varying])::text[]));