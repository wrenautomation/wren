CREATE TABLE "books"."usage_lines" (
	"id" serial NOT NULL,
	"client" varchar(40),
	"vendor" varchar(32) NOT NULL,
	"month" date NOT NULL,
	"units" bigint NOT NULL,
	"cost_cents" bigint NOT NULL,
	"markup_pct" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"state" varchar(12) DEFAULT 'draft' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_usage_lines" PRIMARY KEY("id"),
	CONSTRAINT "uq_usage_lines_month" UNIQUE NULLS NOT DISTINCT("client","vendor","month"),
	CONSTRAINT "ck_usage_lines_state" CHECK (("state")::text = ANY ((ARRAY['draft'::character varying, 'on_invoice'::character varying])::text[]))
);
--> statement-breakpoint
CREATE INDEX "ix_usage_lines_month" ON "books"."usage_lines" USING btree ("month");