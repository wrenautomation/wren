CREATE TABLE "discovery_attempts" (
	"id" serial NOT NULL,
	"company_id" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"outcome" varchar(32) NOT NULL,
	"import_id" integer,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_discovery_attempts" PRIMARY KEY("id"),
	CONSTRAINT "ck_discovery_attempts_kind" CHECK (("kind")::text = ANY ((ARRAY['discover'::character varying, 'verify'::character varying])::text[])),
	CONSTRAINT "ck_discovery_attempts_outcome" CHECK (("outcome")::text = ANY ((ARRAY['attached'::character varying, 'verified'::character varying, 'no_name'::character varying, 'no_candidate'::character varying, 'unreachable'::character varying, 'gate_rejected'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "discovery_attempts" ADD CONSTRAINT "fk_discovery_attempts_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_attempts" ADD CONSTRAINT "fk_discovery_attempts_import_id_imports" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_discovery_attempts_company_kind" ON "discovery_attempts" USING btree ("company_id","kind","attempted_at");