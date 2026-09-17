CREATE TABLE "companies" (
	"id" serial NOT NULL,
	"domain" varchar(255),
	"name" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"import_id" integer,
	"raw" jsonb,
	"source_key" varchar(64),
	"social_url" varchar(512),
	"country" varchar(2),
	"domain_verified_at" timestamp with time zone,
	"niche" varchar(32),
	"timezone" varchar(64),
	CONSTRAINT "pk_companies" PRIMARY KEY("id"),
	CONSTRAINT "uq_companies_domain" UNIQUE("domain"),
	CONSTRAINT "uq_companies_source_key" UNIQUE("source_key"),
	CONSTRAINT "ck_companies_identified" CHECK ((domain IS NOT NULL) OR (source_key IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" serial NOT NULL,
	"import_id" integer NOT NULL,
	"row_number" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"reason" text NOT NULL,
	"raw" jsonb,
	"company_id" integer,
	"claimant_company_id" integer,
	CONSTRAINT "pk_import_errors" PRIMARY KEY("id"),
	CONSTRAINT "ck_import_errors_importerrorkind" CHECK (("kind")::text = ANY ((ARRAY['rejected'::character varying, 'domain_conflict'::character varying, 'domain_changed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" serial NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_ref" text NOT NULL,
	"stats" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" varchar(64),
	"as_of" date,
	"superseded_by" integer,
	"defaults" jsonb,
	CONSTRAINT "pk_imports" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial NOT NULL,
	"email" varchar(320) NOT NULL,
	"first_name" varchar,
	"last_name" varchar,
	"title" varchar,
	"persona" varchar(64),
	"source" varchar(64),
	"geo" varchar(64),
	"status" varchar(32) NOT NULL,
	"raw" jsonb NOT NULL,
	"company_id" integer,
	"import_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"country" varchar(2),
	"suppression_id" integer,
	"social_url" varchar(512),
	CONSTRAINT "pk_leads" PRIMARY KEY("id"),
	CONSTRAINT "uq_leads_email" UNIQUE("email"),
	CONSTRAINT "ck_leads_leadstatus" CHECK (("status")::text = ANY ((ARRAY['imported'::character varying, 'verified'::character varying, 'suppressed'::character varying, 'undeliverable'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" serial NOT NULL,
	"source_key" varchar(64),
	"company_id" integer NOT NULL,
	"full_name" text NOT NULL,
	"first_name" varchar,
	"last_name" varchar,
	"title" text,
	"is_compliance" boolean NOT NULL,
	"origin" varchar(32) NOT NULL,
	"origin_ref" text NOT NULL,
	"as_of" date,
	"linkedin_url" varchar(512),
	"notes" text,
	"import_id" integer,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_testimonial" boolean DEFAULT false NOT NULL,
	"testimonial_org" text,
	CONSTRAINT "pk_people" PRIMARY KEY("id"),
	CONSTRAINT "uq_people_source_key" UNIQUE("source_key"),
	CONSTRAINT "ck_people_personorigin" CHECK (("origin")::text = ANY ((ARRAY['registry'::character varying, 'website'::character varying, 'document'::character varying, 'manual'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid NOT NULL,
	"command" varchar(64) NOT NULL,
	"argv" jsonb NOT NULL,
	"niche" varchar(64),
	"model" varchar(64),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb,
	CONSTRAINT "pk_runs" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "sightings" (
	"id" serial NOT NULL,
	"company_id" integer,
	"lead_id" integer,
	"import_id" integer NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"person_id" integer,
	CONSTRAINT "pk_sightings" PRIMARY KEY("id"),
	CONSTRAINT "ck_sightings_one_entity" CHECK (((((company_id IS NOT NULL))::integer + ((lead_id IS NOT NULL))::integer) + ((person_id IS NOT NULL))::integer) = 1)
);
--> statement-breakpoint
CREATE TABLE "suppression_events" (
	"id" serial NOT NULL,
	"suppression_id" integer NOT NULL,
	"reason" varchar(32) NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_suppression_events" PRIMARY KEY("id"),
	CONSTRAINT "ck_suppression_events_suppressionreason" CHECK (("reason")::text = ANY ((ARRAY['opt_out'::character varying, 'bounce'::character varying, 'complaint'::character varying, 'manual'::character varying, 'lifted'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" serial NOT NULL,
	"kind" varchar(32) NOT NULL,
	"value" varchar(320) NOT NULL,
	"reason" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "pk_suppressions" PRIMARY KEY("id"),
	CONSTRAINT "uq_suppressions_kind" UNIQUE("kind","value"),
	CONSTRAINT "ck_suppressions_suppressionkind" CHECK (("kind")::text = ANY ((ARRAY['email'::character varying, 'domain'::character varying])::text[])),
	CONSTRAINT "ck_suppressions_suppressionreason" CHECK (("reason")::text = ANY ((ARRAY['opt_out'::character varying, 'bounce'::character varying, 'complaint'::character varying, 'manual'::character varying, 'lifted'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial NOT NULL,
	"company_id" integer,
	"url" text NOT NULL,
	"final_url" text,
	"kind" varchar(32) NOT NULL,
	"status_code" integer,
	"content_hash" varchar(64) NOT NULL,
	"title" text,
	"text" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"html" text,
	"fetch_tier" varchar(16) DEFAULT 'httpx' NOT NULL,
	"is_shell" boolean DEFAULT false NOT NULL,
	"robots_disallowed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pk_documents" PRIMARY KEY("id"),
	CONSTRAINT "uq_documents_url" UNIQUE("url","content_hash"),
	CONSTRAINT "ck_documents_documentkind" CHECK (("kind")::text = ANY ((ARRAY['webpage'::character varying, 'pdf'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "enrichments" (
	"id" serial NOT NULL,
	"document_id" integer,
	"kind" varchar(32) NOT NULL,
	"model" varchar(64) NOT NULL,
	"prompt_version" varchar(16) NOT NULL,
	"output" jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" integer,
	"run_id" uuid,
	CONSTRAINT "pk_enrichments" PRIMARY KEY("id"),
	CONSTRAINT "uq_enrichments_document_id" UNIQUE("document_id","kind","model","prompt_version"),
	CONSTRAINT "uq_enrichments_company_id" UNIQUE("company_id","kind","model","prompt_version"),
	CONSTRAINT "ck_enrichments_enrichmentkind" CHECK (("kind")::text = ANY ((ARRAY['people_extraction'::character varying, 'firmographics'::character varying, 'email_scan'::character varying, 'email_pick'::character varying])::text[])),
	CONSTRAINT "ck_enrichments_one_subject" CHECK ((document_id IS NULL) <> (company_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "contact_candidates" (
	"id" serial NOT NULL,
	"person_id" integer NOT NULL,
	"email" varchar(320) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"evidence" varchar(32) NOT NULL,
	"pattern" varchar(32),
	"rank" integer NOT NULL,
	"state" varchar(32) NOT NULL,
	"source_ref" text NOT NULL,
	"lead_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_contact_candidates" PRIMARY KEY("id"),
	CONSTRAINT "uq_contact_candidates_person_id" UNIQUE("person_id","email"),
	CONSTRAINT "ck_contact_candidates_candidateevidence" CHECK (("evidence")::text = ANY ((ARRAY['scraped'::character varying, 'derived_pattern'::character varying, 'guessed_pattern'::character varying])::text[])),
	CONSTRAINT "ck_contact_candidates_candidatestate" CHECK (("state")::text = ANY ((ARRAY['candidate'::character varying, 'queued'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" serial NOT NULL,
	"person_id" integer,
	"niche" varchar(32) NOT NULL,
	"sequence_name" varchar(64) NOT NULL,
	"sequence_snapshot" jsonb NOT NULL,
	"state" varchar(32) NOT NULL,
	"stop_reason" varchar(32),
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"to_email" varchar(320) NOT NULL,
	"sender" varchar(320) NOT NULL,
	"run_id" uuid,
	CONSTRAINT "pk_enrollments" PRIMARY KEY("id"),
	CONSTRAINT "ck_enrollments_enrollmentkind" CHECK (("kind")::text = ANY ((ARRAY['person'::character varying, 'role_inbox'::character varying])::text[])),
	CONSTRAINT "ck_enrollments_enrollmentstate" CHECK (("state")::text = ANY ((ARRAY['active'::character varying, 'finished'::character varying, 'stopped'::character varying])::text[])),
	CONSTRAINT "ck_enrollments_person_unless_role_inbox" CHECK ((person_id IS NOT NULL) OR ((kind)::text = 'role_inbox'::text)),
	CONSTRAINT "ck_enrollments_stop_reason_iff_stopped" CHECK (((state)::text = 'stopped'::text) = (stop_reason IS NOT NULL)),
	CONSTRAINT "ck_enrollments_stopreason" CHECK (("stop_reason")::text = ANY ((ARRAY['reply'::character varying, 'bounce'::character varying, 'opt_out'::character varying, 'complaint'::character varying, 'manual'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "inbox_syncs" (
	"sender" varchar(320) NOT NULL,
	"cursor_ms" bigint DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"stats" jsonb,
	CONSTRAINT "pk_inbox_syncs" PRIMARY KEY("sender")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial NOT NULL,
	"enrollment_id" integer NOT NULL,
	"step" integer NOT NULL,
	"template" varchar(64) NOT NULL,
	"template_version" varchar(12) NOT NULL,
	"to_email" varchar(320) NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"state" varchar(32) NOT NULL,
	"message_id" varchar(255),
	"detail" text,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gmail_id" varchar(64),
	"thread_id" varchar(64),
	"attempted_at" timestamp with time zone,
	"transport" varchar(32),
	"run_id" uuid,
	"sent_run_id" uuid,
	"review_reason" varchar(32),
	"edited_at" timestamp with time zone,
	"open_token" varchar(64),
	"approved_by" varchar(32),
	CONSTRAINT "pk_messages" PRIMARY KEY("id"),
	CONSTRAINT "uq_messages_enrollment_id" UNIQUE("enrollment_id","step"),
	CONSTRAINT "uq_messages_open_token" UNIQUE("open_token"),
	CONSTRAINT "ck_messages_approvalsource" CHECK (("approved_by")::text = ANY ((ARRAY['operator'::character varying, 'auto'::character varying])::text[])),
	CONSTRAINT "ck_messages_approved_by_iff_approved_at" CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
	CONSTRAINT "ck_messages_message_id_before_send" CHECK (((state)::text <> ALL ((ARRAY['sending'::character varying, 'sent'::character varying, 'unknown'::character varying])::text[])) OR (message_id IS NOT NULL)),
	CONSTRAINT "ck_messages_messagestate" CHECK (("state")::text = ANY ((ARRAY['draft'::character varying, 'approved'::character varying, 'rejected'::character varying, 'sending'::character varying, 'sent'::character varying, 'skipped'::character varying, 'failed'::character varying, 'unknown'::character varying])::text[])),
	CONSTRAINT "ck_messages_rejectreason" CHECK (("review_reason")::text = ANY ((ARRAY['wrong_fact'::character varying, 'too_salesy'::character varying, 'generic_opener'::character varying, 'bad_tone'::character varying, 'wrong_person'::character varying, 'bad_address'::character varying, 'other'::character varying])::text[])),
	CONSTRAINT "ck_messages_review_reason_only_on_reject" CHECK ((review_reason IS NULL) OR ((state)::text = 'rejected'::text)),
	CONSTRAINT "ck_messages_sent_at_iff_sent" CHECK ((sent_at IS NOT NULL) = ((state)::text = 'sent'::text)),
	CONSTRAINT "ck_messages_transport_iff_attempted" CHECK ((attempted_at IS NULL) = (transport IS NULL))
);
--> statement-breakpoint
CREATE TABLE "open_events" (
	"id" serial NOT NULL,
	"message_id" integer NOT NULL,
	"remote_id" bigint NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	CONSTRAINT "pk_open_events" PRIMARY KEY("id"),
	CONSTRAINT "uq_open_events_remote_id" UNIQUE("remote_id")
);
--> statement-breakpoint
CREATE TABLE "open_syncs" (
	"base_url" varchar(255) NOT NULL,
	"cursor_id" bigint DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"stats" jsonb,
	CONSTRAINT "pk_open_syncs" PRIMARY KEY("base_url")
);
--> statement-breakpoint
CREATE TABLE "postmaster_days" (
	"domain" varchar(253) NOT NULL,
	"day" date NOT NULL,
	"spam_rate" double precision,
	"domain_reputation" varchar(32),
	"spf_success_ratio" double precision,
	"dkim_success_ratio" double precision,
	"dmarc_success_ratio" double precision,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	"delivery_error_rate" double precision,
	"tls_outbound_count" bigint,
	"tls_inbound_count" bigint,
	CONSTRAINT "pk_postmaster_days" PRIMARY KEY("domain","day")
);
--> statement-breakpoint
CREATE TABLE "sender_pauses" (
	"id" serial NOT NULL,
	"sender" varchar(320) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"reason" text NOT NULL,
	"source" varchar(32) NOT NULL,
	"paused_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" varchar(64),
	"detail" jsonb,
	CONSTRAINT "pk_sender_pauses" PRIMARY KEY("id"),
	CONSTRAINT "ck_sender_pauses_pausesource" CHECK (("source")::text = ANY ((ARRAY['kill_switch'::character varying, 'operator'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" serial NOT NULL,
	"niche" varchar(32) NOT NULL,
	"template" varchar(64) NOT NULL,
	"version" varchar(12) NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_template_versions" PRIMARY KEY("id"),
	CONSTRAINT "uq_template_versions_niche" UNIQUE("niche","template","version")
);
--> statement-breakpoint
CREATE TABLE "thread_events" (
	"id" serial NOT NULL,
	"enrollment_id" integer NOT NULL,
	"in_reply_to_message_id" integer,
	"kind" varchar(32) NOT NULL,
	"bounce_class" varchar(32),
	"disposition" varchar(32),
	"disposition_source" varchar(32),
	"classified_at" timestamp with time zone,
	"gmail_id" varchar(64),
	"gmail_thread_id" varchar(64),
	"from_address" varchar(320),
	"subject" text,
	"snippet" text,
	"headers" jsonb,
	"detail" text,
	"received_at" timestamp with time zone NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body_text" text,
	"classification" jsonb,
	CONSTRAINT "pk_thread_events" PRIMARY KEY("id"),
	CONSTRAINT "ck_thread_events_bounce_class_iff_bounce" CHECK (((kind)::text = 'bounce'::text) = (bounce_class IS NOT NULL)),
	CONSTRAINT "ck_thread_events_bounceclass" CHECK (("bounce_class")::text = ANY ((ARRAY['hard'::character varying, 'soft'::character varying])::text[])),
	CONSTRAINT "ck_thread_events_disposition_only_on_reply" CHECK ((disposition IS NULL) OR ((kind)::text = 'reply'::text)),
	CONSTRAINT "ck_thread_events_disposition_source_iff_disposition" CHECK ((disposition IS NULL) = (disposition_source IS NULL)),
	CONSTRAINT "ck_thread_events_dispositionsource" CHECK (("disposition_source")::text = ANY ((ARRAY['rule'::character varying, 'operator'::character varying, 'llm'::character varying])::text[])),
	CONSTRAINT "ck_thread_events_replydisposition" CHECK (("disposition")::text = ANY ((ARRAY['interested'::character varying, 'meeting_booked'::character varying, 'not_interested'::character varying, 'not_now'::character varying, 'wrong_person'::character varying, 'referral'::character varying, 'other'::character varying])::text[])),
	CONSTRAINT "ck_thread_events_threadeventkind" CHECK (("kind")::text = ANY ((ARRAY['reply'::character varying, 'bounce'::character varying, 'auto_reply'::character varying, 'unsubscribe'::character varying, 'complaint'::character varying, 'note'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" serial NOT NULL,
	"lead_id" integer,
	"verifier" varchar(64) NOT NULL,
	"result" varchar(32) NOT NULL,
	"raw" jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" varchar(320),
	"contact_candidate_id" integer,
	CONSTRAINT "pk_verifications" PRIMARY KEY("id"),
	CONSTRAINT "ck_verifications_attributed" CHECK ((lead_id IS NOT NULL) OR (contact_candidate_id IS NOT NULL)),
	CONSTRAINT "ck_verifications_verificationresult" CHECK (("result")::text = ANY ((ARRAY['valid'::character varying, 'invalid'::character varying, 'risky'::character varying, 'catch_all'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "fk_companies_import_id_imports" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "fk_import_errors_claimant_company_id_companies" FOREIGN KEY ("claimant_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "fk_import_errors_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "fk_import_errors_import_id_imports" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "fk_imports_superseded_by_imports" FOREIGN KEY ("superseded_by") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_import_id_imports" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "fk_leads_suppression_id_suppressions" FOREIGN KEY ("suppression_id") REFERENCES "public"."suppressions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "fk_people_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "fk_people_import_id_imports" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sightings" ADD CONSTRAINT "fk_sightings_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sightings" ADD CONSTRAINT "fk_sightings_import_id_imports" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sightings" ADD CONSTRAINT "fk_sightings_lead_id_leads" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sightings" ADD CONSTRAINT "fk_sightings_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_events" ADD CONSTRAINT "fk_suppression_events_suppression_id_suppressions" FOREIGN KEY ("suppression_id") REFERENCES "public"."suppressions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "fk_documents_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichments" ADD CONSTRAINT "fk_enrichments_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichments" ADD CONSTRAINT "fk_enrichments_document_id_documents" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichments" ADD CONSTRAINT "fk_enrichments_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_candidates" ADD CONSTRAINT "fk_contact_candidates_lead_id_leads" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_candidates" ADD CONSTRAINT "fk_contact_candidates_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "fk_messages_enrollment_id_enrollments" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "fk_messages_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "fk_messages_sent_run_id_runs" FOREIGN KEY ("sent_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_events" ADD CONSTRAINT "fk_open_events_message_id_messages" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_events" ADD CONSTRAINT "fk_open_events_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postmaster_days" ADD CONSTRAINT "fk_postmaster_days_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_events" ADD CONSTRAINT "fk_thread_events_enrollment_id_enrollments" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_events" ADD CONSTRAINT "fk_thread_events_in_reply_to_message_id_messages" FOREIGN KEY ("in_reply_to_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_events" ADD CONSTRAINT "fk_thread_events_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "fk_verifications_contact_candidate_id_contact_candidates" FOREIGN KEY ("contact_candidate_id") REFERENCES "public"."contact_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "fk_verifications_lead_id_leads" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_import_errors_import_id" ON "import_errors" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ix_people_company_id" ON "people" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_sightings_company_id" ON "sightings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_sightings_lead_id" ON "sightings" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ix_sightings_person_id" ON "sightings" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_suppression_events_suppression_id" ON "suppression_events" USING btree ("suppression_id");--> statement-breakpoint
CREATE INDEX "ix_documents_company_id" ON "documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_enrichments_company_id" ON "enrichments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_enrichments_document_id" ON "enrichments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ix_enrichments_run_id" ON "enrichments" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_contact_candidates_domain" ON "contact_candidates" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "ix_contact_candidates_person_id" ON "contact_candidates" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_enrollments_company_id" ON "enrollments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_enrollments_person_id" ON "enrollments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_enrollments_run_id" ON "enrollments" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_enrollments_active_address" ON "enrollments" USING btree (lower((to_email)::text)) WHERE (state)::text = 'active'::text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_enrollments_active_company" ON "enrollments" USING btree ("company_id") WHERE (state)::text = 'active'::text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_enrollments_active_person" ON "enrollments" USING btree ("person_id") WHERE (state)::text = 'active'::text;--> statement-breakpoint
CREATE INDEX "ix_messages_enrollment_id" ON "messages" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "ix_messages_run_id" ON "messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_messages_sent_run_id" ON "messages" USING btree ("sent_run_id");--> statement-breakpoint
CREATE INDEX "ix_open_events_message_id" ON "open_events" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "ix_open_events_run_id" ON "open_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_open_events_seen_at" ON "open_events" USING btree ("seen_at");--> statement-breakpoint
CREATE INDEX "ix_postmaster_days_run_id" ON "postmaster_days" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ix_sender_pauses_sender" ON "sender_pauses" USING btree ("sender");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sender_pauses_active" ON "sender_pauses" USING btree ("sender") WHERE lifted_at IS NULL;--> statement-breakpoint
CREATE INDEX "ix_thread_events_enrollment_id" ON "thread_events" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "ix_thread_events_run_id" ON "thread_events" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_thread_events_gmail_id" ON "thread_events" USING btree ("gmail_id") WHERE gmail_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_verifications_contact_candidate_id" ON "verifications" USING btree ("contact_candidate_id");--> statement-breakpoint
CREATE INDEX "ix_verifications_lead_id" ON "verifications" USING btree ("lead_id");--> statement-breakpoint
CREATE VIEW "public"."agency_facts" AS (WITH newest_sighting AS ( SELECT DISTINCT ON (sightings.company_id) sightings.company_id, sightings.raw, sightings.seen_at FROM sightings WHERE sightings.company_id IS NOT NULL AND sightings.raw ?| ARRAY['agency.min_budget'::text, 'agency.hourly_rate'::text, 'agency.team_size'::text, 'agency.services'::text, 'agency.industries'::text, 'agency.founded'::text, 'agency.rating'::text] ORDER BY sightings.company_id, sightings.seen_at DESC ), eff AS ( SELECT c_1.id AS company_id, COALESCE(ns.raw, c_1.raw) AS raw, ns.seen_at AS last_seen_at FROM companies c_1 LEFT JOIN newest_sighting ns ON ns.company_id = c_1.id ), shares AS ( SELECT eff_1.company_id, COALESCE(sum( CASE WHEN m.m[2] ~* 'marketing|advertis|pay per click|\yppc\y|search engine|\yseo\y|\ysem\y|social media|public relations|media (buying|planning)|influencer|conversion|lead generation|digital strategy|market research|affiliate'::text THEN m.m[1]::integer ELSE NULL::integer END), 0::bigint) AS marketing, COALESCE(sum( CASE WHEN m.m[2] ~* 'development|software|engineering|\yapp\y|mobile|web design|ux|ui|product design|branding|graphic design|logo|video|animation|e-?commerce|shopify|it (managed|strategy)|cloud|data|\yai\y|system integrat|blockchain|iot|cyber|testing|design|store|theme'::text THEN m.m[1]::integer ELSE NULL::integer END), 0::bigint) AS build FROM eff eff_1, LATERAL regexp_matches(eff_1.raw ->> 'agency.services'::text, '([0-9]+)%\s*([^,]+)'::text, 'g'::text) m(m) GROUP BY eff_1.company_id ) SELECT c.id AS company_id, c.source_key, c.domain, c.name, c.country, NULLIF(regexp_replace((regexp_match(eff.raw ->> 'agency.team_size'::text, '[0-9][0-9,]*'::text))[1], ','::text, ''::text, 'g'::text), ''::text)::integer AS employees, NULLIF(regexp_replace((regexp_match(eff.raw ->> 'agency.min_budget'::text, '[0-9][0-9,]*'::text))[1], ','::text, ''::text, 'g'::text), ''::text)::bigint AS min_budget_usd, NULLIF(regexp_replace((regexp_match(eff.raw ->> 'agency.hourly_rate'::text, '[0-9][0-9,]*'::text))[1], ','::text, ''::text, 'g'::text), ''::text)::integer AS hourly_rate_usd, (regexp_match(eff.raw ->> 'agency.founded'::text, '[0-9]{4}'::text))[1]::integer AS founded_year, (regexp_match(eff.raw ->> 'agency.rating'::text, '[0-9]+(?:\.[0-9]+)?'::text))[1]::numeric AS rating, eff.raw ->> 'agency.services'::text AS services, eff.raw ->> 'agency.industries'::text AS industries, eff.last_seen_at, CASE WHEN shares.marketing > shares.build THEN 'marketing'::text WHEN shares.build > shares.marketing THEN 'build'::text ELSE NULL::text END AS segment FROM companies c JOIN eff ON eff.company_id = c.id LEFT JOIN shares ON shares.company_id = c.id WHERE eff.raw ?| ARRAY['agency.min_budget'::text, 'agency.hourly_rate'::text, 'agency.team_size'::text, 'agency.services'::text, 'agency.industries'::text, 'agency.founded'::text, 'agency.rating'::text]);--> statement-breakpoint
CREATE VIEW "public"."firm_facts" AS (WITH facts AS ( WITH newest_sighting AS ( SELECT DISTINCT ON (sightings.company_id) sightings.company_id, sightings.raw, sightings.seen_at FROM sightings WHERE sightings.company_id IS NOT NULL AND sightings.raw ? '5F(2)(c)'::text ORDER BY sightings.company_id, sightings.seen_at DESC ), eff AS ( SELECT c_1.id AS company_id, COALESCE(ns.raw, c_1.raw) AS raw, ns.seen_at AS last_seen_at FROM companies c_1 LEFT JOIN newest_sighting ns ON ns.company_id = c_1.id ) SELECT c.id AS company_id, c.source_key, c.domain, c.name, c.country, NULLIF(regexp_replace(split_part(eff.raw ->> '5F(2)(c)'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::bigint AS aum_usd, NULLIF(regexp_replace(split_part(eff.raw ->> '5A'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS employees, NULLIF(regexp_replace(split_part(eff.raw ->> '5D(a)(1)'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS ind_clients, NULLIF(regexp_replace(split_part(eff.raw ->> '5D(b)(1)'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS hnw_clients, NULLIF(regexp_replace(split_part(eff.raw ->> '5D(f)(1)'::text, '.'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS pooled_clients, eff.raw ->> 'Main Office Country'::text AS country_raw, eff.last_seen_at FROM companies c JOIN eff ON eff.company_id = c.id WHERE eff.raw ? '5F(2)(c)'::text ) SELECT company_id, source_key, domain, name, country, aum_usd, employees, ind_clients, hnw_clients, pooled_clients, country_raw, last_seen_at, CASE WHEN COALESCE(ind_clients, 0) > 0 OR COALESCE(hnw_clients, 0) > 0 THEN 'individual'::text WHEN COALESCE(pooled_clients, 0) > 0 THEN 'pooled'::text WHEN ind_clients IS NOT NULL OR hnw_clients IS NOT NULL OR pooled_clients IS NOT NULL THEN 'institutional'::text ELSE 'unknown'::text END AS segment FROM facts);--> statement-breakpoint
CREATE VIEW "public"."person_facts" AS (SELECT p.id AS person_id, p.company_id, c.source_key AS company_source_key, c.name AS company_name, c.domain AS company_domain, c.niche AS company_niche, p.source_key, p.full_name, p.first_name, p.last_name, p.title, p.is_compliance, p.is_testimonial, p.testimonial_org, p.origin, p.as_of, p.linkedin_url, CASE WHEN p.title IS NULL THEN NULL::integer WHEN p.is_testimonial THEN NULL::integer WHEN c.niche::text = 'sec_ria'::text THEN CASE WHEN p.title ~* '\y(vice president|executive vice|senior vice)\y'::text THEN 3 WHEN p.title ~* '\y(owner|founder|principal|chief executive|ceo|president|managing member|manager)\y'::text THEN 1 WHEN p.title ~* '\y(cio|chief investment|coo|chief operating|managing partner|managing director|partner)\y'::text THEN 2 WHEN p.title ~* '\y(cmo|chief marketing|business development|wealth advisor|financial advisor|portfolio manager|director)\y'::text THEN 3 ELSE NULL::integer END WHEN c.niche::text = 'agencies'::text THEN CASE WHEN p.title ~* '\y(vice president|executive vice|senior vice)\y'::text THEN 3 WHEN p.title ~* '\y(owner|founder|co-founder|chief executive|ceo|president|principal|managing director|managing partner)\y'::text THEN 1 WHEN p.title ~* '\y(coo|chief operating|operations director|head of operations|general manager|managing member|partner)\y'::text THEN 2 WHEN p.title ~* '\y(cmo|chief marketing|creative director|marketing director|account director|business development|head of|director)\y'::text THEN 3 ELSE NULL::integer END ELSE CASE WHEN p.title ~* '\y(vice president|executive vice|senior vice)\y'::text THEN 3 WHEN p.title ~* '\y(owner|founder|co-founder|chief executive|ceo|president|managing member)\y'::text THEN 1 WHEN p.title ~* '\y(coo|chief operating|managing partner|managing director)\y'::text THEN 2 WHEN p.title ~* '\y(director|head of)\y'::text THEN 3 ELSE NULL::integer END END AS role_rank, p.is_compliance OR COALESCE(p.title ~* '\y(compliance|counsel|attorney|paralegal|regulatory)\y'::text, false) AS avoid_emailing_first FROM people p JOIN companies c ON c.id = p.company_id);--> statement-breakpoint
CREATE VIEW "public"."campaign_funnel" AS (WITH sends AS ( SELECT m.enrollment_id, count(*) FILTER (WHERE m.step = 0) AS openers_sent, count(*) FILTER (WHERE m.step > 0) AS followups_sent FROM messages m WHERE m.state::text = 'sent'::text GROUP BY m.enrollment_id ), inbound AS ( SELECT te.enrollment_id, count(*) FILTER (WHERE te.kind::text = 'reply'::text) AS replies, count(*) FILTER (WHERE te.disposition::text = ANY (ARRAY['interested'::character varying, 'meeting_booked'::character varying]::text[])) AS interested, count(*) FILTER (WHERE te.kind::text = 'auto_reply'::text) AS auto_replies, count(*) FILTER (WHERE te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text) AS hard_bounces, count(*) FILTER (WHERE te.kind::text = 'unsubscribe'::text) AS unsubscribes FROM thread_events te GROUP BY te.enrollment_id ) SELECT e.niche, e.sequence_name, e.kind AS enrollment_kind, count(*) AS enrolled, count(*) FILTER (WHERE e.state::text = 'active'::text) AS active, count(*) FILTER (WHERE e.state::text = 'finished'::text) AS finished, count(*) FILTER (WHERE e.stop_reason::text = 'reply'::text) AS stopped_reply, count(*) FILTER (WHERE e.stop_reason::text = 'bounce'::text) AS stopped_bounce, count(*) FILTER (WHERE e.stop_reason::text = 'opt_out'::text) AS stopped_opt_out, count(*) FILTER (WHERE e.stop_reason::text = 'complaint'::text) AS stopped_complaint, count(*) FILTER (WHERE e.stop_reason::text = 'manual'::text) AS stopped_manual, COALESCE(sum(sends.openers_sent), 0::numeric) AS openers_sent, COALESCE(sum(sends.followups_sent), 0::numeric) AS followups_sent, COALESCE(sum(inbound.replies), 0::numeric) AS replies, COALESCE(sum(inbound.interested), 0::numeric) AS interested, COALESCE(sum(inbound.auto_replies), 0::numeric) AS auto_replies, COALESCE(sum(inbound.hard_bounces), 0::numeric) AS hard_bounces, COALESCE(sum(inbound.unsubscribes), 0::numeric) AS unsubscribes FROM enrollments e LEFT JOIN sends ON sends.enrollment_id = e.id LEFT JOIN inbound ON inbound.enrollment_id = e.id GROUP BY e.niche, e.sequence_name, e.kind);--> statement-breakpoint
CREATE VIEW "public"."email_llm_calls" AS (SELECT e.id AS enrichment_id, NULL::integer AS thread_event_id, e.run_id, e.kind::text AS kind, e.model::text AS model, (e.output -> 'call'::text) ->> 'provider'::text AS provider, e.prompt_version::text AS prompt_version, e.company_id, e.document_id, (((e.output -> 'call'::text) -> 'usage'::text) ->> 'input'::text)::integer AS input_tokens, (((e.output -> 'call'::text) -> 'usage'::text) ->> 'output'::text)::integer AS output_tokens, (((e.output -> 'call'::text) -> 'usage'::text) ->> 'total'::text)::integer AS total_tokens, (((e.output -> 'call'::text) -> 'usage'::text) ->> 'reasoning'::text)::integer AS reasoning_tokens, ((e.output -> 'call'::text) ->> 'latency_ms'::text)::integer AS latency_ms, (e.output -> 'call'::text) ->> 'finish_reason'::text AS finish_reason, COALESCE(((e.output -> 'call'::text) ->> 'rejected'::text)::boolean, false) AS rejected, (e.output ->> 'parse_error'::text) IS NOT NULL AS parse_failed, e.output ? 'call'::text AS has_call_record, e.applied_at, e.created_at FROM enrichments e WHERE e.model::text <> 'deterministic'::text AND jsonb_typeof(e.output -> 'call'::text) IS DISTINCT FROM 'null'::text UNION ALL SELECT NULL::integer AS enrichment_id, te.id AS thread_event_id, ((te.classification -> 'call'::text) ->> 'run_id'::text)::uuid AS run_id, 'reply_disposition'::text AS kind, te.classification ->> 'model'::text AS model, (te.classification -> 'call'::text) ->> 'provider'::text AS provider, te.classification ->> 'prompt_version'::text AS prompt_version, en.company_id, NULL::integer AS document_id, (((te.classification -> 'call'::text) -> 'usage'::text) ->> 'input'::text)::integer AS input_tokens, (((te.classification -> 'call'::text) -> 'usage'::text) ->> 'output'::text)::integer AS output_tokens, (((te.classification -> 'call'::text) -> 'usage'::text) ->> 'total'::text)::integer AS total_tokens, (((te.classification -> 'call'::text) -> 'usage'::text) ->> 'reasoning'::text)::integer AS reasoning_tokens, ((te.classification -> 'call'::text) ->> 'latency_ms'::text)::integer AS latency_ms, (te.classification -> 'call'::text) ->> 'finish_reason'::text AS finish_reason, COALESCE(((te.classification -> 'call'::text) ->> 'rejected'::text)::boolean, false) AS rejected, (te.classification ->> 'parse_error'::text) IS NOT NULL AS parse_failed, te.classification ? 'call'::text AS has_call_record, CASE WHEN te.disposition_source::text = 'llm'::text THEN te.classified_at ELSE NULL::timestamp with time zone END AS applied_at, (te.classification ->> 'classified_at'::text)::timestamp with time zone AS created_at FROM thread_events te JOIN enrollments en ON en.id = te.enrollment_id WHERE te.classification IS NOT NULL AND jsonb_typeof(te.classification -> 'call'::text) IS DISTINCT FROM 'null'::text);--> statement-breakpoint
CREATE VIEW "public"."email_stage_costs" AS (SELECT c.run_id, r.command, r.niche, c.kind, c.model, c.provider, count(*) AS calls, count(*) FILTER (WHERE c.rejected) AS rejected_calls, count(*) FILTER (WHERE c.parse_failed) AS parse_failures, sum(c.input_tokens) AS input_tokens, sum(c.output_tokens) AS output_tokens, sum(c.total_tokens) AS total_tokens, sum(c.reasoning_tokens) AS reasoning_tokens, avg(c.latency_ms)::integer AS avg_latency_ms, max(c.latency_ms) AS max_latency_ms, min(c.created_at) AS first_call_at, max(c.created_at) AS last_call_at FROM email_llm_calls c LEFT JOIN runs r ON r.id = c.run_id GROUP BY c.run_id, r.command, r.niche, c.kind, c.model, c.provider);--> statement-breakpoint
CREATE VIEW "public"."enrollment_outcomes" AS (WITH opener AS ( SELECT m.enrollment_id, m.template AS opener_template, m.template_version AS opener_template_version, m.state AS opener_state, m.provenance -> 'address'::text AS address FROM messages m WHERE m.step = 0 ), sends AS ( SELECT m.enrollment_id, count(*) FILTER (WHERE m.state::text = 'sent'::text) AS steps_sent, min(m.sent_at) AS first_sent_at, max(m.sent_at) AS last_sent_at FROM messages m GROUP BY m.enrollment_id ), events AS ( SELECT te.enrollment_id, count(*) FILTER (WHERE te.kind::text = 'reply'::text) AS replies, bool_or(te.kind::text = 'reply'::text) AS replied, bool_or(te.kind::text = 'reply'::text AND (te.disposition::text = ANY (ARRAY['interested'::character varying, 'meeting_booked'::character varying]::text[]))) AS interested, bool_or(te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text) AS hard_bounced, bool_or(te.kind::text = 'bounce'::text AND te.bounce_class::text = 'soft'::text) AS soft_bounced, bool_or(te.kind::text = 'unsubscribe'::text) AS unsubscribed, bool_or(te.kind::text = 'complaint'::text) AS complained, bool_or(te.kind::text = 'auto_reply'::text) AS auto_replied, min(te.received_at) FILTER (WHERE te.kind::text = 'reply'::text) AS first_reply_at, (array_agg(te.disposition ORDER BY te.received_at DESC, te.id DESC) FILTER (WHERE te.kind::text = 'reply'::text AND te.disposition IS NOT NULL))[1] AS disposition FROM thread_events te GROUP BY te.enrollment_id ) SELECT e.id AS enrollment_id, e.niche, e.sequence_name, e.kind AS enrollment_kind, e.company_id, e.person_id, e.to_email, e.sender, e.state, e.stop_reason, e.created_at AS enrolled_at, o.opener_template, o.opener_template_version, o.opener_state, o.address ->> 'evidence'::text AS evidence, o.address ->> 'verification_result'::text AS verification_result, o.address ->> 'pick_method'::text AS pick_method, (o.address ->> 'lead_id'::text)::integer AS lead_id, (o.address ->> 'candidate_id'::text)::integer AS candidate_id, (o.address ->> 'document_id'::text)::integer AS source_document_id, o.address ->> 'source_url'::text AS source_url, COALESCE(s.steps_sent, 0::bigint) AS steps_sent, s.first_sent_at, s.last_sent_at, COALESCE(ev.replies, 0::bigint) AS replies, COALESCE(ev.replied, false) AS replied, COALESCE(ev.interested, false) AS interested, ev.disposition, COALESCE(ev.hard_bounced, false) AS hard_bounced, COALESCE(ev.soft_bounced, false) AS soft_bounced, COALESCE(ev.unsubscribed, false) AS unsubscribed, COALESCE(ev.complained, false) AS complained, COALESCE(ev.auto_replied, false) AS auto_replied, ev.first_reply_at FROM enrollments e LEFT JOIN opener o ON o.enrollment_id = e.id LEFT JOIN sends s ON s.enrollment_id = e.id LEFT JOIN events ev ON ev.enrollment_id = e.id);--> statement-breakpoint
CREATE VIEW "public"."funnel_latency" AS (WITH stamps AS ( SELECT c.id AS company_id, c.niche, c.domain, c.created_at AS imported_at, ( SELECT min(d.fetched_at) AS min FROM documents d WHERE d.company_id = c.id) AS first_fetch_at, ( SELECT min(e.created_at) AS min FROM enrollments e WHERE e.company_id = c.id) AS enrolled_at, ( SELECT min(m.sent_at) AS min FROM messages m JOIN enrollments e ON e.id = m.enrollment_id WHERE e.company_id = c.id AND m.step = 0 AND m.state::text = 'sent'::text) AS first_send_at, ( SELECT min(te.received_at) AS min FROM thread_events te JOIN enrollments e ON e.id = te.enrollment_id WHERE e.company_id = c.id AND te.kind::text = 'reply'::text) AS first_reply_at FROM companies c ) SELECT company_id, niche, domain, imported_at, first_fetch_at, enrolled_at, first_send_at, first_reply_at, EXTRACT(epoch FROM first_fetch_at - imported_at) / 86400.0 AS days_import_to_fetch, EXTRACT(epoch FROM enrolled_at - imported_at) / 86400.0 AS days_import_to_enroll, EXTRACT(epoch FROM first_send_at - enrolled_at) / 86400.0 AS days_enroll_to_send, EXTRACT(epoch FROM first_send_at - imported_at) / 86400.0 AS days_import_to_send, EXTRACT(epoch FROM first_reply_at - first_send_at) / 86400.0 AS days_send_to_reply FROM stamps s);--> statement-breakpoint
CREATE VIEW "public"."open_outcomes" AS (WITH tracked AS ( SELECT m.id, m.sent_at, m.template, e.niche, e.sequence_name, m.step FROM messages m JOIN enrollments e ON e.id = m.enrollment_id WHERE m.state::text = 'sent'::text AND m.open_token IS NOT NULL ), hits AS ( SELECT t_1.id, count(oe.id) AS fetches, count(oe.id) FILTER (WHERE (oe.seen_at - t_1.sent_at) >= '00:02:00'::interval) AS slow_fetches FROM tracked t_1 LEFT JOIN open_events oe ON oe.message_id = t_1.id GROUP BY t_1.id ) SELECT t.niche, t.sequence_name, t.step, t.template, count(*) AS tracked_sent, count(*) FILTER (WHERE h.fetches > 0) AS opened_raw, count(*) FILTER (WHERE h.slow_fetches > 0) AS opened_human_plausible, sum(h.fetches) AS fetches, count(*) FILTER (WHERE h.fetches > 0)::numeric / NULLIF(count(*), 0)::numeric AS open_rate_raw, count(*) FILTER (WHERE h.slow_fetches > 0)::numeric / NULLIF(count(*), 0)::numeric AS open_rate_human_plausible FROM tracked t JOIN hits h ON h.id = t.id GROUP BY t.niche, t.sequence_name, t.step, t.template ORDER BY t.niche, t.sequence_name, t.step);--> statement-breakpoint
CREATE VIEW "public"."rejections_by_reason" AS (SELECT e.niche, m.template, m.template_version, COALESCE(m.review_reason, 'unspecified'::character varying) AS reason, count(*) AS rejected FROM messages m JOIN enrollments e ON e.id = m.enrollment_id WHERE m.state::text = 'rejected'::text GROUP BY e.niche, m.template, m.template_version, (COALESCE(m.review_reason, 'unspecified'::character varying)));--> statement-breakpoint
CREATE VIEW "public"."reply_by_arm_step" AS (SELECT e.niche, CASE WHEN strpos(o.template::text, '/'::text) > 0 THEN split_part(o.template::text, '/'::text, 1)::character varying ELSE o.template END AS arm, m.step, m.template, m.template_version, count(DISTINCT m.id) FILTER (WHERE m.state::text = 'sent'::text) AS sent, count(DISTINCT te.id) FILTER (WHERE te.kind::text = 'reply'::text) AS replies, count(DISTINCT te.id) FILTER (WHERE te.kind::text = 'reply'::text AND (te.disposition::text = ANY (ARRAY['interested'::character varying, 'meeting_booked'::character varying]::text[]))) AS interested, count(DISTINCT te.id) FILTER (WHERE te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text) AS hard_bounces, round(100.0 * count(DISTINCT te.id) FILTER (WHERE te.kind::text = 'reply'::text)::numeric / NULLIF(count(DISTINCT m.id) FILTER (WHERE m.state::text = 'sent'::text), 0)::numeric, 2) AS reply_rate_pct FROM messages m JOIN enrollments e ON e.id = m.enrollment_id JOIN messages o ON o.enrollment_id = e.id AND o.step = 0 LEFT JOIN thread_events te ON te.in_reply_to_message_id = m.id GROUP BY e.niche, o.template, m.step, m.template, m.template_version);--> statement-breakpoint
CREATE VIEW "public"."reply_by_evidence" AS (SELECT niche, enrollment_kind, evidence, COALESCE(verification_result, 'none'::text) AS verification_result, pick_method, count(*) AS enrolled, count(*) FILTER (WHERE first_sent_at IS NOT NULL) AS opened, count(*) FILTER (WHERE replied) AS replied, count(*) FILTER (WHERE interested) AS interested, count(*) FILTER (WHERE hard_bounced) AS hard_bounced, count(*) FILTER (WHERE unsubscribed) AS unsubscribed, round(100.0 * count(*) FILTER (WHERE replied)::numeric / NULLIF(count(*) FILTER (WHERE first_sent_at IS NOT NULL), 0)::numeric, 2) AS reply_rate_pct, round(100.0 * count(*) FILTER (WHERE hard_bounced)::numeric / NULLIF(count(*) FILTER (WHERE first_sent_at IS NOT NULL), 0)::numeric, 2) AS bounce_rate_pct FROM enrollment_outcomes eo GROUP BY niche, enrollment_kind, evidence, (COALESCE(verification_result, 'none'::text)), pick_method);--> statement-breakpoint
CREATE VIEW "public"."reply_outcomes" AS (SELECT te.id AS event_id, te.enrollment_id, e.niche, e.sequence_name, e.kind AS enrollment_kind, e.sender, e.company_id, e.to_email, te.kind, te.bounce_class, te.disposition, te.disposition_source, te.received_at, origin.step AS replied_to_step, origin.template AS replied_to_template, origin.template_version AS replied_to_template_version FROM thread_events te JOIN enrollments e ON e.id = te.enrollment_id LEFT JOIN messages origin ON origin.id = te.in_reply_to_message_id);--> statement-breakpoint
CREATE VIEW "public"."review_outcomes" AS (SELECT e.niche, m.template, m.template_version, count(*) AS drafted, count(*) FILTER (WHERE m.state::text = 'draft'::text) AS awaiting, count(*) FILTER (WHERE m.edited_at IS NOT NULL) AS edited, count(*) FILTER (WHERE m.approved_by::text = 'operator'::text) AS approved, count(*) FILTER (WHERE m.approved_by::text = 'auto'::text) AS auto_approved, count(*) FILTER (WHERE m.state::text = 'rejected'::text) AS rejected, count(*) FILTER (WHERE m.state::text = 'sent'::text) AS sent, count(*) FILTER (WHERE m.approved_by::text = 'operator'::text OR m.state::text = 'rejected'::text) AS reviewed, round(100.0 * count(*) FILTER (WHERE m.edited_at IS NOT NULL)::numeric / NULLIF(count(*) FILTER (WHERE m.approved_by::text = 'operator'::text OR m.state::text = 'rejected'::text), 0)::numeric, 2) AS edit_rate_pct, round(100.0 * count(*) FILTER (WHERE m.state::text = 'rejected'::text)::numeric / NULLIF(count(*) FILTER (WHERE m.approved_by::text = 'operator'::text OR m.state::text = 'rejected'::text), 0)::numeric, 2) AS reject_rate_pct FROM messages m JOIN enrollments e ON e.id = m.enrollment_id GROUP BY e.niche, m.template, m.template_version);--> statement-breakpoint
CREATE VIEW "public"."send_health" AS (SELECT sender, split_part(sender::text, '@'::text, 2) AS domain, day, sum(sent) AS sent, sum(hard_bounces) AS hard_bounces, sum(soft_bounces) AS soft_bounces, sum(replies) AS replies, sum(auto_replies) AS auto_replies, sum(unsubscribes) AS unsubscribes, sum(complaints) AS complaints, sum(hard_bounces)::numeric / NULLIF(sum(sent), 0)::numeric AS bounce_rate FROM ( SELECT e.sender, (m.sent_at AT TIME ZONE 'UTC'::text)::date AS day, 1 AS sent, 0 AS hard_bounces, 0 AS soft_bounces, 0 AS replies, 0 AS auto_replies, 0 AS unsubscribes, 0 AS complaints FROM messages m JOIN enrollments e ON e.id = m.enrollment_id WHERE m.state::text = 'sent'::text UNION ALL SELECT e.sender, COALESCE((origin.sent_at AT TIME ZONE 'UTC'::text)::date, (te.received_at AT TIME ZONE 'UTC'::text)::date) AS day, 0 AS sent, CASE WHEN te.kind::text = 'bounce'::text AND te.bounce_class::text = 'hard'::text THEN 1 ELSE 0 END AS hard_bounces, CASE WHEN te.kind::text = 'bounce'::text AND te.bounce_class::text = 'soft'::text THEN 1 ELSE 0 END AS soft_bounces, CASE WHEN te.kind::text = 'reply'::text THEN 1 ELSE 0 END AS replies, CASE WHEN te.kind::text = 'auto_reply'::text THEN 1 ELSE 0 END AS auto_replies, CASE WHEN te.kind::text = 'unsubscribe'::text THEN 1 ELSE 0 END AS unsubscribes, CASE WHEN te.kind::text = 'complaint'::text THEN 1 ELSE 0 END AS complaints FROM thread_events te JOIN enrollments e ON e.id = te.enrollment_id LEFT JOIN messages origin ON origin.id = te.in_reply_to_message_id WHERE te.kind::text <> 'note'::text) rows GROUP BY sender, day);--> statement-breakpoint
CREATE VIEW "public"."verification_yield" AS (WITH newest AS ( SELECT DISTINCT ON (cc_1.id) cc_1.id AS candidate_id, v.result FROM contact_candidates cc_1 JOIN verifications v ON v.contact_candidate_id = cc_1.id OR cc_1.lead_id IS NOT NULL AND v.lead_id = cc_1.lead_id ORDER BY cc_1.id, v.checked_at DESC, v.id DESC ) SELECT c.niche, cc.evidence, count(*) AS candidates, count(n.candidate_id) AS verified, count(*) FILTER (WHERE n.result::text = 'valid'::text) AS valid, count(*) FILTER (WHERE n.result::text = 'invalid'::text) AS invalid, count(*) FILTER (WHERE n.result::text = 'risky'::text) AS risky, count(*) FILTER (WHERE n.result::text = 'catch_all'::text) AS catch_all, round(100.0 * count(*) FILTER (WHERE n.result::text = 'valid'::text)::numeric / NULLIF(count(n.candidate_id), 0)::numeric, 2) AS valid_rate_pct FROM contact_candidates cc JOIN people p ON p.id = cc.person_id JOIN companies c ON c.id = p.company_id LEFT JOIN newest n ON n.candidate_id = cc.id GROUP BY c.niche, cc.evidence);