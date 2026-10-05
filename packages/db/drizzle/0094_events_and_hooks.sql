CREATE TABLE "events" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"workflow" varchar(64) NOT NULL,
	"node" varchar(200) NOT NULL,
	"port" varchar(64) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"due" timestamp with time zone,
	"by" varchar(64) NOT NULL,
	"error" text,
	CONSTRAINT "pk_events" PRIMARY KEY("id"),
	CONSTRAINT "uq_events_entry" UNIQUE("workflow","node","port","subject")
);
--> statement-breakpoint
CREATE TABLE "hooks" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"client" varchar(40),
	"workflow" varchar(64) NOT NULL,
	"input" varchar(64) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pk_hooks" PRIMARY KEY("id"),
	CONSTRAINT "uq_hooks_token_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "ix_events_subject" ON "events" USING btree ("subject");