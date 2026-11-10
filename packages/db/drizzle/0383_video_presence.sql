CREATE TABLE "video_presence" (
	"id" serial NOT NULL,
	"edit_id" integer NOT NULL,
	"who" varchar(320) NOT NULL,
	"anchor" jsonb,
	"part" varchar(12),
	"doing" text,
	"gone" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_video_presence" PRIMARY KEY("id"),
	CONSTRAINT "ck_video_presence_part" CHECK (("part")::text = ANY ((ARRAY['cuts'::character varying, 'text'::character varying, 'captions'::character varying, 'cover'::character varying, 'shapes'::character varying, 'shorts'::character varying, 'layout'::character varying, 'marks'::character varying, 'sound'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "video_presence" ADD CONSTRAINT "fk_video_presence_edit_id_video_edits" FOREIGN KEY ("edit_id") REFERENCES "public"."video_edits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_video_presence_edit_seen" ON "video_presence" USING btree ("edit_id","seen_at");