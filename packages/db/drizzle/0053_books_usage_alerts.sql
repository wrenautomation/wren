CREATE TABLE "books"."alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"message" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "ck_alerts_kind" CHECK (("kind")::text = ANY ((ARRAY['capture'::character varying, 'held'::character varying, 'unread'::character varying, 'new_subscription'::character varying, 'renewal'::character varying, 'lapsed'::character varying, 'spike'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "books"."usage" (
	"on" date NOT NULL,
	"provider" varchar(16) NOT NULL,
	"service" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_usage" PRIMARY KEY("on","provider","service"),
	CONSTRAINT "ck_usage_provider" CHECK (("provider")::text = ANY ((ARRAY['aws'::character varying])::text[]))
);
--> statement-breakpoint
CREATE INDEX "ix_alerts_open" ON "books"."alerts" USING btree ("kind") WHERE "books"."alerts"."cleared_at" IS NULL;