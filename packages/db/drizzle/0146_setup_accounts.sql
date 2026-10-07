CREATE TABLE "account_facts" (
	"account_id" integer NOT NULL,
	"fact" varchar(80) NOT NULL,
	"state" varchar(8) NOT NULL,
	"why" text,
	"seen" jsonb,
	"by" varchar(320) NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok_at" timestamp with time zone,
	CONSTRAINT "pk_account_facts" PRIMARY KEY("account_id","fact"),
	CONSTRAINT "ck_account_facts_state" CHECK (("state")::text = ANY ((ARRAY['ok'::character varying, 'waiting'::character varying, 'lost'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "client_accounts" (
	"id" serial NOT NULL,
	"client" varchar(40),
	"site" varchar(32) NOT NULL,
	"ref" varchar(200) NOT NULL,
	"role" varchar(32) DEFAULT 'main' NOT NULL,
	"mode" varchar(8) DEFAULT 'self' NOT NULL,
	"login" varchar(120),
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_client_accounts" PRIMARY KEY("id"),
	CONSTRAINT "uq_client_accounts_ref" UNIQUE NULLS NOT DISTINCT("client","site","ref"),
	CONSTRAINT "ck_client_accounts_mode" CHECK (("mode")::text = ANY ((ARRAY['self'::character varying, 'for_you'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "setup_runs" (
	"id" serial NOT NULL,
	"account_id" integer NOT NULL,
	"setup" varchar(64) NOT NULL,
	"gen" integer DEFAULT 1 NOT NULL,
	"mode" varchar(8) NOT NULL,
	"state" varchar(16) NOT NULL,
	"step" varchar(40),
	"why" text,
	"rounds" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"step_since" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"by" varchar(320) NOT NULL,
	CONSTRAINT "pk_setup_runs" PRIMARY KEY("id"),
	CONSTRAINT "uq_setup_runs_account" UNIQUE("account_id","setup"),
	CONSTRAINT "ck_setup_runs_mode" CHECK (("mode")::text = ANY ((ARRAY['self'::character varying, 'for_you'::character varying])::text[])),
	CONSTRAINT "ck_setup_runs_state" CHECK (("state")::text = ANY ((ARRAY['checking'::character varying, 'waiting_client'::character varying, 'waiting_wren'::character varying, 'done'::character varying, 'stuck'::character varying, 'lost'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "ck_events_kind";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "setup_mode" varchar(8) DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "buys_ok" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_facts" ADD CONSTRAINT "fk_account_facts_account" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_accounts" ADD CONSTRAINT "fk_client_accounts_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_runs" ADD CONSTRAINT "fk_setup_runs_account" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_setup_runs_due" ON "setup_runs" USING btree ("state","next_check_at");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "ck_events_kind" CHECK (("kind")::text = ANY ((ARRAY['firm'::character varying, 'person'::character varying, 'lead'::character varying, 'reply'::character varying, 'call'::character varying, 'form'::character varying, 'post'::character varying, 'video'::character varying, 'client'::character varying, 'invoice'::character varying, 'mail'::character varying, 'comment'::character varying, 'item'::character varying, 'account'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "ck_clients_setup_mode" CHECK (("setup_mode")::text = ANY ((ARRAY['self'::character varying, 'for_you'::character varying])::text[]));