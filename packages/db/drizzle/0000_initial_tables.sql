CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"prompt_name" varchar(64) NOT NULL,
	"prompt_hash" varchar(64) NOT NULL,
	"stage" varchar(32) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"seconds" real DEFAULT 0 NOT NULL,
	"request_id" varchar(128),
	CONSTRAINT "ck_llm_calls_input_tokens_non_negative" CHECK ("input_tokens" >= 0),
	CONSTRAINT "ck_llm_calls_output_tokens_non_negative" CHECK ("output_tokens" >= 0),
	CONSTRAINT "ck_llm_calls_cache_read_tokens_non_negative" CHECK ("cache_read_tokens" >= 0),
	CONSTRAINT "ck_llm_calls_cost_usd_non_negative" CHECK ("cost_usd" >= 0),
	CONSTRAINT "ck_llm_calls_seconds_non_negative" CHECK ("seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "competitor_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" varchar(2048) NOT NULL,
	"competitor_id" uuid,
	"title" varchar(500),
	"fetched_with" varchar(16) NOT NULL,
	"post_type" varchar(32) NOT NULL,
	"hook_type" varchar(64) NOT NULL,
	"structure" text NOT NULL,
	"word_count" integer NOT NULL,
	"cta_type" varchar(64) NOT NULL,
	"summary" text NOT NULL,
	"research_run_id" uuid,
	CONSTRAINT "uq_competitor_posts_url" UNIQUE("url"),
	CONSTRAINT "ck_competitor_posts_word_count_non_negative" CHECK ("word_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(200) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"discovered_by" varchar(32) NOT NULL,
	"research_run_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	CONSTRAINT "uq_competitors_domain" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body" text NOT NULL,
	"image_paths" text[] DEFAULT '{}' NOT NULL,
	"source" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'new' NOT NULL,
	"used_by_post_id" uuid
);
--> statement-breakpoint
CREATE TABLE "post_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"text" text NOT NULL,
	"source" varchar(16) NOT NULL,
	"competitor_post_id" uuid,
	"note_id" uuid,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"used_by_post_id" uuid
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"post_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reactions" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"source" varchar(16) NOT NULL,
	CONSTRAINT "ck_post_metrics_impressions_non_negative" CHECK ("impressions" >= 0),
	CONSTRAINT "ck_post_metrics_reactions_non_negative" CHECK ("reactions" >= 0),
	CONSTRAINT "ck_post_metrics_comments_non_negative" CHECK ("comments" >= 0)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"post_type" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"draft_path" varchar(1024) NOT NULL,
	"body" text,
	"image_path" varchar(1024),
	"note_ids" uuid[] DEFAULT '{}' NOT NULL,
	"post_idea_id" uuid,
	"competitor_post_ids" uuid[] DEFAULT '{}' NOT NULL,
	"llm_call_id" uuid,
	"reject_reason" varchar(32),
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"external_id" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_provider" varchar(32) NOT NULL,
	"mode" varchar(16) NOT NULL,
	"queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetch_count" integer DEFAULT 0 NOT NULL,
	"posts_kept" integer DEFAULT 0 NOT NULL,
	"new_domains" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"seconds" real DEFAULT 0 NOT NULL,
	"manual_rating" integer,
	"error" text,
	CONSTRAINT "ck_research_runs_manual_rating_range" CHECK (manual_rating BETWEEN 1 AND 5),
	CONSTRAINT "ck_research_runs_fetch_count_non_negative" CHECK ("fetch_count" >= 0),
	CONSTRAINT "ck_research_runs_posts_kept_non_negative" CHECK ("posts_kept" >= 0),
	CONSTRAINT "ck_research_runs_new_domains_non_negative" CHECK ("new_domains" >= 0),
	CONSTRAINT "ck_research_runs_input_tokens_non_negative" CHECK ("input_tokens" >= 0),
	CONSTRAINT "ck_research_runs_output_tokens_non_negative" CHECK ("output_tokens" >= 0),
	CONSTRAINT "ck_research_runs_cost_usd_non_negative" CHECK ("cost_usd" >= 0),
	CONSTRAINT "ck_research_runs_seconds_non_negative" CHECK ("seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "competitor_posts" ADD CONSTRAINT "competitor_posts_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_posts" ADD CONSTRAINT "competitor_posts_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_used_by_post_id_posts_id_fk" FOREIGN KEY ("used_by_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_ideas" ADD CONSTRAINT "post_ideas_competitor_post_id_competitor_posts_id_fk" FOREIGN KEY ("competitor_post_id") REFERENCES "public"."competitor_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_ideas" ADD CONSTRAINT "post_ideas_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_ideas" ADD CONSTRAINT "post_ideas_used_by_post_id_posts_id_fk" FOREIGN KEY ("used_by_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_post_idea_id_post_ideas_id_fk" FOREIGN KEY ("post_idea_id") REFERENCES "public"."post_ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_llm_calls_created_at" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_llm_calls_stage" ON "llm_calls" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "ix_competitor_posts_competitor_id" ON "competitor_posts" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "ix_competitor_posts_research_run_id" ON "competitor_posts" USING btree ("research_run_id");--> statement-breakpoint
CREATE INDEX "ix_competitor_posts_post_type" ON "competitor_posts" USING btree ("post_type");--> statement-breakpoint
CREATE INDEX "ix_competitors_research_run_id" ON "competitors" USING btree ("research_run_id");--> statement-breakpoint
CREATE INDEX "ix_notes_status_created_at" ON "notes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ix_notes_used_by_post_id" ON "notes" USING btree ("used_by_post_id");--> statement-breakpoint
CREATE INDEX "ix_post_ideas_status_created_at" ON "post_ideas" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ix_post_ideas_competitor_post_id" ON "post_ideas" USING btree ("competitor_post_id");--> statement-breakpoint
CREATE INDEX "ix_post_ideas_note_id" ON "post_ideas" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "ix_post_ideas_used_by_post_id" ON "post_ideas" USING btree ("used_by_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_post_metrics_post_id_captured_at_source" ON "post_metrics" USING btree ("post_id","captured_at","source");--> statement-breakpoint
CREATE INDEX "ix_post_metrics_post_id_captured_at" ON "post_metrics" USING btree ("post_id","captured_at");--> statement-breakpoint
CREATE INDEX "ix_posts_status_created_at" ON "posts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ix_posts_post_type" ON "posts" USING btree ("post_type");--> statement-breakpoint
CREATE INDEX "ix_posts_post_idea_id" ON "posts" USING btree ("post_idea_id");--> statement-breakpoint
CREATE INDEX "ix_posts_llm_call_id" ON "posts" USING btree ("llm_call_id");--> statement-breakpoint
CREATE INDEX "ix_research_runs_created_at" ON "research_runs" USING btree ("created_at");