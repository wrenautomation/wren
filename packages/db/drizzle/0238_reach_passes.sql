CREATE TABLE "reach_passes" (
	"id" serial NOT NULL,
	"platform" varchar(16) NOT NULL,
	"handle" varchar(200) NOT NULL,
	"name" text NOT NULL,
	"reason" varchar(16) NOT NULL,
	"note" text,
	"item" varchar(80),
	"by" varchar(120),
	"until" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_reach_passes" PRIMARY KEY("id"),
	CONSTRAINT "uq_reach_passes_platform_handle" UNIQUE("platform","handle"),
	CONSTRAINT "ck_reach_passes_reason" CHECK (("reason")::text = ANY ((ARRAY['not_lead'::character varying, 'not_worth'::character varying, 'spam'::character varying, 'competitor'::character varying, 'rude'::character varying, 'not_now'::character varying])::text[]))
);
