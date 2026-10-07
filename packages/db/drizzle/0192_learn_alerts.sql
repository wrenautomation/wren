CREATE TABLE "learn"."alert_picks" (
	"client" varchar(40) NOT NULL,
	"email" varchar(320) NOT NULL,
	"source_id" integer NOT NULL,
	"pick" varchar(8) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_alert_picks" PRIMARY KEY("client","email","source_id"),
	CONSTRAINT "ck_learn_alert_picks_pick" CHECK (("pick")::text = ANY ((ARRAY['every'::character varying, 'top'::character varying, 'off'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "learn"."alerts" (
	"id" serial NOT NULL,
	"client" varchar(40) NOT NULL,
	"email" varchar(320) NOT NULL,
	"item_id" integer NOT NULL,
	"why" varchar(8) NOT NULL,
	"state" varchar(8) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "pk_alerts" PRIMARY KEY("id"),
	CONSTRAINT "uq_learn_alerts_person_item" UNIQUE("client","email","item_id"),
	CONSTRAINT "ck_learn_alerts_why" CHECK (("why")::text = ANY ((ARRAY['new'::character varying, 'score'::character varying, 'saved'::character varying])::text[])),
	CONSTRAINT "ck_learn_alerts_state" CHECK (("state")::text = ANY ((ARRAY['bell'::character varying, 'digest'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "learn"."settings" (
	"client" varchar(40) NOT NULL,
	"digest_mail" boolean DEFAULT false NOT NULL,
	"by" varchar(320),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_settings" PRIMARY KEY("client")
);
--> statement-breakpoint
CREATE TABLE "learn"."readers" (
	"client" varchar(40) NOT NULL,
	"email" varchar(320) NOT NULL,
	"saved" varchar(8) DEFAULT 'top' NOT NULL,
	"mailed_on" date,
	CONSTRAINT "pk_readers" PRIMARY KEY("client","email"),
	CONSTRAINT "ck_learn_readers_saved" CHECK (("saved")::text = ANY ((ARRAY['every'::character varying, 'top'::character varying, 'off'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "learn"."alert_picks" ADD CONSTRAINT "fk_alert_picks_source_id_sources" FOREIGN KEY ("source_id") REFERENCES "learn"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."alerts" ADD CONSTRAINT "fk_alerts_item_id_items" FOREIGN KEY ("item_id") REFERENCES "learn"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_learn_alert_picks_source" ON "learn"."alert_picks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "ix_learn_alerts_person_at" ON "learn"."alerts" USING btree ("client","email","at");--> statement-breakpoint
CREATE INDEX "ix_learn_alerts_item" ON "learn"."alerts" USING btree ("item_id");