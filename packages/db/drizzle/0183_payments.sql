CREATE TABLE "pay_accounts" (
	"client" varchar(40) NOT NULL,
	"endpoint" varchar(80),
	"secret_name" text,
	"how" varchar(8),
	"live" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_pay_accounts" PRIMARY KEY("client"),
	CONSTRAINT "ck_pay_accounts_how" CHECK (("how")::text = ANY ((ARRAY['api'::character varying, 'pasted'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "pay_events" (
	"id" varchar(80) NOT NULL,
	"client" varchar(40) NOT NULL,
	"type" varchar(80) NOT NULL,
	"link" uuid,
	"result" varchar(8) NOT NULL,
	"seen" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pay_events" PRIMARY KEY("id"),
	CONSTRAINT "ck_pay_events_result" CHECK (("result")::text = ANY ((ARRAY['paid'::character varying, 'unpaid'::character varying, 'unknown'::character varying, 'ignored'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "pay_links" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client" varchar(40) NOT NULL,
	"contact" integer,
	"email" text,
	"name" text,
	"channel" varchar(8) NOT NULL,
	"description" varchar(200) NOT NULL,
	"amount_cents" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"status" varchar(8) DEFAULT 'waiting' NOT NULL,
	"why" text,
	"stripe_link" varchar(80),
	"url" text,
	"message" bigint,
	"sent_at" timestamp with time zone,
	"paid_cents" integer,
	"paid_at" timestamp with time zone,
	"session" varchar(80),
	"live" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	CONSTRAINT "pk_pay_links" PRIMARY KEY("id"),
	CONSTRAINT "ck_pay_links_channel" CHECK (("channel")::text = ANY ((ARRAY['sms'::character varying, 'email'::character varying])::text[])),
	CONSTRAINT "ck_pay_links_status" CHECK (("status")::text = ANY ((ARRAY['waiting'::character varying, 'sending'::character varying, 'sent'::character varying, 'paid'::character varying, 'declined'::character varying, 'failed'::character varying])::text[])),
	CONSTRAINT "ck_pay_links_amount" CHECK ("pay_links"."amount_cents" >= 50 and "pay_links"."amount_cents" <= 99999999),
	CONSTRAINT "ck_pay_links_quantity" CHECK ("pay_links"."quantity" between 1 and 100),
	CONSTRAINT "ck_pay_links_to" CHECK (("pay_links"."channel" = 'sms' and "pay_links"."contact" is not null) or ("pay_links"."channel" = 'email' and "pay_links"."email" is not null))
);
--> statement-breakpoint
ALTER TABLE "sms_messages" DROP CONSTRAINT "ck_sms_messages_messagekind";--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD COLUMN "paid_cents" integer;--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pay_accounts" ADD CONSTRAINT "fk_pay_accounts_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_events" ADD CONSTRAINT "fk_pay_events_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_events" ADD CONSTRAINT "fk_pay_events_link" FOREIGN KEY ("link") REFERENCES "public"."pay_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_links" ADD CONSTRAINT "fk_pay_links_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_pay_events_client_at" ON "pay_events" USING btree ("client","at");--> statement-breakpoint
CREATE INDEX "ix_pay_events_link" ON "pay_events" USING btree ("link");--> statement-breakpoint
CREATE INDEX "ix_pay_links_client_created" ON "pay_links" USING btree ("client","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pay_links_stripe_link" ON "pay_links" USING btree ("stripe_link");--> statement-breakpoint
CREATE INDEX "ix_pay_links_status" ON "pay_links" USING btree ("status");--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "ck_sms_messages_messagekind" CHECK (("kind")::text = ANY ((ARRAY['sequence'::character varying, 'manual'::character varying, 'reminder'::character varying, 'inbound'::character varying, 'follow_up'::character varying, 'text_back'::character varying, 'review'::character varying, 'pay'::character varying])::text[]));