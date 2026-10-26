-- Limits over the code defaults, Wren-wide or per client (designs/2026-10-26-limits.md).
CREATE TABLE "limits" (
	"id" serial NOT NULL,
	"client" varchar(40),
	"name" varchar(64) NOT NULL,
	"per_day" integer NOT NULL,
	"burst" integer,
	"updated_by" varchar(320) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_limits" PRIMARY KEY("id"),
	CONSTRAINT "uq_limits_owner" UNIQUE NULLS NOT DISTINCT("client","name"),
	CONSTRAINT "ck_limits_per_day" CHECK ("limits"."per_day" >= 0),
	CONSTRAINT "ck_limits_burst" CHECK ("limits"."burst" is null or "limits"."burst" >= 1)
);
--> statement-breakpoint
ALTER TABLE "limits" ADD CONSTRAINT "fk_limits_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;