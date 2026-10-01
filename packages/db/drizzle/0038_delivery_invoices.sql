CREATE TABLE "delivery"."invoices" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"number" varchar(64) NOT NULL,
	"description" text NOT NULL,
	"cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"paid_on" date,
	"link" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_invoices" PRIMARY KEY("id"),
	CONSTRAINT "uq_invoices_number" UNIQUE("number"),
	CONSTRAINT "ck_invoices_status" CHECK (("status")::text = ANY ((ARRAY['open'::character varying, 'paid'::character varying, 'void'::character varying])::text[])),
	CONSTRAINT "ck_invoices_cents" CHECK ("delivery"."invoices"."cents" > 0),
	CONSTRAINT "ck_invoices_currency" CHECK ("delivery"."invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ck_invoices_paid" CHECK (("delivery"."invoices"."status" = 'paid') = ("delivery"."invoices"."paid_on" is not null))
);
--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ADD CONSTRAINT "fk_invoices_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_invoices_engagement" ON "delivery"."invoices" USING btree ("engagement_id");