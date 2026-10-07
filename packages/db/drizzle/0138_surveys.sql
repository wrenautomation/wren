CREATE TABLE "survey_answers" (
	"id" serial NOT NULL,
	"survey" varchar(60) NOT NULL,
	"client" varchar(40) NOT NULL,
	"person" varchar(200) NOT NULL,
	"value" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_survey_answers" PRIMARY KEY("id"),
	CONSTRAINT "uq_survey_answers_survey_client_person" UNIQUE("survey","client","person")
);
--> statement-breakpoint
CREATE TABLE "survey_days" (
	"survey" varchar(60) NOT NULL,
	"day" date NOT NULL,
	"value" varchar(80) NOT NULL,
	"channel" varchar(40) NOT NULL,
	"answers" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_survey_days" PRIMARY KEY("survey","day","value","channel")
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"key" varchar(60) NOT NULL,
	"question" text NOT NULL,
	"kind" varchar(8) NOT NULL,
	"choices" text[] DEFAULT '{}'::text[] NOT NULL,
	"surface" varchar(8) DEFAULT 'site' NOT NULL,
	"trigger" jsonb DEFAULT '{"on":"view"}'::jsonb NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" varchar(8) DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone,
	"started_by" varchar(200),
	"created_by" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_surveys" PRIMARY KEY("key"),
	CONSTRAINT "ck_surveys_kind" CHECK (("kind")::text = ANY ((ARRAY['choice'::character varying, 'scale'::character varying, 'text'::character varying])::text[])),
	CONSTRAINT "ck_surveys_surface" CHECK (("surface")::text = ANY ((ARRAY['site'::character varying, 'portal'::character varying])::text[])),
	CONSTRAINT "ck_surveys_state" CHECK (("state")::text = ANY ((ARRAY['draft'::character varying, 'live'::character varying, 'paused'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "survey_answers" ADD CONSTRAINT "fk_survey_answers_survey_surveys" FOREIGN KEY ("survey") REFERENCES "public"."surveys"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_answers" ADD CONSTRAINT "fk_survey_answers_client_clients" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_days" ADD CONSTRAINT "fk_survey_days_survey_surveys" FOREIGN KEY ("survey") REFERENCES "public"."surveys"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_survey_answers_client" ON "survey_answers" USING btree ("client");