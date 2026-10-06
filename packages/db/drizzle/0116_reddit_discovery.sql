CREATE TABLE "reddit_people" (
	"handle" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"raw" jsonb NOT NULL,
	"facts" jsonb NOT NULL,
	"read" jsonb,
	"fit" smallint,
	"site" varchar(253),
	"read_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_reddit_people" PRIMARY KEY("handle"),
	CONSTRAINT "ck_reddit_people_fit" CHECK ("reddit_people"."fit" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "reddit_places" (
	"subreddit" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"found_by" text NOT NULL,
	"raw" jsonb,
	"judged" jsonb,
	"fit" smallint,
	"subscribers" integer,
	"state" varchar(16) DEFAULT 'found' NOT NULL,
	"account_id" uuid,
	"read_at" timestamp with time zone,
	"threads_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_reddit_places" PRIMARY KEY("subreddit"),
	CONSTRAINT "ck_reddit_places_state" CHECK (("state")::text = ANY ((ARRAY['found'::character varying, 'watching'::character varying, 'skipped'::character varying])::text[])),
	CONSTRAINT "ck_reddit_places_fit" CHECK ("reddit_places"."fit" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "reddit_threads" (
	"id" varchar(20) NOT NULL,
	"subreddit" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author" varchar(64) NOT NULL,
	"url" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"comments" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"dropped" text,
	"kind" varchar(16),
	"fit" smallint,
	"angle" text,
	"target" varchar(20),
	"target_text" text,
	"draft" text,
	"sources" jsonb,
	"state" varchar(16) DEFAULT 'new' NOT NULL,
	"account_id" uuid,
	"answer" text,
	"answer_ref" varchar(20),
	"answered_at" timestamp with time zone,
	"score" integer,
	"scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_reddit_threads" PRIMARY KEY("id"),
	CONSTRAINT "ck_reddit_threads_state" CHECK (("state")::text = ANY ((ARRAY['new'::character varying, 'dropped'::character varying, 'ranked'::character varying, 'queued'::character varying, 'commented'::character varying, 'skipped'::character varying])::text[])),
	CONSTRAINT "ck_reddit_threads_kind" CHECK (("kind")::text = ANY ((ARRAY['help'::character varying, 'tools'::character varying, 'story'::character varying, 'venting'::character varying, 'hiring'::character varying, 'other'::character varying])::text[])),
	CONSTRAINT "ck_reddit_threads_fit" CHECK ("reddit_threads"."fit" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "reddit_places" ADD CONSTRAINT "fk_reddit_places_account_id_reach_accounts" FOREIGN KEY ("account_id") REFERENCES "public"."reach_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reddit_threads" ADD CONSTRAINT "fk_reddit_threads_subreddit_reddit_places" FOREIGN KEY ("subreddit") REFERENCES "public"."reddit_places"("subreddit") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reddit_threads" ADD CONSTRAINT "fk_reddit_threads_account_id_reach_accounts" FOREIGN KEY ("account_id") REFERENCES "public"."reach_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_reddit_people_read_at" ON "reddit_people" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "ix_reddit_places_state" ON "reddit_places" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ix_reddit_places_account_id" ON "reddit_places" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_reddit_threads_subreddit" ON "reddit_threads" USING btree ("subreddit");--> statement-breakpoint
CREATE INDEX "ix_reddit_threads_state" ON "reddit_threads" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ix_reddit_threads_account_id" ON "reddit_threads" USING btree ("account_id");