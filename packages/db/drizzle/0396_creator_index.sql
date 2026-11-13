CREATE TABLE "creator_posts" (
	"platform" varchar(16) NOT NULL,
	"ref" varchar(255) NOT NULL,
	"creator_id" integer NOT NULL,
	"url" text NOT NULL,
	"kind" varchar(8) NOT NULL,
	"posted_at" timestamp with time zone,
	"title" text,
	"text" text,
	"raw" jsonb NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"score_count" varchar(16),
	"multiple" real,
	"rank" real,
	"baseline_n" integer,
	"scored_at" timestamp with time zone,
	"record" text,
	CONSTRAINT "pk_creator_posts" PRIMARY KEY("platform","ref"),
	CONSTRAINT "ck_creator_posts_kind" CHECK (("kind")::text = ANY ((ARRAY['video'::character varying, 'short'::character varying, 'reel'::character varying, 'post'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "follower_count_days" (
	"creator_id" integer NOT NULL,
	"day" date NOT NULL,
	"followers" integer NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_follower_count_days" PRIMARY KEY("creator_id","day")
);
--> statement-breakpoint
CREATE TABLE "post_count_days" (
	"platform" varchar(16) NOT NULL,
	"ref" varchar(255) NOT NULL,
	"day" date NOT NULL,
	"counts" jsonb NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_post_count_days" PRIMARY KEY("platform","ref","day")
);
--> statement-breakpoint
CREATE TABLE "tracked_creators" (
	"id" serial NOT NULL,
	"handle_id" integer NOT NULL,
	"niches" text[] DEFAULT '{}' NOT NULL,
	"note" text,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"platform_id" varchar(64),
	"raw" jsonb,
	"read_at" timestamp with time zone,
	"read_fails" integer DEFAULT 0 NOT NULL,
	"read_error" text,
	"record" text,
	CONSTRAINT "pk_tracked_creators" PRIMARY KEY("id"),
	CONSTRAINT "uq_tracked_creators_handle_id" UNIQUE("handle_id")
);
--> statement-breakpoint
ALTER TABLE "social_handles" DROP CONSTRAINT "ck_social_handles_platform";--> statement-breakpoint
ALTER TABLE "creator_posts" ADD CONSTRAINT "fk_creator_posts_creator_id_tracked_creators" FOREIGN KEY ("creator_id") REFERENCES "public"."tracked_creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_posts" ADD CONSTRAINT "fk_creator_posts_platform_ref_platform_objects" FOREIGN KEY ("platform","ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "follower_count_days" ADD CONSTRAINT "fk_follower_count_days_creator_id_tracked_creators" FOREIGN KEY ("creator_id") REFERENCES "public"."tracked_creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_count_days" ADD CONSTRAINT "fk_post_count_days_platform_ref_platform_objects" FOREIGN KEY ("platform","ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tracked_creators" ADD CONSTRAINT "fk_tracked_creators_handle_id_social_handles" FOREIGN KEY ("handle_id") REFERENCES "public"."social_handles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_creator_posts_creator_id_posted_at" ON "creator_posts" USING btree ("creator_id","posted_at");--> statement-breakpoint
CREATE INDEX "ix_creator_posts_multiple" ON "creator_posts" USING btree ("multiple");--> statement-breakpoint
ALTER TABLE "social_handles" ADD CONSTRAINT "ck_social_handles_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'threads'::character varying, 'facebook'::character varying, 'tiktok'::character varying, 'google_business'::character varying])::text[]));