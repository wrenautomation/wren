CREATE TABLE "note_links" (
	"note_id" uuid NOT NULL,
	"target" varchar(300) NOT NULL,
	"label" varchar(300) DEFAULT '' NOT NULL,
	CONSTRAINT "pk_note_links" PRIMARY KEY("note_id","target")
);
--> statement-breakpoint
CREATE TABLE "note_seen" (
	"note_id" uuid NOT NULL,
	"email" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_note_seen" PRIMARY KEY("note_id","email")
);
--> statement-breakpoint
CREATE TABLE "note_shares" (
	"note_id" uuid NOT NULL,
	"who" varchar(200) NOT NULL,
	"role" varchar(8) NOT NULL,
	"by" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_note_shares" PRIMARY KEY("note_id","who"),
	CONSTRAINT "ck_note_shares_role" CHECK (("role")::text = ANY ((ARRAY['view'::character varying, 'comment'::character varying, 'edit'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "note_stars" (
	"note_id" uuid NOT NULL,
	"email" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_note_stars" PRIMARY KEY("note_id","email")
);
--> statement-breakpoint
CREATE TABLE "note_updates" (
	"id" serial NOT NULL,
	"note_id" uuid NOT NULL,
	"update" "bytea" NOT NULL,
	"by" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_note_updates" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "note_versions" (
	"id" serial NOT NULL,
	"note_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" varchar(8) NOT NULL,
	"name" varchar(200),
	"title" varchar(300) DEFAULT '' NOT NULL,
	"body" jsonb NOT NULL,
	"text" text NOT NULL,
	"authors" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_from" integer,
	CONSTRAINT "pk_note_versions" PRIMARY KEY("id"),
	CONSTRAINT "ck_note_versions_kind" CHECK (("kind")::text = ANY ((ARRAY['auto'::character varying, 'named'::character varying, 'restore'::character varying, 'import'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"kind" varchar(8) DEFAULT 'note' NOT NULL,
	"title" varchar(300) DEFAULT '' NOT NULL,
	"body" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (title)::text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, text), 'B'::"char")) STORED,
	"y_state" "bytea",
	"owner" varchar(200) NOT NULL,
	"created_by" varchar(200) NOT NULL,
	"via" varchar(8) DEFAULT 'person' NOT NULL,
	"general" varchar(12) DEFAULT 'private' NOT NULL,
	"general_role" varchar(8) DEFAULT 'view' NOT NULL,
	"train" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_by" varchar(200),
	CONSTRAINT "pk_notes" PRIMARY KEY("id"),
	CONSTRAINT "ck_notes_kind" CHECK (("kind")::text = ANY ((ARRAY['note'::character varying, 'dump'::character varying])::text[])),
	CONSTRAINT "ck_notes_via" CHECK (("via")::text = ANY ((ARRAY['person'::character varying, 'agent'::character varying])::text[])),
	CONSTRAINT "ck_notes_general" CHECK (("general")::text = ANY ((ARRAY['private'::character varying, 'workspace'::character varying])::text[])),
	CONSTRAINT "ck_notes_general_role" CHECK (("general_role")::text = ANY ((ARRAY['view'::character varying, 'comment'::character varying, 'edit'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "notes_settings" (
	"id" integer DEFAULT 1 NOT NULL,
	"train" boolean DEFAULT false NOT NULL,
	"updated_by" varchar(200),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_notes_settings" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "fk_note_links_note" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_seen" ADD CONSTRAINT "fk_note_seen_note" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "fk_note_shares_note" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_stars" ADD CONSTRAINT "fk_note_stars_note" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_updates" ADD CONSTRAINT "fk_note_updates_note" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "fk_note_versions_note" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "fk_notes_parent" FOREIGN KEY ("parent_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_note_links_target" ON "note_links" USING btree ("target");--> statement-breakpoint
CREATE INDEX "ix_note_seen_email" ON "note_seen" USING btree ("email","at");--> statement-breakpoint
CREATE INDEX "ix_note_shares_who" ON "note_shares" USING btree ("who");--> statement-breakpoint
CREATE INDEX "ix_note_updates_note" ON "note_updates" USING btree ("note_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_note_versions_number" ON "note_versions" USING btree ("note_id","number");--> statement-breakpoint
CREATE INDEX "ix_notes_owner" ON "notes" USING btree ("owner","updated_at");--> statement-breakpoint
CREATE INDEX "ix_notes_updated" ON "notes" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ix_notes_parent" ON "notes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_notes_search" ON "notes" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notes_dump" ON "notes" USING btree ("owner") WHERE kind = 'dump';