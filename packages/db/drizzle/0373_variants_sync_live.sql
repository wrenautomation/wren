CREATE TABLE "variants"."outcomes" (
	"ship_id" integer NOT NULL,
	"segment" varchar(160) NOT NULL,
	"day" date NOT NULL,
	"metric" varchar(32) NOT NULL,
	"value" double precision NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_outcomes" PRIMARY KEY("ship_id","segment","day","metric")
);
--> statement-breakpoint
CREATE TABLE "variants"."ships" (
	"id" serial NOT NULL,
	"sample_id" integer NOT NULL,
	"channel" varchar(8) NOT NULL,
	"target" varchar(200) NOT NULL,
	"why" text,
	"by" varchar(320),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "pk_ships" PRIMARY KEY("id"),
	CONSTRAINT "uq_variants_ships_target" UNIQUE("channel","target","sample_id"),
	CONSTRAINT "ck_variants_ships_channel" CHECK (("channel")::text = ANY ((ARRAY['post'::character varying, 'site'::character varying, 'email'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "variants"."samples" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "variants"."outcomes" ADD CONSTRAINT "fk_outcomes_ship_id_ships" FOREIGN KEY ("ship_id") REFERENCES "variants"."ships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants"."ships" ADD CONSTRAINT "fk_ships_sample_id_samples" FOREIGN KEY ("sample_id") REFERENCES "variants"."samples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_variants_ships_sample" ON "variants"."ships" USING btree ("sample_id");