CREATE TABLE "flag_days" (
	"flag" varchar(60) NOT NULL,
	"day" date NOT NULL,
	"variant" varchar(40) NOT NULL,
	"channel" varchar(40) NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"forms" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_flag_days" PRIMARY KEY("flag","day","variant","channel")
);
--> statement-breakpoint
CREATE TABLE "flag_experiments" (
	"flag" varchar(60) NOT NULL,
	"goal" varchar(8) NOT NULL,
	"state" varchar(10) DEFAULT 'draft' NOT NULL,
	"shares" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"p_best" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retired" text[] DEFAULT '{}'::text[] NOT NULL,
	"best" varchar(40),
	"winner" varchar(40),
	"started_at" timestamp with time zone,
	"started_by" varchar(200),
	"ended_at" timestamp with time zone,
	"ended_by" varchar(200),
	"decided_at" timestamp with time zone,
	"created_by" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_flag_experiments" PRIMARY KEY("flag"),
	CONSTRAINT "ck_flag_experiments_goal" CHECK (("goal")::text = ANY ((ARRAY['forms'::character varying, 'calls'::character varying, 'paid'::character varying])::text[])),
	CONSTRAINT "ck_flag_experiments_state" CHECK (("state")::text = ANY ((ARRAY['draft'::character varying, 'running'::character varying, 'settled'::character varying, 'shipped'::character varying, 'stopped'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "flag_experiments" ADD CONSTRAINT "fk_flag_experiments_flag_flags" FOREIGN KEY ("flag") REFERENCES "public"."flags"("key") ON DELETE cascade ON UPDATE no action;