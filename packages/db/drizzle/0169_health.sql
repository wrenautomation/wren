CREATE TABLE "delivery"."flags" (
	"id" serial NOT NULL,
	"client_id" varchar(40) NOT NULL,
	"engagement_id" integer,
	"side" varchar(12) NOT NULL,
	"source" varchar(12) NOT NULL,
	"cause" varchar(80) NOT NULL,
	"what" text NOT NULL,
	"how" text,
	"once" boolean DEFAULT false NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"remind_days" smallint DEFAULT 7 NOT NULL,
	"owner" text,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raised_by" text NOT NULL,
	"addressed_at" timestamp with time zone,
	"addressed_by" text,
	"note" text,
	"cleared_at" timestamp with time zone,
	"cleared_by" text,
	"told_at" timestamp with time zone,
	"raise_fired_at" timestamp with time zone,
	"clear_fired_at" timestamp with time zone,
	CONSTRAINT "pk_flags" PRIMARY KEY("id"),
	CONSTRAINT "ck_flags_side" CHECK (("side")::text = ANY ((ARRAY['risk'::character varying, 'opportunity'::character varying])::text[])),
	CONSTRAINT "ck_flags_source" CHECK (("source")::text = ANY ((ARRAY['delivery'::character varying, 'health'::character varying, 'person'::character varying])::text[])),
	CONSTRAINT "ck_flags_remind" CHECK ("delivery"."flags"."remind_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "delivery"."flag_digests" (
	"day" date NOT NULL,
	"flags" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_flag_digests" PRIMARY KEY("day")
);
--> statement-breakpoint
CREATE TABLE "delivery"."health_days" (
	"client_id" varchar(40) NOT NULL,
	"day" date NOT NULL,
	"score" smallint,
	"band" varchar(8) NOT NULL,
	"results" smallint,
	"engagement" smallint,
	"sentiment" smallint,
	"money" smallint,
	"weights" jsonb NOT NULL,
	"why" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stale" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visited" boolean DEFAULT false NOT NULL,
	"override" smallint,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_health_days" PRIMARY KEY("client_id","day"),
	CONSTRAINT "ck_health_days_band" CHECK (("band")::text = ANY ((ARRAY['healthy'::character varying, 'watch'::character varying, 'risk'::character varying, 'none'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "delivery"."health_overrides" (
	"id" serial NOT NULL,
	"client_id" varchar(40) NOT NULL,
	"score" smallint NOT NULL,
	"reason" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" text,
	CONSTRAINT "pk_health_overrides" PRIMARY KEY("id"),
	CONSTRAINT "ck_health_overrides_score" CHECK ("delivery"."health_overrides"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "delivery"."health_ratings" (
	"id" serial NOT NULL,
	"client_id" varchar(40) NOT NULL,
	"score" smallint NOT NULL,
	"note" text,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_health_ratings" PRIMARY KEY("id"),
	CONSTRAINT "ck_health_ratings_score" CHECK ("delivery"."health_ratings"."score" between 1 and 5)
);
--> statement-breakpoint
DROP TABLE "delivery"."pings" CASCADE;--> statement-breakpoint
ALTER TABLE "delivery"."flags" ADD CONSTRAINT "fk_flags_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."flags" ADD CONSTRAINT "fk_flags_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."health_days" ADD CONSTRAINT "fk_health_days_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."health_overrides" ADD CONSTRAINT "fk_health_overrides_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."health_ratings" ADD CONSTRAINT "fk_health_ratings_client" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_flags_open" ON "delivery"."flags" USING btree ("client_id",coalesce(engagement_id, 0),"cause") WHERE cleared_at is null;--> statement-breakpoint
CREATE INDEX "ix_flags_raised" ON "delivery"."flags" USING btree ("raised_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_health_overrides_open" ON "delivery"."health_overrides" USING btree ("client_id") WHERE cleared_at is null;--> statement-breakpoint
CREATE INDEX "ix_health_ratings_client" ON "delivery"."health_ratings" USING btree ("client_id","at");