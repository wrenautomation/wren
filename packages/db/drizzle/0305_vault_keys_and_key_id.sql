CREATE TABLE "vault_keys" (
	"address" varchar(160) NOT NULL,
	"site" varchar(64) NOT NULL,
	"account" varchar(64) NOT NULL,
	"owner" varchar(80) NOT NULL,
	"key_id" varchar(12) NOT NULL,
	"purposes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" varchar(8) NOT NULL,
	"spent_until" timestamp with time zone,
	"made_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"via" varchar(160),
	"vendor_id" varchar(160),
	"uses" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_vault_keys" PRIMARY KEY("address"),
	CONSTRAINT "ck_vault_keys_status" CHECK (("status")::text = ANY ((ARRAY['live'::character varying, 'spent'::character varying, 'revoked'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "client_secrets" ADD COLUMN "key_id" varchar(12);--> statement-breakpoint
CREATE INDEX "ix_vault_keys_key_id" ON "vault_keys" USING btree ("key_id");