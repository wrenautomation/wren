CREATE TABLE "creator_finds" (
	"id" serial NOT NULL,
	"input" text NOT NULL,
	"input_key" text NOT NULL,
	"name" text,
	"niche" text NOT NULL,
	"person_id" integer,
	"state" varchar(16) DEFAULT 'waiting' NOT NULL,
	"step" text,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" text,
	"usd" real,
	"error" text,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_creator_finds" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "creator_finds" ADD CONSTRAINT "fk_creator_finds_person_id_creator_people" FOREIGN KEY ("person_id") REFERENCES "public"."creator_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_creator_finds_open_input_key" ON "creator_finds" USING btree ("input_key") WHERE "creator_finds"."state" in ('waiting', 'finding');