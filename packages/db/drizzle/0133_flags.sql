CREATE TABLE "flags" (
	"key" varchar(60) NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"variants" text[] DEFAULT '{off,on}'::text[] NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fallback" varchar(40) DEFAULT 'off' NOT NULL,
	"killed" boolean DEFAULT false NOT NULL,
	"surface" varchar(8) DEFAULT 'portal' NOT NULL,
	"created_by" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_flags" PRIMARY KEY("key"),
	CONSTRAINT "ck_flags_surface" CHECK (("surface")::text = ANY ((ARRAY['portal'::character varying, 'site'::character varying, 'both'::character varying])::text[])),
	CONSTRAINT "ck_flags_fallback" CHECK ("flags"."fallback" = ANY("flags"."variants"))
);
