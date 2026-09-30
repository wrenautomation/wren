CREATE TABLE "search_answers" (
	"engine" varchar(16) NOT NULL,
	"keyword_id" integer NOT NULL,
	"asked_on" date NOT NULL,
	"cited" boolean NOT NULL,
	"rank" integer,
	"overview" boolean,
	"sources" jsonb NOT NULL,
	"questions" jsonb NOT NULL,
	"run_id" uuid,
	CONSTRAINT "pk_search_answers" PRIMARY KEY("engine","keyword_id","asked_on"),
	CONSTRAINT "ck_search_answers_engine" CHECK (("engine")::text = ANY ((ARRAY['google'::character varying, 'perplexity'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "search_days" (
	"day" date NOT NULL,
	"query" text NOT NULL,
	"page" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" double precision NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	CONSTRAINT "pk_search_days" PRIMARY KEY("day","query","page")
);
--> statement-breakpoint
CREATE TABLE "search_keywords" (
	"id" serial NOT NULL,
	"phrase" text NOT NULL,
	"page" text,
	"source" varchar(16) NOT NULL,
	"parent_id" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"run_id" uuid,
	CONSTRAINT "pk_search_keywords" PRIMARY KEY("id"),
	CONSTRAINT "uq_search_keywords_phrase" UNIQUE("phrase"),
	CONSTRAINT "ck_search_keywords_source" CHECK (("source")::text = ANY ((ARRAY['seed'::character varying, 'fanout'::character varying, 'query'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "search_pages" (
	"url" text NOT NULL,
	"checked_on" date NOT NULL,
	"verdict" varchar(32) NOT NULL,
	"coverage" text,
	"last_crawl" timestamp with time zone,
	"google_canonical" text,
	"raw" jsonb NOT NULL,
	"run_id" uuid,
	CONSTRAINT "pk_search_pages" PRIMARY KEY("url","checked_on")
);
--> statement-breakpoint
CREATE TABLE "search_proposals" (
	"id" serial NOT NULL,
	"made_on" date NOT NULL,
	"page" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"current" text NOT NULL,
	"proposed" text NOT NULL,
	"why" text NOT NULL,
	"keywords" jsonb NOT NULL,
	"state" varchar(16) DEFAULT 'open' NOT NULL,
	"pr" text,
	"llm" jsonb,
	"run_id" uuid,
	CONSTRAINT "pk_search_proposals" PRIMARY KEY("id"),
	CONSTRAINT "ck_search_proposals_kind" CHECK (("kind")::text = ANY ((ARRAY['title'::character varying, 'description'::character varying, 'heading'::character varying, 'copy'::character varying, 'faq'::character varying, 'page'::character varying])::text[])),
	CONSTRAINT "ck_search_proposals_state" CHECK (("state")::text = ANY ((ARRAY['open'::character varying, 'taken'::character varying, 'dropped'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "search_answers" ADD CONSTRAINT "fk_search_answers_keyword_id_search_keywords" FOREIGN KEY ("keyword_id") REFERENCES "public"."search_keywords"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_answers" ADD CONSTRAINT "fk_search_answers_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_days" ADD CONSTRAINT "fk_search_days_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_keywords" ADD CONSTRAINT "fk_search_keywords_parent_id_search_keywords" FOREIGN KEY ("parent_id") REFERENCES "public"."search_keywords"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_keywords" ADD CONSTRAINT "fk_search_keywords_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_pages" ADD CONSTRAINT "fk_search_pages_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_proposals" ADD CONSTRAINT "fk_search_proposals_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_search_days_query" ON "search_days" USING btree ("query");--> statement-breakpoint
CREATE INDEX "ix_search_proposals_state" ON "search_proposals" USING btree ("state");