CREATE TABLE "video_projects" (
	"id" serial NOT NULL,
	"title" text NOT NULL,
	"kind" varchar(8) DEFAULT 'long' NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"inspiration" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edit_id" integer,
	"subjects" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"folder" integer,
	"by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_video_projects" PRIMARY KEY("id"),
	CONSTRAINT "ck_video_projects_kind" CHECK (("kind")::text = ANY ((ARRAY['long'::character varying, 'short'::character varying, 'ad'::character varying, 'demo'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "fk_video_projects_edit_id_video_edits" FOREIGN KEY ("edit_id") REFERENCES "public"."video_edits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_video_projects_edit" ON "video_projects" USING btree ("edit_id");