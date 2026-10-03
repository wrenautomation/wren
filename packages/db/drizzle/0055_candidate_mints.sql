CREATE TABLE "candidate_mints" (
	"person_id" integer NOT NULL,
	"minted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_candidate_mints" PRIMARY KEY("person_id")
);
--> statement-breakpoint
ALTER TABLE "candidate_mints" ADD CONSTRAINT "fk_candidate_mints_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "candidate_mints" ("person_id", "minted_at")
SELECT "person_id", min("created_at") FROM "contact_candidates" GROUP BY "person_id";
