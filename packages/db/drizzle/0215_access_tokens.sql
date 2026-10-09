CREATE TABLE "access_tokens" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"hash" varchar(64) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"client" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "pk_access_tokens" PRIMARY KEY("id"),
	CONSTRAINT "uq_access_tokens_hash" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "fk_access_tokens_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_access_tokens_email" ON "access_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ix_access_tokens_client" ON "access_tokens" USING btree ("client") WHERE client is not null;