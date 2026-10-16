CREATE TABLE "comment_threads" (
	"id" serial NOT NULL,
	"platform" varchar(16) NOT NULL,
	"post" varchar(200) NOT NULL,
	"account_id" uuid NOT NULL,
	"post_title" text,
	"post_text" text,
	"post_url" text,
	"post_place" varchar(200),
	"post_author" varchar(120),
	"post_media" text,
	"post_at" timestamp with time zone,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"more" integer DEFAULT 0 NOT NULL,
	"count" integer,
	"read_at" timestamp with time zone,
	"check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active_at" timestamp with time zone NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_comment_threads" PRIMARY KEY("id"),
	CONSTRAINT "uq_comment_threads_platform_post" UNIQUE("platform","post"),
	CONSTRAINT "ck_comment_threads_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'threads'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[])),
	CONSTRAINT "ck_comment_threads_more" CHECK (more >= 0)
);
--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "ck_comments_kind";--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "fk_comment_threads_account_id_reach_accounts" FOREIGN KEY ("account_id") REFERENCES "public"."reach_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_comment_threads_account_id" ON "comment_threads" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_comment_threads_until" ON "comment_threads" USING btree ("until");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "ck_comments_kind" CHECK (("kind")::text = ANY ((ARRAY['post_reply'::character varying, 'comment_reply'::character varying, 'username_mention'::character varying, 'review'::character varying, 'thread_reply'::character varying])::text[]));