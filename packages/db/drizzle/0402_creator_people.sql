CREATE TABLE "creator_people" (
	"id" serial NOT NULL,
	"name" text,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_creator_people" PRIMARY KEY("id")
);
--> statement-breakpoint
-- one person per account, with the account's id: `creator=` links keep working
INSERT INTO "creator_people" ("id", "added_by", "added_at") SELECT "id", "added_by", "added_at" FROM "tracked_creators";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('creator_people', 'id'), GREATEST((SELECT max("id") FROM "creator_people"), 1));--> statement-breakpoint
ALTER TABLE "tracked_creators" ADD COLUMN "person_id" integer;--> statement-breakpoint
UPDATE "tracked_creators" SET "person_id" = "id";--> statement-breakpoint
ALTER TABLE "tracked_creators" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_creators" ADD CONSTRAINT "fk_tracked_creators_person_id_creator_people" FOREIGN KEY ("person_id") REFERENCES "public"."creator_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_tracked_creators_person_id" ON "tracked_creators" USING btree ("person_id");
