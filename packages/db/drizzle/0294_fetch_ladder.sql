CREATE TABLE "fetch_tiers" (
	"domain" text NOT NULL,
	"tier" text NOT NULL,
	"block" text,
	"learned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_fetch_tiers" PRIMARY KEY("domain")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "block_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "fetch_steps" jsonb;