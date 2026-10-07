CREATE TABLE "mail_connections" (
	"account_id" integer NOT NULL,
	"provider" varchar(12) NOT NULL,
	"address" varchar(320) NOT NULL,
	"org" varchar(255),
	"scopes" text NOT NULL,
	"access" varchar(8) NOT NULL,
	"token_name" varchar(255) NOT NULL,
	"state" varchar(12) DEFAULT 'connected' NOT NULL,
	"why" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"by" varchar(320) NOT NULL,
	CONSTRAINT "pk_mail_connections" PRIMARY KEY("account_id"),
	CONSTRAINT "ck_mail_connections_provider" CHECK (("provider")::text = ANY ((ARRAY['google'::character varying, 'microsoft'::character varying])::text[])),
	CONSTRAINT "ck_mail_connections_access" CHECK (("access")::text = ANY ((ARRAY['send'::character varying, 'read'::character varying])::text[])),
	CONSTRAINT "ck_mail_connections_state" CHECK (("state")::text = ANY ((ARRAY['connected'::character varying, 'broken'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "mail_consents" (
	"account_id" integer NOT NULL,
	"tenant" varchar(64) NOT NULL,
	"scopes" text NOT NULL,
	"by" varchar(320) NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_mail_consents" PRIMARY KEY("account_id")
);
--> statement-breakpoint
CREATE TABLE "mail_grants" (
	"state" varchar(64) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"provider" varchar(12) NOT NULL,
	"account_id" integer NOT NULL,
	"want" varchar(8) NOT NULL,
	"verifier" varchar(128),
	"by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "pk_mail_grants" PRIMARY KEY("state"),
	CONSTRAINT "ck_mail_grants_kind" CHECK (("kind")::text = ANY ((ARRAY['connect'::character varying, 'consent'::character varying])::text[])),
	CONSTRAINT "ck_mail_grants_provider" CHECK (("provider")::text = ANY ((ARRAY['google'::character varying, 'microsoft'::character varying])::text[])),
	CONSTRAINT "ck_mail_grants_want" CHECK (("want")::text = ANY ((ARRAY['send'::character varying, 'read'::character varying])::text[]))
);
--> statement-breakpoint
DROP VIEW "watch"."mail_records";--> statement-breakpoint
ALTER TABLE "watch"."mail" ALTER COLUMN "message_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "watch"."mail" ALTER COLUMN "thread_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "watch"."mail" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "watch"."mail" ADD COLUMN "reader" varchar(8) DEFAULT 'monitor' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_connections" ADD CONSTRAINT "fk_mail_connections_account" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_consents" ADD CONSTRAINT "fk_mail_consents_account" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_grants" ADD CONSTRAINT "fk_mail_grants_account" FOREIGN KEY ("account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_mail_grants_account" ON "mail_grants" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "watch"."mail" ADD CONSTRAINT "ck_watch_mail_reader" CHECK (("reader")::text = ANY ((ARRAY['monitor'::character varying, 'mail'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "watch"."mail_records" AS (
    select m.id, m.mailbox, coalesce(nullif(m.from_name, ''), m.from_address)::text sender,
      m.from_address::text from_address, m.subject, m.summary, m.verdict::text verdict, m.why,
      case when m.done_at is not null then 'done'
        when m.verdict is null or m.verdict = 'show' then 'needs_you'
        when m.verdict = 'hold' then 'held' else 'dropped' end queue,
      m.at, coalesce(m.link, 'https://mail.google.com/mail/u/' || m.mailbox || '/#all/' || m.thread_id) open,
      h.n::int held,
      case when h.n > 0 then '/inbox/mail?view=held&fromAddress=~' || m.from_address end others
    from watch.mail m
    left join lateral (select count(*) n from watch.mail o
      where o.from_address = m.from_address and o.verdict = 'hold' and o.id <> m.id) h on true);