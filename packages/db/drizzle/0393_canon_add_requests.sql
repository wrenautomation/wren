CREATE TABLE "canon_add_requests" (
	"id" serial NOT NULL,
	"what" text NOT NULL,
	"file_name" text,
	"note" text,
	"person" text NOT NULL,
	"asked_by" text NOT NULL,
	"state" varchar(8) DEFAULT 'pending' NOT NULL,
	"worker" text,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"records" text[],
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "pk_canon_add_requests" PRIMARY KEY("id"),
	CONSTRAINT "ck_canon_add_requests_state" CHECK (("state")::text = ANY ((ARRAY['pending'::character varying, 'claimed'::character varying, 'done'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE INDEX "ix_canon_add_requests_state" ON "canon_add_requests" USING btree ("state","at");