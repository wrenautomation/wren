CREATE TABLE "social_activity" (
	"id" serial NOT NULL,
	"platform" varchar(16) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"ref" varchar(200) NOT NULL,
	"actor" text,
	"actor_url" text,
	"text" text NOT NULL,
	"url" text,
	"at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	"state" varchar(8) DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_social_activity" PRIMARY KEY("id"),
	CONSTRAINT "uq_social_activity_platform_ref" UNIQUE("platform","ref"),
	CONSTRAINT "ck_social_activity_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying])::text[])),
	CONSTRAINT "ck_social_activity_kind" CHECK (("kind")::text = ANY ((ARRAY['follow'::character varying, 'subscribe'::character varying, 'mention'::character varying, 'reaction'::character varying, 'notification'::character varying])::text[])),
	CONSTRAINT "ck_social_activity_state" CHECK (("state")::text = ANY ((ARRAY['new'::character varying, 'seen'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "social_days" (
	"platform" varchar(16) NOT NULL,
	"day" date NOT NULL,
	"followers" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_social_days" PRIMARY KEY("platform","day"),
	CONSTRAINT "ck_social_days_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying])::text[])),
	CONSTRAINT "ck_social_days_followers_non_negative" CHECK ("followers" >= 0)
);
--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "ck_comments_platform";--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "channel" varchar(16) DEFAULT 'reach' NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_social_activity_state" ON "social_activity" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ix_social_activity_platform_at" ON "social_activity" USING btree ("platform","at");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "ck_comments_channel" CHECK (("channel")::text = ANY ((ARRAY['reach'::character varying, 'content'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "ck_comments_reach_has_account" CHECK (((channel)::text <> 'reach'::text) OR (account_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "ck_comments_platform" CHECK (("platform")::text = ANY ((ARRAY['linkedin'::character varying, 'reddit'::character varying, 'youtube'::character varying, 'x'::character varying, 'instagram'::character varying, 'facebook'::character varying, 'tiktok'::character varying])::text[]));