CREATE TABLE "ad_launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(200) NOT NULL,
	"ad_account_id" varchar(32) NOT NULL,
	"campaign_id" varchar(32) NOT NULL,
	"adset_id" varchar(32) NOT NULL,
	"creative_id" varchar(32) NOT NULL,
	"ad_id" varchar(32) NOT NULL,
	"spec" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'paused' NOT NULL,
	"daily_budget_usd" real NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"stop_reason" varchar(300),
	CONSTRAINT "ck_ad_launches_status" CHECK (("status")::text = ANY ((ARRAY['paused'::character varying, 'active'::character varying, 'stopped'::character varying])::text[]))
);
--> statement-breakpoint
CREATE INDEX "ix_ad_launches_status" ON "ad_launches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_ad_launches_campaign_id" ON "ad_launches" USING btree ("campaign_id");