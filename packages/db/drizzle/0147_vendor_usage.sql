CREATE TABLE "vendor_modes" (
	"id" serial NOT NULL,
	"client" varchar(40),
	"vendor" varchar(32) NOT NULL,
	"mode" varchar(8) NOT NULL,
	"key_name" varchar(200),
	"per_day" integer DEFAULT 0 NOT NULL,
	"cap_cents" integer DEFAULT 0 NOT NULL,
	"updated_by" varchar(320) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_vendor_modes" PRIMARY KEY("id"),
	CONSTRAINT "uq_vendor_modes_owner" UNIQUE NULLS NOT DISTINCT("client","vendor"),
	CONSTRAINT "ck_vendor_modes_mode" CHECK (("mode")::text = ANY ((ARRAY['own'::character varying, 'managed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "vendor_usage" (
	"id" bigserial NOT NULL,
	"client" varchar(40),
	"vendor" varchar(32) NOT NULL,
	"mode" varchar(8) NOT NULL,
	"bucket" varchar(80) NOT NULL,
	"units" integer NOT NULL,
	"micros" bigint NOT NULL,
	"part" varchar(64),
	"run_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_vendor_usage" PRIMARY KEY("id"),
	CONSTRAINT "ck_vendor_usage_mode" CHECK (("mode")::text = ANY ((ARRAY['own'::character varying, 'managed'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "vendor_modes" ADD CONSTRAINT "fk_vendor_modes_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_vendor_usage_bucket" ON "vendor_usage" USING btree ("bucket","at");--> statement-breakpoint
CREATE INDEX "ix_vendor_usage_owner" ON "vendor_usage" USING btree ("client","vendor","at");