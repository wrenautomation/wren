CREATE TABLE "review_asks" (
	"id" serial NOT NULL,
	"subject" varchar(200) NOT NULL,
	"source" varchar(8) NOT NULL,
	"name" text,
	"phone" varchar(64),
	"e164" varchar(16),
	"email" text,
	"token" varchar(32) NOT NULL,
	"place_id" varchar(200),
	"contact_id" integer,
	"ask" varchar(16) NOT NULL,
	"ask_at" timestamp with time zone NOT NULL,
	"ask_detail" text,
	"reminder" varchar(16),
	"reminder_at" timestamp with time zone,
	"reminder_detail" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"clicked_at" timestamp with time zone,
	"feedback" text,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_review_asks" PRIMARY KEY("id"),
	CONSTRAINT "uq_review_asks_subject" UNIQUE("subject"),
	CONSTRAINT "uq_review_asks_token" UNIQUE("token"),
	CONSTRAINT "ck_review_asks_source" CHECK (("source")::text = ANY ((ARRAY['won'::character varying, 'done'::character varying, 'paid'::character varying, 'hand'::character varying, 'door'::character varying])::text[])),
	CONSTRAINT "ck_review_asks_ask" CHECK (("ask")::text = ANY ((ARRAY['queued'::character varying, 'would_send'::character varying, 'skipped'::character varying, 'refused'::character varying])::text[])),
	CONSTRAINT "ck_review_asks_reminder" CHECK (("reminder")::text = ANY ((ARRAY['queued'::character varying, 'would_send'::character varying, 'skipped'::character varying, 'refused'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "sms_calls" (
	"id" serial NOT NULL,
	"call_id" varchar(128) NOT NULL,
	"from_e164" varchar(32) NOT NULL,
	"to_e164" varchar(32) NOT NULL,
	"number_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"bridged_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"cause" varchar(32),
	"result" varchar(16),
	"known" boolean,
	"contact_id" integer,
	"text_back" varchar(16),
	"text_back_at" timestamp with time zone,
	"text_back_detail" text,
	"replied_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_sms_calls" PRIMARY KEY("id"),
	CONSTRAINT "uq_sms_calls_call_id" UNIQUE("call_id"),
	CONSTRAINT "ck_sms_calls_result" CHECK (("result")::text = ANY ((ARRAY['answered'::character varying, 'missed'::character varying, 'busy'::character varying, 'voicemail'::character varying])::text[])),
	CONSTRAINT "ck_sms_calls_text_back" CHECK (("text_back")::text = ANY ((ARRAY['queued'::character varying, 'would_send'::character varying, 'skipped'::character varying, 'refused'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "sms_contacts" DROP CONSTRAINT "ck_sms_contacts_source_kind";--> statement-breakpoint
ALTER TABLE "sms_messages" DROP CONSTRAINT "ck_sms_messages_messagekind";--> statement-breakpoint
ALTER TABLE "review_asks" ADD CONSTRAINT "fk_review_asks_contact_id_sms_contacts" FOREIGN KEY ("contact_id") REFERENCES "public"."sms_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_calls" ADD CONSTRAINT "fk_sms_calls_number_id_sms_numbers" FOREIGN KEY ("number_id") REFERENCES "public"."sms_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_calls" ADD CONSTRAINT "fk_sms_calls_contact_id_sms_contacts" FOREIGN KEY ("contact_id") REFERENCES "public"."sms_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_review_asks_ask_at" ON "review_asks" USING btree ("ask_at");--> statement-breakpoint
CREATE INDEX "ix_review_asks_e164" ON "review_asks" USING btree ("e164");--> statement-breakpoint
CREATE INDEX "ix_review_asks_contact_id" ON "review_asks" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "ix_sms_calls_from_text_back" ON "sms_calls" USING btree ("from_e164","text_back_at");--> statement-breakpoint
CREATE INDEX "ix_sms_calls_contact_id" ON "sms_calls" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "ix_sms_calls_number_id" ON "sms_calls" USING btree ("number_id");--> statement-breakpoint
CREATE INDEX "ix_sms_calls_started_at" ON "sms_calls" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_messages_answer_ref" ON "sms_messages" USING btree ("contact_id","ref") WHERE (kind)::text = ANY (ARRAY['text_back'::text, 'review'::text]);--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD CONSTRAINT "ck_sms_contacts_source_kind" CHECK (("source_kind")::text = ANY ((ARRAY['tel_link'::character varying, 'page_text'::character varying, 'manual'::character varying, 'inbound'::character varying, 'form'::character varying, 'hook'::character varying, 'call'::character varying, 'customer'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "ck_sms_messages_messagekind" CHECK (("kind")::text = ANY ((ARRAY['sequence'::character varying, 'manual'::character varying, 'reminder'::character varying, 'inbound'::character varying, 'follow_up'::character varying, 'text_back'::character varying, 'review'::character varying])::text[]));