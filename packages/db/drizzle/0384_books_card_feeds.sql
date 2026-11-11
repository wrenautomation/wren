CREATE TABLE "books"."card_feeds" (
	"id" serial NOT NULL,
	"card" varchar(4) NOT NULL,
	"institution" text,
	"item_id" text NOT NULL,
	"account_id" text NOT NULL,
	"key_label" varchar(64) NOT NULL,
	"cursor" text,
	"error" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_card_feeds" PRIMARY KEY("id"),
	CONSTRAINT "uq_card_feeds_account_id" UNIQUE("account_id")
);
--> statement-breakpoint
ALTER TABLE "books"."card_lines" DROP CONSTRAINT "ck_card_lines_source";--> statement-breakpoint
ALTER TABLE "books"."documents" DROP CONSTRAINT "ck_documents_source";--> statement-breakpoint
ALTER TABLE "books"."card_lines" ADD CONSTRAINT "ck_card_lines_source" CHECK (("source")::text = ANY ((ARRAY['statement'::character varying, 'alert'::character varying, 'plaid'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "books"."documents" ADD CONSTRAINT "ck_documents_source" CHECK (("source")::text = ANY ((ARRAY['mailbox'::character varying, 'file'::character varying, 'attachment'::character varying, 'plaid'::character varying])::text[]));