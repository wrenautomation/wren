CREATE TABLE "mover_addresses" (
	"finding_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"domain" varchar(255),
	"outcome" varchar(16) NOT NULL,
	"candidate_id" integer,
	"tried_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_mover_addresses" PRIMARY KEY("finding_id"),
	CONSTRAINT "ck_mover_addresses_moveroutcome" CHECK (("outcome")::text = ANY ((ARRAY['found'::character varying, 'no_domain'::character varying, 'catch_all'::character varying, 'not_found'::character varying])::text[])),
	CONSTRAINT "ck_mover_addresses_found_iff_candidate" CHECK (("mover_addresses"."candidate_id" is not null) = ("mover_addresses"."outcome" = 'found'))
);
--> statement-breakpoint
ALTER TABLE "contact_scores" ADD COLUMN "next_step" varchar(16);--> statement-breakpoint
ALTER TABLE "mover_addresses" ADD CONSTRAINT "fk_mover_addresses_finding_id_findings" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mover_addresses" ADD CONSTRAINT "fk_mover_addresses_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mover_addresses" ADD CONSTRAINT "fk_mover_addresses_candidate_id_contact_candidates" FOREIGN KEY ("candidate_id") REFERENCES "public"."contact_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_mover_addresses_person_id" ON "mover_addresses" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_mover_addresses_candidate_id" ON "mover_addresses" USING btree ("candidate_id");--> statement-breakpoint
ALTER TABLE "contact_scores" ADD CONSTRAINT "ck_contact_scores_nextstep" CHECK (("next_step")::text = ANY ((ARRAY['reach_out'::character varying, 'keep_warm'::character varying, 'none'::character varying])::text[]));