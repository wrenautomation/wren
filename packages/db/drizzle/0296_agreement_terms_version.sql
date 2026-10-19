ALTER TABLE "pipeline"."offer_versions" DROP CONSTRAINT "uq_offer_versions_hash";--> statement-breakpoint
ALTER TABLE "delivery"."agreements" ADD COLUMN "terms_version" integer;--> statement-breakpoint
ALTER TABLE "delivery"."agreements" ADD CONSTRAINT "fk_agreements_terms_version_terms_versions" FOREIGN KEY ("terms_version") REFERENCES "pipeline"."terms_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_agreements_terms_version" ON "delivery"."agreements" USING btree ("terms_version");