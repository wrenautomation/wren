ALTER TABLE "vendor_modes" DROP CONSTRAINT "uq_vendor_modes_owner";--> statement-breakpoint
DROP INDEX "uq_client_secrets_live";--> statement-breakpoint
ALTER TABLE "vendor_modes" ADD COLUMN "purpose" varchar(32) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendor_usage" ADD COLUMN "key_id" varchar(12);--> statement-breakpoint
ALTER TABLE "client_secrets" ADD COLUMN "label" varchar(64) DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_vendor_usage_key" ON "vendor_usage" USING btree ("key_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_client_secrets_live" ON "client_secrets" USING btree ("client","name","label") WHERE "client_secrets"."state" = 'live';--> statement-breakpoint
ALTER TABLE "vendor_modes" ADD CONSTRAINT "uq_vendor_modes_owner" UNIQUE NULLS NOT DISTINCT("client","vendor","purpose");