CREATE TABLE "send_attempts" (
	"item" varchar(80) NOT NULL,
	"state" varchar(12) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"account" varchar(80),
	"words" text NOT NULL,
	"target" varchar(200) NOT NULL,
	"url" text,
	"tries" smallint DEFAULT 0 NOT NULL,
	"invocation" varchar(120),
	"ref" varchar(200),
	"sent_at" timestamp with time zone,
	"why" text,
	"settled_by" varchar(120),
	"started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_send_attempts" PRIMARY KEY("item"),
	CONSTRAINT "ck_send_attempts_state" CHECK (("state")::text = ANY ((ARRAY['sending'::character varying, 'sent'::character varying, 'unsure'::character varying])::text[]))
);
--> statement-breakpoint
CREATE INDEX "ix_send_attempts_state" ON "send_attempts" USING btree ("state");