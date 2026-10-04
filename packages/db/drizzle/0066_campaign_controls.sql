CREATE TABLE "campaign_controls" (
	"campaign" text NOT NULL,
	"kill_switch" boolean,
	"openers_per_day" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_campaign_controls" PRIMARY KEY("campaign"),
	CONSTRAINT "ck_campaign_controls_openers" CHECK ("campaign_controls"."openers_per_day" >= 0)
);
