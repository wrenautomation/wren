ALTER TABLE "docs" ADD COLUMN "signing" varchar(8) DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "envelope_id" varchar(40);--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "sealed" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_docs_envelope" ON "docs" USING btree ("envelope_id") WHERE "docs"."envelope_id" is not null;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "ck_docs_signing" CHECK (("signing")::text = ANY ((ARRAY['own'::character varying, 'sealed'::character varying])::text[]));