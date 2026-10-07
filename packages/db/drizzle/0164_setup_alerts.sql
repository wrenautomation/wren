CREATE TABLE "setup_alerts" (
	"id" serial NOT NULL,
	"key" varchar(200) NOT NULL,
	"client" varchar(40),
	"account_id" integer NOT NULL,
	"kind" varchar(8) NOT NULL,
	"for" varchar(8) NOT NULL,
	"level" varchar(8) NOT NULL,
	"setup" varchar(64),
	"step" varchar(40),
	"fact" varchar(80),
	"part" varchar(64),
	"title" text NOT NULL,
	"body" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"told_at" timestamp with time zone,
	"digest_at" timestamp with time zone,
	CONSTRAINT "pk_setup_alerts" PRIMARY KEY("id"),
	CONSTRAINT "uq_setup_alerts_key" UNIQUE("key"),
	CONSTRAINT "ck_setup_alerts_kind" CHECK (("kind")::text = ANY ((ARRAY['lost'::character varying, 'stuck'::character varying, 'waiting'::character varying, 'done'::character varying, 'paused'::character varying, 'resumed'::character varying])::text[])),
	CONSTRAINT "ck_setup_alerts_for" CHECK (("for")::text = ANY ((ARRAY['client'::character varying, 'wren'::character varying])::text[])),
	CONSTRAINT "ck_setup_alerts_level" CHECK (("level")::text = ANY ((ARRAY['info'::character varying, 'action'::character varying, 'warning'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "setup_alerts" ADD CONSTRAINT "fk_setup_alerts_account" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_setup_alerts_open" ON "setup_alerts" USING btree ("client","cleared_at");--> statement-breakpoint
CREATE INDEX "ix_setup_alerts_account" ON "setup_alerts" USING btree ("account_id","at");