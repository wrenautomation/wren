CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(16) NOT NULL,
	"account_id" uuid NOT NULL,
	"ref" varchar(200) NOT NULL,
	"post" varchar(200) NOT NULL,
	"parent" varchar(200) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"place" varchar(200),
	"post_title" text,
	"author" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	"sort" varchar(16),
	"why" text,
	"draft" text,
	"state" varchar(16) DEFAULT 'new' NOT NULL,
	"answer" text,
	"answer_ref" varchar(200),
	"answered_at" timestamp with time zone,
	"contact_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_comments_platform_ref" UNIQUE("platform","ref"),
	CONSTRAINT "ck_comments_platform" CHECK (("platform")::text = ANY ((ARRAY['reddit'::character varying, 'linkedin'::character varying])::text[])),
	CONSTRAINT "ck_comments_sort" CHECK (("sort")::text = ANY ((ARRAY['asked'::character varying, 'question'::character varying, 'chat'::character varying, 'hostile'::character varying, 'ours'::character varying])::text[])),
	CONSTRAINT "ck_comments_state" CHECK (("state")::text = ANY ((ARRAY['new'::character varying, 'waiting'::character varying, 'answered'::character varying, 'dropped'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_account_id_reach_accounts" FOREIGN KEY ("account_id") REFERENCES "public"."reach_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_contact_id_reach_contacts" FOREIGN KEY ("contact_id") REFERENCES "public"."reach_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_comments_state" ON "comments" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ix_comments_account_id" ON "comments" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_comments_post" ON "comments" USING btree ("post");