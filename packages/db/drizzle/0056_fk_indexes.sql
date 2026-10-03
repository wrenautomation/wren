DROP INDEX "ix_enrichments_company_id";--> statement-breakpoint
DROP INDEX "ix_enrichments_document_id";--> statement-breakpoint
DROP INDEX "ix_contact_candidates_person_id";--> statement-breakpoint
DROP INDEX "ix_messages_enrollment_id";--> statement-breakpoint
ALTER TABLE "sms_contacts" ADD CONSTRAINT "fk_sms_contacts_source_document_id_documents" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_companies_import_id" ON "companies" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ix_import_errors_company_id" ON "import_errors" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_import_errors_claimant_company_id" ON "import_errors" USING btree ("claimant_company_id");--> statement-breakpoint
CREATE INDEX "ix_imports_superseded_by" ON "imports" USING btree ("superseded_by");--> statement-breakpoint
CREATE INDEX "ix_leads_suppression_id" ON "leads" USING btree ("suppression_id");--> statement-breakpoint
CREATE INDEX "ix_leads_import_id" ON "leads" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ix_leads_company_id" ON "leads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_people_import_id" ON "people" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ix_sightings_import_id" ON "sightings" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ix_company_checks_run_id" ON "company_checks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_company_checks_finding_id" ON "company_checks" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "ix_discovery_attempts_import_id" ON "discovery_attempts" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ix_findings_document_id" ON "findings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ix_person_lookups_run_id" ON "person_lookups" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_study_steps_run_id" ON "study_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_study_steps_document_id" ON "study_steps" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ix_call_invites_run_id" ON "call_invites" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_contact_candidates_lead_id" ON "contact_candidates" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ix_reports_run_id" ON "reports" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_thread_events_in_reply_to_message_id" ON "thread_events" USING btree ("in_reply_to_message_id");--> statement-breakpoint
CREATE INDEX "ix_verifications_email_domain" ON "verifications" USING btree (split_part("email", '@', 2));--> statement-breakpoint
CREATE INDEX "ix_sms_contacts_person_id" ON "sms_contacts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_sms_contacts_number_id" ON "sms_contacts" USING btree ("number_id");--> statement-breakpoint
CREATE INDEX "ix_sms_contacts_source_document_id" ON "sms_contacts" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "ix_sms_messages_run_id" ON "sms_messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_briefs_run_id" ON "briefs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_compositions_run_id" ON "compositions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_compositions_enrollment_id" ON "compositions" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "ix_crm_contacts_import_id" ON "crm_contacts" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ix_crm_contacts_company_id" ON "crm_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_handoffs_person_id" ON "handoffs" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_handoffs_enrollment_id" ON "handoffs" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "ix_bill_payments_document_id" ON "books"."bill_payments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ix_bills_run_id" ON "books"."bills" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_bills_document_id" ON "books"."bills" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ix_bills_account_id" ON "books"."bills" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_documents_run_id" ON "books"."documents" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_entries_run_id" ON "books"."entries" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_vendors_account_id" ON "books"."vendors" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_search_answers_run_id" ON "search_answers" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_search_answers_keyword_id" ON "search_answers" USING btree ("keyword_id");--> statement-breakpoint
CREATE INDEX "ix_search_days_run_id" ON "search_days" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_search_keywords_run_id" ON "search_keywords" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_search_keywords_parent_id" ON "search_keywords" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_search_pages_run_id" ON "search_pages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_search_proposals_run_id" ON "search_proposals" USING btree ("run_id");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
