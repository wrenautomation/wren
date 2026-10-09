CREATE TABLE "custom_field_values" (
	"field" uuid NOT NULL,
	"row" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_custom_field_values" PRIMARY KEY("field","row")
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner" varchar(40),
	"record" varchar(80) NOT NULL,
	"key" varchar(40) NOT NULL,
	"label" varchar(80) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"options" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_custom_fields" PRIMARY KEY("id"),
	CONSTRAINT "uq_custom_fields_key" UNIQUE NULLS NOT DISTINCT("owner","record","key"),
	CONSTRAINT "ck_custom_fields_kind" CHECK (("kind")::text = ANY ((ARRAY['text'::character varying, 'number'::character varying, 'money'::character varying, 'date'::character varying, 'choice'::character varying, 'yes_no'::character varying, 'link'::character varying])::text[])),
	CONSTRAINT "ck_custom_fields_key" CHECK ("custom_fields"."key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "custom_values" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner" varchar(40),
	"key" varchar(40) NOT NULL,
	"label" varchar(80) NOT NULL,
	"value" varchar(2000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "pk_custom_values" PRIMARY KEY("id"),
	CONSTRAINT "uq_custom_values_key" UNIQUE NULLS NOT DISTINCT("owner","key"),
	CONSTRAINT "ck_custom_values_key" CHECK ("custom_values"."key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "fk_custom_field_values_field" FOREIGN KEY ("field") REFERENCES "public"."custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "fk_custom_fields_owner" FOREIGN KEY ("owner") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_values" ADD CONSTRAINT "fk_custom_values_owner" FOREIGN KEY ("owner") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;