DROP INDEX "ix_people_company_id";--> statement-breakpoint
DROP INDEX "ix_documents_company_id";--> statement-breakpoint
CREATE INDEX "ix_companies_firm_records" ON "companies" USING btree ("id","niche","decline_reason","domain","created_at","name") WHERE niche is not null;--> statement-breakpoint
CREATE INDEX "ix_leads_company_verified" ON "leads" USING btree ("company_id","created_at") WHERE status = 'verified' and first_name is not null;--> statement-breakpoint
CREATE INDEX "ix_people_company_created" ON "people" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_documents_company_fetched" ON "documents" USING btree ("company_id","fetched_at");