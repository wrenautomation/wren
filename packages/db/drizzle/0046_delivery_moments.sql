CREATE TABLE "delivery"."interests" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"offer_id" varchar(64) NOT NULL,
	"email" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"told_at" timestamp with time zone,
	CONSTRAINT "pk_interests" PRIMARY KEY("id"),
	CONSTRAINT "uq_interests_offer" UNIQUE("engagement_id","offer_id","email")
);
--> statement-breakpoint
CREATE TABLE "delivery"."moments" (
	"engagement_id" integer NOT NULL,
	"moment" varchar(80) NOT NULL,
	"reached_on" date NOT NULL,
	"mailed_at" timestamp with time zone,
	CONSTRAINT "pk_moments" PRIMARY KEY("engagement_id","moment")
);
--> statement-breakpoint
CREATE TABLE "delivery"."reviews" (
	"id" serial NOT NULL,
	"engagement_id" integer NOT NULL,
	"moment" varchar(80) NOT NULL,
	"email" text NOT NULL,
	"score" smallint,
	"words" text,
	"may_quote" varchar(16) DEFAULT 'private' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"told_at" timestamp with time zone,
	CONSTRAINT "pk_reviews" PRIMARY KEY("id"),
	CONSTRAINT "uq_reviews_moment" UNIQUE("engagement_id","moment","email"),
	CONSTRAINT "ck_reviews_score" CHECK ("delivery"."reviews"."score" is null or "delivery"."reviews"."score" between 1 and 5),
	CONSTRAINT "ck_reviews_may_quote" CHECK (("may_quote")::text = ANY ((ARRAY['private'::character varying, 'anonymous'::character varying, 'named'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "delivery"."invoices" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery"."interests" ADD CONSTRAINT "fk_interests_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."moments" ADD CONSTRAINT "fk_moments_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery"."reviews" ADD CONSTRAINT "fk_reviews_engagement" FOREIGN KEY ("engagement_id") REFERENCES "delivery"."engagements"("id") ON DELETE cascade ON UPDATE no action;