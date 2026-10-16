CREATE SEQUENCE "delivery"."invoice_number" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE TABLE "delivery"."wise_credits" (
	"id" serial NOT NULL,
	"wise_id" varchar(128) NOT NULL,
	"balance_id" varchar(32) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" varchar(40) NOT NULL,
	"payer" text,
	"memo" text,
	"description" text,
	"status" varchar(16) NOT NULL,
	"invoice_id" integer,
	"why" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_wise_credits" PRIMARY KEY("id"),
	CONSTRAINT "uq_wise_credits_wise_id" UNIQUE("wise_id"),
	CONSTRAINT "ck_wise_credits_status" CHECK (("status")::text = ANY ((ARRAY['matched'::character varying, 'review'::character varying, 'ignored'::character varying, 'dismissed'::character varying])::text[])),
	CONSTRAINT "ck_wise_credits_cents" CHECK ("delivery"."wise_credits"."cents" > 0),
	CONSTRAINT "ck_wise_credits_currency" CHECK ("delivery"."wise_credits"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ck_wise_credits_matched" CHECK ("delivery"."wise_credits"."status" <> 'matched' or "delivery"."wise_credits"."invoice_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ALTER COLUMN "number" SET DEFAULT 'WREN-' || nextval('delivery.invoice_number');--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ADD COLUMN "received_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ADD COLUMN "mailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery"."wise_credits" ADD CONSTRAINT "fk_wise_credits_invoice" FOREIGN KEY ("invoice_id") REFERENCES "delivery"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_wise_credits_status" ON "delivery"."wise_credits" USING btree ("status","at");--> statement-breakpoint
CREATE INDEX "ix_wise_credits_invoice" ON "delivery"."wise_credits" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ADD CONSTRAINT "ck_invoices_received" CHECK ("delivery"."invoices"."received_cents" >= 0);