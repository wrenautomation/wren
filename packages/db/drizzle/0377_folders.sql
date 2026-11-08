CREATE SCHEMA "folders";
--> statement-breakpoint
CREATE TABLE "folders"."filed" (
	"kind" varchar(8) NOT NULL,
	"ref" text NOT NULL,
	"folder_id" integer NOT NULL,
	"subject_id" integer GENERATED ALWAYS AS (case when kind = 'subject' then ref::integer end) STORED,
	"filed_by" text NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_filed" PRIMARY KEY("kind","ref"),
	CONSTRAINT "ck_filed_ref" CHECK (length("folders"."filed"."ref") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "folders"."folders" (
	"id" serial NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"made_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_folders" PRIMARY KEY("id"),
	CONSTRAINT "uq_folders_name" UNIQUE NULLS NOT DISTINCT("parent_id","name"),
	CONSTRAINT "ck_folders_name" CHECK (length(btrim("folders"."folders"."name")) between 1 and 80),
	CONSTRAINT "ck_folders_not_own_parent" CHECK ("folders"."folders"."parent_id" is distinct from "folders"."folders"."id")
);
--> statement-breakpoint
ALTER TABLE "folders"."filed" ADD CONSTRAINT "fk_filed_folder" FOREIGN KEY ("folder_id") REFERENCES "folders"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders"."filed" ADD CONSTRAINT "fk_filed_subject" FOREIGN KEY ("subject_id") REFERENCES "vireo"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders"."folders" ADD CONSTRAINT "fk_folders_parent" FOREIGN KEY ("parent_id") REFERENCES "folders"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_filed_folder" ON "folders"."filed" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "ix_filed_subject" ON "folders"."filed" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "ix_folders_parent" ON "folders"."folders" USING btree ("parent_id");