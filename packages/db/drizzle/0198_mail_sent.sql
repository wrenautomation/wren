CREATE TABLE "watch"."mail_sent" (
	"id" serial NOT NULL,
	"mail_id" integer NOT NULL,
	"mailbox" varchar(320) NOT NULL,
	"thread_id" varchar(255) NOT NULL,
	"to_address" varchar(320) NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"ours" varchar(320) NOT NULL,
	"provider_id" varchar(255),
	"state" varchar(8) DEFAULT 'sending' NOT NULL,
	"why" text,
	"by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "pk_mail_sent" PRIMARY KEY("id"),
	CONSTRAINT "ck_watch_mail_sent_state" CHECK (("state")::text = ANY ((ARRAY['sending'::character varying, 'sent'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "watch"."mail_sent" ADD CONSTRAINT "fk_mail_sent_mail_id_mail" FOREIGN KEY ("mail_id") REFERENCES "watch"."mail"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_watch_mail_sent_thread" ON "watch"."mail_sent" USING btree ("mailbox","thread_id");--> statement-breakpoint
CREATE INDEX "ix_watch_mail_sent_mail" ON "watch"."mail_sent" USING btree ("mail_id");