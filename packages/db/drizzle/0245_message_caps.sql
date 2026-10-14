CREATE TABLE "marketing_sends" (
	"id" serial NOT NULL,
	"person_key" varchar(340) NOT NULL,
	"channel" varchar(16) NOT NULL,
	"campaign" varchar(120),
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_marketing_sends" PRIMARY KEY("id"),
	CONSTRAINT "ck_marketing_sends_channel" CHECK (("channel")::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying, 'dm'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "message_settings" (
	"id" integer DEFAULT 1 NOT NULL,
	"cap_per_day" integer,
	"cap_per_week" integer,
	"utm_links" boolean DEFAULT true NOT NULL,
	"updated_by" varchar(200),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_message_settings" PRIMARY KEY("id"),
	CONSTRAINT "ck_message_settings_one" CHECK ("message_settings"."id" = 1),
	CONSTRAINT "ck_message_settings_day" CHECK ("message_settings"."cap_per_day" IS NULL OR "message_settings"."cap_per_day" > 0),
	CONSTRAINT "ck_message_settings_week" CHECK ("message_settings"."cap_per_week" IS NULL OR "message_settings"."cap_per_week" > 0)
);
--> statement-breakpoint
CREATE INDEX "ix_marketing_sends_person_key" ON "marketing_sends" USING btree ("person_key","sent_at");