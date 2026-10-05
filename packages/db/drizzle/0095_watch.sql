CREATE SCHEMA "watch";
--> statement-breakpoint
CREATE TABLE "watch"."mail" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox" varchar(320) NOT NULL,
	"message_id" varchar(64) NOT NULL,
	"thread_id" varchar(64) NOT NULL,
	"from_name" text NOT NULL,
	"from_address" varchar(320) NOT NULL,
	"subject" text NOT NULL,
	"snippet" text,
	"at" timestamp with time zone NOT NULL,
	"verdict" varchar(8),
	"why" text,
	"summary" text,
	"rule_id" integer,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_watch_mail_message" UNIQUE("mailbox","message_id"),
	CONSTRAINT "ck_watch_mail_verdict" CHECK (("verdict")::text = ANY ((ARRAY['show'::character varying, 'hold'::character varying, 'drop'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "watch"."rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"words" text NOT NULL,
	"sender" varchar(320),
	"subject" text,
	"verdict" varchar(8),
	"by" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_watch_rules_verdict" CHECK (("verdict")::text = ANY ((ARRAY['show'::character varying, 'hold'::character varying, 'drop'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "watch"."mail" ADD CONSTRAINT "mail_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "watch"."rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_watch_mail_from" ON "watch"."mail" USING btree ("from_address");--> statement-breakpoint
CREATE INDEX "ix_watch_mail_at" ON "watch"."mail" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ix_watch_mail_rule" ON "watch"."mail" USING btree ("rule_id");--> statement-breakpoint
CREATE VIEW "watch"."mail_records" AS (
    select m.id, m.mailbox, coalesce(nullif(m.from_name, ''), m.from_address)::text sender,
      m.from_address::text from_address, m.subject, m.summary, m.verdict::text verdict, m.why,
      case when m.done_at is not null then 'done'
        when m.verdict is null or m.verdict = 'show' then 'needs_you'
        when m.verdict = 'hold' then 'held' else 'dropped' end queue,
      m.at, 'https://mail.google.com/mail/u/' || m.mailbox || '/#all/' || m.thread_id open,
      h.n::int held,
      case when h.n > 0 then '/inbox/mail?view=held&fromAddress=~' || m.from_address end others
    from watch.mail m
    left join lateral (select count(*) n from watch.mail o
      where o.from_address = m.from_address and o.verdict = 'hold' and o.id <> m.id) h on true);--> statement-breakpoint
CREATE VIEW "watch"."rule_records" AS (
    select r.id, r.words, r.sender::text sender, r.subject, r.verdict::text verdict,
      case when r.sender is not null and r.verdict is not null then 'code' else 'model' end settles,
      r.by::text by, r.created_at
    from watch.rules r);--> statement-breakpoint
INSERT INTO "watch"."rules" ("words", "by") VALUES ('Inbox Insiders: hold invoices and receipts. Show order status changes.', 'the Watch''s design, 2026-10-05');
