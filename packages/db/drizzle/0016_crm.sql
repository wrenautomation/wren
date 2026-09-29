CREATE TABLE "crm_contacts" (
	"id" serial NOT NULL,
	"person_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"import_id" integer NOT NULL,
	"row_number" integer NOT NULL,
	"format" varchar(32) NOT NULL,
	"crm_key" varchar(128) NOT NULL,
	"email" varchar(320),
	"phone" varchar(64),
	"owner" text,
	"status" text,
	"last_contacted_on" date,
	"last_placement_on" date,
	"added_on" date,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_crm_contacts" PRIMARY KEY("id"),
	CONSTRAINT "uq_crm_contacts_key" UNIQUE("format","crm_key")
);
--> statement-breakpoint
ALTER TABLE "people" DROP CONSTRAINT "ck_people_personorigin";--> statement-breakpoint
ALTER TABLE "contact_candidates" DROP CONSTRAINT "ck_contact_candidates_candidateevidence";--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "fk_crm_contacts_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "fk_crm_contacts_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "fk_crm_contacts_import_id_imports" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_crm_contacts_person_id" ON "crm_contacts" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "ck_people_personorigin" CHECK (("origin")::text = ANY ((ARRAY['registry'::character varying, 'website'::character varying, 'document'::character varying, 'manual'::character varying, 'linkedin'::character varying, 'crm'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "contact_candidates" ADD CONSTRAINT "ck_contact_candidates_candidateevidence" CHECK (("evidence")::text = ANY ((ARRAY['scraped'::character varying, 'derived_pattern'::character varying, 'guessed_pattern'::character varying, 'crm'::character varying])::text[]));