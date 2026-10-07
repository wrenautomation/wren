CREATE TABLE "note_comments" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"parent_id" uuid,
	"anchor" jsonb,
	"quote" varchar(500) DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"mentions" text[] DEFAULT '{}'::text[] NOT NULL,
	"by" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar(200),
	CONSTRAINT "pk_note_comments" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "note_mentions" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"comment_id" uuid,
	"who" varchar(200) NOT NULL,
	"by" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "pk_note_mentions" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "note_comments" ADD CONSTRAINT "fk_note_comments_note" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_comments" ADD CONSTRAINT "fk_note_comments_parent" FOREIGN KEY ("parent_id") REFERENCES "public"."note_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_mentions" ADD CONSTRAINT "fk_note_mentions_note" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_mentions" ADD CONSTRAINT "fk_note_mentions_comment" FOREIGN KEY ("comment_id") REFERENCES "public"."note_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_note_comments_note" ON "note_comments" USING btree ("note_id","at");--> statement-breakpoint
CREATE INDEX "ix_note_mentions_who" ON "note_mentions" USING btree ("who","at");--> statement-breakpoint
CREATE INDEX "ix_note_mentions_note" ON "note_mentions" USING btree ("note_id");