CREATE TABLE "access_review_events" (
	"id" serial NOT NULL,
	"review_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" varchar(12) NOT NULL,
	"note" text,
	"ticket" varchar(200),
	"by" varchar(320) NOT NULL,
	CONSTRAINT "pk_access_review_events" PRIMARY KEY("id"),
	CONSTRAINT "ck_access_review_events_kind" CHECK (("kind")::text = ANY ((ARRAY['filed'::character varying, 'more_info'::character varying, 'answered'::character varying, 'refused'::character varying, 'passed'::character varying, 'withdrawn'::character varying, 'note'::character varying, 'checked'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "access_reviews" (
	"id" serial NOT NULL,
	"client" varchar(64) NOT NULL,
	"kind" varchar(64) NOT NULL,
	"name" text,
	"where" text,
	"state" varchar(12) DEFAULT 'draft' NOT NULL,
	"ticket" varchar(200),
	"reason" text,
	"filed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_access_reviews" PRIMARY KEY("id"),
	CONSTRAINT "uq_access_reviews_kind" UNIQUE("client","kind"),
	CONSTRAINT "ck_access_reviews_state" CHECK (("state")::text = ANY ((ARRAY['draft'::character varying, 'filed'::character varying, 'more_info'::character varying, 'refused'::character varying, 'passed'::character varying, 'withdrawn'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "access_review_events" ADD CONSTRAINT "fk_access_review_events_review" FOREIGN KEY ("review_id") REFERENCES "public"."access_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_access_review_events_review" ON "access_review_events" USING btree ("review_id","at");