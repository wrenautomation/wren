CREATE TABLE "fills" (
	"id" serial NOT NULL,
	"kind" varchar(16) NOT NULL,
	"prompt_version" varchar(12) NOT NULL,
	"input" text NOT NULL,
	"key" varchar(64) NOT NULL,
	"value" jsonb,
	"refused" text,
	"model" varchar(128) NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_fills" PRIMARY KEY("id"),
	CONSTRAINT "uq_fills_key" UNIQUE("key"),
	CONSTRAINT "ck_fills_kind" CHECK (("kind")::text = ANY ((ARRAY['company'::character varying, 'person'::character varying, 'slot'::character varying])::text[]))
);
