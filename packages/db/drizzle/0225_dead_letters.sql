CREATE TABLE "dead_letters" (
	"id" serial NOT NULL,
	"invocation_id" varchar(64) NOT NULL,
	"target" varchar(200) NOT NULL,
	"key" text,
	"error" text,
	"invoked_by" varchar(200),
	"paused_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"told_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end" varchar(8),
	"ended_by" varchar(320),
	CONSTRAINT "pk_dead_letters" PRIMARY KEY("id"),
	CONSTRAINT "uq_dead_letters_invocation" UNIQUE("invocation_id"),
	CONSTRAINT "ck_dead_letters_end" CHECK (("end")::text = ANY ((ARRAY['retried'::character varying, 'killed'::character varying, 'dropped'::character varying, 'cleared'::character varying])::text[]))
);
--> statement-breakpoint
CREATE INDEX "ix_dead_letters_open" ON "dead_letters" USING btree ("ended_at","paused_at");