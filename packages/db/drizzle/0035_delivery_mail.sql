CREATE TABLE "delivery"."member_mail" (
	"client_id" varchar(40) NOT NULL,
	"email" text NOT NULL,
	"level" varchar(8) DEFAULT 'all' NOT NULL,
	"told_through" timestamp with time zone,
	"digest_on" date,
	CONSTRAINT "pk_member_mail" PRIMARY KEY("client_id","email"),
	CONSTRAINT "ck_member_mail_level" CHECK (("level")::text = ANY ((ARRAY['all'::character varying, 'digest'::character varying, 'off'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "delivery"."pings" (
	"engagement_id" integer NOT NULL,
	"about" varchar(80) NOT NULL,
	"pinged_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_pings" PRIMARY KEY("engagement_id","about")
);
--> statement-breakpoint
CREATE TABLE "delivery"."pulses" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"email" text NOT NULL,
	"week" date NOT NULL,
	"score" smallint NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pulses" PRIMARY KEY("id"),
	CONSTRAINT "uq_pulses_week" UNIQUE("engagement_id","email","week"),
	CONSTRAINT "ck_pulses_score" CHECK ("delivery"."pulses"."score" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "delivery"."member_mail" ADD CONSTRAINT "fk_member_mail_member" FOREIGN KEY ("client_id","email") REFERENCES "public"."client_members"("client_id","email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."pings" ADD CONSTRAINT "fk_pings_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."pulses" ADD CONSTRAINT "fk_pulses_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- People already on a project were told by hand: no welcome mail for them.
INSERT INTO "delivery"."member_mail" ("client_id", "email", "told_through") SELECT "client_id", "email", now() FROM "public"."client_members";
