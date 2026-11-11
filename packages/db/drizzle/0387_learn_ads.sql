CREATE TABLE "learn"."ads" (
	"item_id" integer NOT NULL,
	"client" varchar(40) NOT NULL,
	"library_id" varchar(40) NOT NULL,
	"page_id" varchar(40),
	"advertiser" text,
	"active" boolean NOT NULL,
	"started" date,
	"ended" date,
	"days_running" integer,
	"versions" integer DEFAULT 1 NOT NULL,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"format" varchar(12),
	"raw" jsonb NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_ads" PRIMARY KEY("item_id"),
	CONSTRAINT "uq_learn_ads_client_library_id" UNIQUE("client","library_id")
);
--> statement-breakpoint
ALTER TABLE "learn"."breakdowns" DROP CONSTRAINT "ck_learn_breakdowns_kind";--> statement-breakpoint
ALTER TABLE "learn"."checks" DROP CONSTRAINT "ck_learn_checks_kind";--> statement-breakpoint
ALTER TABLE "learn"."items" DROP CONSTRAINT "ck_learn_items_kind";--> statement-breakpoint
ALTER TABLE "learn"."ads" ADD CONSTRAINT "fk_ads_item_id_items" FOREIGN KEY ("item_id") REFERENCES "learn"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_learn_ads_page_id" ON "learn"."ads" USING btree ("page_id");--> statement-breakpoint
ALTER TABLE "learn"."breakdowns" ADD CONSTRAINT "ck_learn_breakdowns_kind" CHECK (("kind")::text = ANY ((ARRAY['article'::character varying, 'video'::character varying, 'reel'::character varying, 'post'::character varying, 'film'::character varying, 'episode'::character varying, 'ad'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "learn"."checks" ADD CONSTRAINT "ck_learn_checks_kind" CHECK (("kind")::text = ANY ((ARRAY['article'::character varying, 'video'::character varying, 'reel'::character varying, 'post'::character varying, 'film'::character varying, 'episode'::character varying, 'ad'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "learn"."items" ADD CONSTRAINT "ck_learn_items_kind" CHECK (("kind")::text = ANY ((ARRAY['article'::character varying, 'video'::character varying, 'reel'::character varying, 'post'::character varying, 'film'::character varying, 'episode'::character varying, 'ad'::character varying])::text[]));