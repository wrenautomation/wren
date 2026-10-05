CREATE TABLE "ad_days" (
	"day" date NOT NULL,
	"adset_id" varchar(32) NOT NULL,
	"campaign_id" varchar(32) NOT NULL,
	"campaign_name" text NOT NULL,
	"adset_name" text NOT NULL,
	"currency" varchar(3) NOT NULL,
	"spend" double precision NOT NULL,
	"impressions" integer NOT NULL,
	"reach" integer NOT NULL,
	"clicks" integer NOT NULL,
	"leads" integer NOT NULL,
	"results" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_ad_days" PRIMARY KEY("adset_id","day")
);
--> statement-breakpoint
CREATE TABLE "site_days" (
	"day" date NOT NULL,
	"channel" varchar(16) NOT NULL,
	"campaign" varchar(100) NOT NULL,
	"visits" integer NOT NULL,
	"first_touches" integer NOT NULL,
	"forms" integer NOT NULL,
	"bookings" integer NOT NULL,
	"watch_plays" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_site_days" PRIMARY KEY("day","channel","campaign"),
	CONSTRAINT "ck_site_days_channel" CHECK (("channel")::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying, 'ads'::character varying, 'content'::character varying, 'search'::character varying, 'reach'::character varying, 'other'::character varying, 'direct'::character varying])::text[]))
);
--> statement-breakpoint
CREATE INDEX "ix_ad_days_day" ON "ad_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "ix_ad_days_campaign_id" ON "ad_days" USING btree ("campaign_id");