CREATE TABLE "video_marks" (
	"id" serial NOT NULL,
	"edit_id" integer NOT NULL,
	"anchor" jsonb NOT NULL,
	"format" varchar(12) DEFAULT 'long' NOT NULL,
	"tone" varchar(4),
	"text" text NOT NULL,
	"by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" varchar(320),
	"done_why" text,
	"done_run" varchar(64),
	"removed_at" timestamp with time zone,
	"removed_by" varchar(320),
	CONSTRAINT "pk_video_marks" PRIMARY KEY("id"),
	CONSTRAINT "ck_video_marks_tone" CHECK (("tone")::text = ANY ((ARRAY['good'::character varying, 'bad'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "video_marks" ADD CONSTRAINT "fk_video_marks_edit_id_video_edits" FOREIGN KEY ("edit_id") REFERENCES "public"."video_edits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_video_marks_edit" ON "video_marks" USING btree ("edit_id");