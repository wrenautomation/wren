# public: schema

Tables and views: 333.

## public.companies (table)

- `id integer = nextval('companies_id_seq'::regclass)`
- `domain varchar(255) null`
- `name varchar null`
- `created_at timestamp with time zone = now()`
- `import_id integer null`
- `raw jsonb null`
- `source_key varchar(64) null`
- `social_url varchar(512) null`
- `country varchar(2) null`
- `domain_verified_at timestamp with time zone null`
- `niche varchar(32) null`
- `timezone varchar(64) null`
- `decline_reason varchar(32) null`
- `linkedin_url varchar(512) null`
- `crawled_at timestamp with time zone null`
- `named_at timestamp with time zone null`
- `lead_at timestamp with time zone null`
- `headcount text null`

References:

- public.imports (import_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_companies ON public.companies USING btree (id)`
- `CREATE UNIQUE INDEX uq_companies_domain ON public.companies USING btree (domain)`
- `CREATE UNIQUE INDEX uq_companies_source_key ON public.companies USING btree (source_key)`
- `CREATE INDEX ix_companies_import_id ON public.companies USING btree (import_id)`
- `CREATE INDEX ix_companies_unassigned ON public.companies USING btree (id) WHERE (niche IS NULL)`
- `CREATE INDEX ix_companies_firm_records ON public.companies USING btree (id, niche, decline_reason, domain, created_at, name, crawled_at, named_at, lead_at) WHERE (niche IS NOT NULL)`

## public.import_errors (table)

- `id integer = nextval('import_errors_id_seq'::regclass)`
- `import_id integer`
- `row_number integer`
- `kind varchar(32)`
- `reason text`
- `raw jsonb null`
- `company_id integer null`
- `claimant_company_id integer null`

References:

- public.companies (claimant_company_id → id; company_id → id)
- public.imports (import_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_import_errors ON public.import_errors USING btree (id)`
- `CREATE INDEX ix_import_errors_import_id ON public.import_errors USING btree (import_id)`
- `CREATE INDEX ix_import_errors_company_id ON public.import_errors USING btree (company_id)`
- `CREATE INDEX ix_import_errors_claimant_company_id ON public.import_errors USING btree (claimant_company_id)`

## public.imports (table)

- `id integer = nextval('imports_id_seq'::regclass)`
- `source_type varchar(32)`
- `source_ref text`
- `stats jsonb`
- `imported_at timestamp with time zone = now()`
- `content_hash varchar(64) null`
- `as_of date null`
- `superseded_by integer null`
- `defaults jsonb null`

References:

- public.imports (superseded_by → id)

Indexes:

- `CREATE UNIQUE INDEX pk_imports ON public.imports USING btree (id)`
- `CREATE INDEX ix_imports_superseded_by ON public.imports USING btree (superseded_by)`

## public.leads (table)

- `id integer = nextval('leads_id_seq'::regclass)`
- `email varchar(320)`
- `first_name varchar null`
- `last_name varchar null`
- `title varchar null`
- `persona varchar(64) null`
- `source varchar(64) null`
- `geo varchar(64) null`
- `status varchar(32)`
- `raw jsonb`
- `company_id integer null`
- `import_id integer`
- `created_at timestamp with time zone = now()`
- `country varchar(2) null`
- `suppression_id integer null`
- `social_url varchar(512) null`
- `person_id integer null`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)
- public.people (person_id → id)
- public.suppressions (suppression_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_leads ON public.leads USING btree (id)`
- `CREATE UNIQUE INDEX uq_leads_email ON public.leads USING btree (email)`
- `CREATE INDEX ix_leads_suppression_id ON public.leads USING btree (suppression_id)`
- `CREATE INDEX ix_leads_import_id ON public.leads USING btree (import_id)`
- `CREATE INDEX ix_leads_company_id ON public.leads USING btree (company_id)`
- `CREATE INDEX ix_leads_company_verified ON public.leads USING btree (company_id, created_at) WHERE (((status)::text = 'verified'::text) AND (first_name IS NOT NULL))`
- `CREATE INDEX ix_leads_person_id ON public.leads USING btree (person_id)`

## public.people (table)

- `id integer = nextval('people_id_seq'::regclass)`
- `source_key varchar(64) null`
- `company_id integer`
- `full_name text`
- `first_name varchar null`
- `last_name varchar null`
- `title text null`
- `is_compliance boolean`
- `origin varchar(32)`
- `origin_ref text`
- `as_of date null`
- `linkedin_url varchar(512) null`
- `notes text null`
- `import_id integer null`
- `raw jsonb`
- `created_at timestamp with time zone = now()`
- `is_testimonial boolean = false`
- `testimonial_org text null`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_people ON public.people USING btree (id)`
- `CREATE UNIQUE INDEX uq_people_source_key ON public.people USING btree (source_key)`
- `CREATE INDEX ix_people_import_id ON public.people USING btree (import_id)`
- `CREATE INDEX ix_people_company_created ON public.people USING btree (company_id, created_at)`

## public.runs (table)

- `id uuid`
- `command varchar(64)`
- `argv jsonb`
- `niche varchar(64) null`
- `model varchar(64) null`
- `started_at timestamp with time zone = now()`
- `finished_at timestamp with time zone null`
- `stats jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_runs ON public.runs USING btree (id)`

## public.sightings (table)

- `id integer = nextval('sightings_id_seq'::regclass)`
- `company_id integer null`
- `lead_id integer null`
- `import_id integer`
- `row_number integer`
- `raw jsonb`
- `seen_at timestamp with time zone = now()`
- `person_id integer null`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)
- public.leads (lead_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_sightings ON public.sightings USING btree (id)`
- `CREATE INDEX ix_sightings_company_id ON public.sightings USING btree (company_id)`
- `CREATE INDEX ix_sightings_lead_id ON public.sightings USING btree (lead_id)`
- `CREATE INDEX ix_sightings_person_id ON public.sightings USING btree (person_id)`
- `CREATE INDEX ix_sightings_import_id ON public.sightings USING btree (import_id)`

## public.suppression_events (table)

- `id integer = nextval('suppression_events_id_seq'::regclass)`
- `suppression_id integer`
- `reason varchar(32)`
- `evidence jsonb null`
- `created_at timestamp with time zone = now()`

References:

- public.suppressions (suppression_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_suppression_events ON public.suppression_events USING btree (id)`
- `CREATE INDEX ix_suppression_events_suppression_id ON public.suppression_events USING btree (suppression_id)`

## public.suppressions (table)

- `id integer = nextval('suppressions_id_seq'::regclass)`
- `kind varchar(32)`
- `value varchar(320)`
- `reason varchar(32)`
- `created_at timestamp with time zone = now()`
- `revoked_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_suppressions ON public.suppressions USING btree (id)`
- `CREATE UNIQUE INDEX uq_suppressions_kind ON public.suppressions USING btree (kind, value)`

## public.documents (table)

- `id integer = nextval('documents_id_seq'::regclass)`
- `company_id integer null`
- `url text`
- `final_url text null`
- `kind varchar(32)`
- `status_code integer null`
- `content_hash varchar(64)`
- `title text null`
- `text text`
- `fetched_at timestamp with time zone = now()`
- `html text null`
- `fetch_tier varchar(16) = 'httpx'::character varying`
- `is_shell boolean = false`
- `robots_disallowed boolean = false`
- `html_key text null`
- `tel_hrefs text[] null`
- `block_reason text null`
- `fetch_steps jsonb null`

References:

- public.companies (company_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_documents ON public.documents USING btree (id)`
- `CREATE UNIQUE INDEX uq_documents_url ON public.documents USING btree (url, content_hash)`
- `CREATE INDEX ix_documents_company_fetched ON public.documents USING btree (company_id, fetched_at)`

## public.enrichments (table)

- `id integer = nextval('enrichments_id_seq'::regclass)`
- `document_id integer null`
- `kind varchar(32)`
- `model varchar(64)`
- `prompt_version varchar(16)`
- `output jsonb`
- `applied_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `company_id integer null`
- `run_id uuid null`

References:

- public.companies (company_id → id)
- public.runs (run_id → id)
- public.documents (document_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_enrichments ON public.enrichments USING btree (id)`
- `CREATE UNIQUE INDEX uq_enrichments_document_id ON public.enrichments USING btree (document_id, kind, model, prompt_version)`
- `CREATE UNIQUE INDEX uq_enrichments_company_id ON public.enrichments USING btree (company_id, kind, model, prompt_version)`
- `CREATE INDEX ix_enrichments_run_id ON public.enrichments USING btree (run_id)`

## public.contact_candidates (table)

- `id integer = nextval('contact_candidates_id_seq'::regclass)`
- `person_id integer`
- `email varchar(320)`
- `domain varchar(255)`
- `evidence varchar(32)`
- `pattern varchar(32) null`
- `rank integer`
- `state varchar(32)`
- `source_ref text`
- `lead_id integer null`
- `created_at timestamp with time zone = now()`

References:

- public.leads (lead_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_contact_candidates ON public.contact_candidates USING btree (id)`
- `CREATE UNIQUE INDEX uq_contact_candidates_person_id ON public.contact_candidates USING btree (person_id, email)`
- `CREATE INDEX ix_contact_candidates_domain ON public.contact_candidates USING btree (domain)`
- `CREATE INDEX ix_contact_candidates_lead_id ON public.contact_candidates USING btree (lead_id)`

## public.enrollments (table)

- `id integer = nextval('enrollments_id_seq'::regclass)`
- `person_id integer null`
- `niche varchar(32)`
- `sequence_name varchar(64)`
- `sequence_snapshot jsonb`
- `state varchar(32)`
- `stop_reason varchar(32) null`
- `stopped_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `company_id integer`
- `kind varchar(32)`
- `to_email varchar(320)`
- `sender varchar(320)`
- `run_id uuid null`
- `offer varchar(64)`
- `contact_round integer = 1`
- `away_until date null`
- `lead_id integer null`
- `candidate_id integer null`

References:

- public.companies (company_id → id)
- public.leads (lead_id → id)
- public.people (person_id → id)
- public.runs (run_id → id)
- public.contact_candidates (candidate_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_enrollments ON public.enrollments USING btree (id)`
- `CREATE INDEX ix_enrollments_company_id ON public.enrollments USING btree (company_id)`
- `CREATE INDEX ix_enrollments_person_id ON public.enrollments USING btree (person_id)`
- `CREATE INDEX ix_enrollments_run_id ON public.enrollments USING btree (run_id)`
- `CREATE UNIQUE INDEX uq_enrollments_active_address ON public.enrollments USING btree (lower((to_email)::text)) WHERE ((state)::text = 'active'::text)`
- `CREATE UNIQUE INDEX uq_enrollments_active_company ON public.enrollments USING btree (company_id) WHERE ((state)::text = 'active'::text)`
- `CREATE UNIQUE INDEX uq_enrollments_active_person ON public.enrollments USING btree (person_id) WHERE ((state)::text = 'active'::text)`
- `CREATE INDEX ix_enrollments_offer ON public.enrollments USING btree (offer)`
- `CREATE INDEX ix_enrollments_lead_id ON public.enrollments USING btree (lead_id)`
- `CREATE INDEX ix_enrollments_candidate_id ON public.enrollments USING btree (candidate_id)`
- `CREATE INDEX ix_enrollments_to_email ON public.enrollments USING btree (lower((to_email)::text))`

## public.inbox_syncs (table)

- `sender varchar(320)`
- `cursor_ms bigint = 0`
- `synced_at timestamp with time zone null`
- `stats jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_inbox_syncs ON public.inbox_syncs USING btree (sender)`

## public.messages (table)

- `id integer = nextval('messages_id_seq'::regclass)`
- `enrollment_id integer`
- `step integer`
- `template varchar(64)`
- `template_version varchar(12)`
- `to_email varchar(320)`
- `subject text null`
- `body text`
- `provenance jsonb`
- `state varchar(32)`
- `message_id varchar(255) null`
- `detail text null`
- `approved_at timestamp with time zone null`
- `sent_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `gmail_id varchar(64) null`
- `thread_id varchar(64) null`
- `attempted_at timestamp with time zone null`
- `transport varchar(32) null`
- `run_id uuid null`
- `sent_run_id uuid null`
- `review_reason varchar(32) null`
- `edited_at timestamp with time zone null`
- `open_token varchar(64) null`
- `approved_by varchar(32) null`
- `link_code varchar(40) null`
- `offered_times jsonb null`
- `held boolean = false`
- `released_at timestamp with time zone null`

References:

- public.runs (run_id → id; sent_run_id → id)
- public.enrollments (enrollment_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_messages ON public.messages USING btree (id)`
- `CREATE UNIQUE INDEX uq_messages_enrollment_id ON public.messages USING btree (enrollment_id, step)`
- `CREATE UNIQUE INDEX uq_messages_open_token ON public.messages USING btree (open_token)`
- `CREATE INDEX ix_messages_run_id ON public.messages USING btree (run_id)`
- `CREATE INDEX ix_messages_sent_run_id ON public.messages USING btree (sent_run_id)`
- `CREATE UNIQUE INDEX uq_messages_link_code ON public.messages USING btree (link_code)`

## public.open_events (table)

- `id integer = nextval('open_events_id_seq'::regclass)`
- `message_id integer`
- `remote_id bigint`
- `seen_at timestamp with time zone`
- `user_agent text null`
- `synced_at timestamp with time zone = now()`
- `run_id uuid null`

References:

- public.runs (run_id → id)
- public.messages (message_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_open_events ON public.open_events USING btree (id)`
- `CREATE UNIQUE INDEX uq_open_events_remote_id ON public.open_events USING btree (remote_id)`
- `CREATE INDEX ix_open_events_message_id ON public.open_events USING btree (message_id)`
- `CREATE INDEX ix_open_events_run_id ON public.open_events USING btree (run_id)`
- `CREATE INDEX ix_open_events_seen_at ON public.open_events USING btree (seen_at)`

## public.open_syncs (table)

- `base_url varchar(255)`
- `cursor_id bigint = 0`
- `synced_at timestamp with time zone null`
- `stats jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_open_syncs ON public.open_syncs USING btree (base_url)`

## public.postmaster_days (table)

- `domain varchar(253)`
- `day date`
- `spam_rate double precision null`
- `domain_reputation varchar(32) null`
- `spf_success_ratio double precision null`
- `dkim_success_ratio double precision null`
- `dmarc_success_ratio double precision null`
- `raw jsonb`
- `synced_at timestamp with time zone = now()`
- `run_id uuid null`
- `delivery_error_rate double precision null`
- `tls_outbound_count bigint null`
- `tls_inbound_count bigint null`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_postmaster_days ON public.postmaster_days USING btree (domain, day)`
- `CREATE INDEX ix_postmaster_days_run_id ON public.postmaster_days USING btree (run_id)`

## public.sender_pauses (table)

- `id integer = nextval('sender_pauses_id_seq'::regclass)`
- `sender varchar(320)`
- `domain varchar(255)`
- `reason text`
- `source varchar(32)`
- `paused_at timestamp with time zone = now()`
- `lifted_at timestamp with time zone null`
- `lifted_by varchar(64) null`
- `detail jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_sender_pauses ON public.sender_pauses USING btree (id)`
- `CREATE INDEX ix_sender_pauses_sender ON public.sender_pauses USING btree (sender)`
- `CREATE UNIQUE INDEX uq_sender_pauses_active ON public.sender_pauses USING btree (sender) WHERE (lifted_at IS NULL)`

## public.template_versions (table)

- `id integer = nextval('template_versions_id_seq'::regclass)`
- `niche varchar(32)`
- `template varchar(64)`
- `version varchar(12)`
- `source text`
- `created_at timestamp with time zone = now()`
- `template_id integer`
- `created_by varchar(200) null`
- `published_at timestamp with time zone null`
- `published_by varchar(200) null`
- `number integer`
- `origin varchar(16) = 'edit'::character varying`
- `why text null`
- `opened_from integer null`
- `default_hash varchar(64) null`

References:

- public.template_versions (opened_from → id)
- public.templates (template_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_template_versions ON public.template_versions USING btree (id)`
- `CREATE INDEX ix_template_versions_niche ON public.template_versions USING btree (niche, template, version)`
- `CREATE UNIQUE INDEX uq_template_versions_template_id_number ON public.template_versions USING btree (template_id, number)`
- `CREATE INDEX ix_template_versions_opened_from ON public.template_versions USING btree (opened_from) WHERE (opened_from IS NOT NULL)`

## public.thread_events (table)

- `id integer = nextval('thread_events_id_seq'::regclass)`
- `enrollment_id integer`
- `in_reply_to_message_id integer null`
- `kind varchar(32)`
- `bounce_class varchar(32) null`
- `disposition varchar(32) null`
- `disposition_source varchar(32) null`
- `classified_at timestamp with time zone null`
- `gmail_id varchar(64) null`
- `gmail_thread_id varchar(64) null`
- `from_address varchar(320) null`
- `subject text null`
- `snippet text null`
- `headers jsonb null`
- `detail text null`
- `received_at timestamp with time zone`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`
- `body_text text null`
- `classification jsonb null`

References:

- public.runs (run_id → id)
- public.enrollments (enrollment_id → id)
- public.messages (in_reply_to_message_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_thread_events ON public.thread_events USING btree (id)`
- `CREATE INDEX ix_thread_events_enrollment_id ON public.thread_events USING btree (enrollment_id)`
- `CREATE INDEX ix_thread_events_run_id ON public.thread_events USING btree (run_id)`
- `CREATE UNIQUE INDEX uq_thread_events_gmail_id ON public.thread_events USING btree (gmail_id) WHERE (gmail_id IS NOT NULL)`
- `CREATE INDEX ix_thread_events_in_reply_to_message_id ON public.thread_events USING btree (in_reply_to_message_id)`

## public.verifications (table)

- `id integer = nextval('verifications_id_seq'::regclass)`
- `lead_id integer null`
- `verifier varchar(64)`
- `result varchar(32)`
- `raw jsonb`
- `checked_at timestamp with time zone = now()`
- `email varchar(320)`
- `contact_candidate_id integer null`

References:

- public.leads (lead_id → id)
- public.contact_candidates (contact_candidate_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_verifications ON public.verifications USING btree (id)`
- `CREATE INDEX ix_verifications_contact_candidate_id ON public.verifications USING btree (contact_candidate_id)`
- `CREATE INDEX ix_verifications_lead_id ON public.verifications USING btree (lead_id)`
- `CREATE INDEX ix_verifications_email_domain ON public.verifications USING btree (split_part((email)::text, '@'::text, 2))`
- `CREATE INDEX ix_verifications_email_checked_at_id ON public.verifications USING btree (email, checked_at DESC NULLS LAST, id DESC NULLS LAST)`

## public.agency_facts (view)

- `company_id integer null`
- `source_key varchar(64) null`
- `domain varchar(255) null`
- `name varchar null`
- `country varchar(2) null`
- `employees integer null`
- `min_budget_usd bigint null`
- `hourly_rate_usd integer null`
- `founded_year integer null`
- `rating numeric null`
- `services text null`
- `industries text null`
- `last_seen_at timestamp with time zone null`
- `segment text null`

## public.firm_facts (view)

- `company_id integer null`
- `source_key varchar(64) null`
- `domain varchar(255) null`
- `name varchar null`
- `country varchar(2) null`
- `aum_usd bigint null`
- `employees integer null`
- `ind_clients integer null`
- `hnw_clients integer null`
- `pooled_clients integer null`
- `country_raw text null`
- `last_seen_at timestamp with time zone null`
- `segment text null`

## public.campaign_funnel (view)

- `niche varchar(32) null`
- `sequence_name varchar(64) null`
- `enrollment_kind varchar(32) null`
- `enrolled bigint null`
- `active bigint null`
- `finished bigint null`
- `stopped_reply bigint null`
- `stopped_bounce bigint null`
- `stopped_opt_out bigint null`
- `stopped_complaint bigint null`
- `stopped_manual bigint null`
- `openers_sent numeric null`
- `followups_sent numeric null`
- `replies numeric null`
- `interested numeric null`
- `auto_replies numeric null`
- `hard_bounces numeric null`
- `unsubscribes numeric null`
- `recycled boolean null`

## public.email_llm_calls (view)

- `enrichment_id integer null`
- `thread_event_id integer null`
- `run_id uuid null`
- `kind text null`
- `model text null`
- `provider text null`
- `prompt_version text null`
- `company_id integer null`
- `document_id integer null`
- `input_tokens integer null`
- `output_tokens integer null`
- `total_tokens integer null`
- `reasoning_tokens integer null`
- `latency_ms integer null`
- `finish_reason text null`
- `rejected boolean null`
- `parse_failed boolean null`
- `has_call_record boolean null`
- `applied_at timestamp with time zone null`
- `created_at timestamp with time zone null`

## public.email_stage_costs (view)

- `run_id uuid null`
- `command varchar(64) null`
- `niche varchar(64) null`
- `kind text null`
- `model text null`
- `provider text null`
- `calls bigint null`
- `rejected_calls bigint null`
- `parse_failures bigint null`
- `input_tokens bigint null`
- `output_tokens bigint null`
- `total_tokens bigint null`
- `reasoning_tokens bigint null`
- `avg_latency_ms integer null`
- `max_latency_ms integer null`
- `first_call_at timestamp with time zone null`
- `last_call_at timestamp with time zone null`

## public.enrollment_outcomes (view)

- `enrollment_id integer null`
- `niche varchar(32) null`
- `sequence_name varchar(64) null`
- `enrollment_kind varchar(32) null`
- `company_id integer null`
- `person_id integer null`
- `to_email varchar(320) null`
- `sender varchar(320) null`
- `state varchar(32) null`
- `stop_reason varchar(32) null`
- `enrolled_at timestamp with time zone null`
- `opener_template varchar(64) null`
- `opener_template_version varchar(12) null`
- `opener_state varchar(32) null`
- `evidence text null`
- `verification_result text null`
- `pick_method text null`
- `lead_id integer null`
- `candidate_id integer null`
- `source_document_id integer null`
- `source_url text null`
- `steps_sent bigint null`
- `first_sent_at timestamp with time zone null`
- `last_sent_at timestamp with time zone null`
- `replies bigint null`
- `replied boolean null`
- `interested boolean null`
- `disposition varchar null`
- `hard_bounced boolean null`
- `soft_bounced boolean null`
- `unsubscribed boolean null`
- `complained boolean null`
- `auto_replied boolean null`
- `first_reply_at timestamp with time zone null`
- `contact_round integer null`
- `offer varchar(64) null`
- `last_touch_at timestamp with time zone null`
- `outcome text null`

## public.funnel_latency (view)

- `company_id integer null`
- `niche varchar(32) null`
- `domain varchar(255) null`
- `imported_at timestamp with time zone null`
- `first_fetch_at timestamp with time zone null`
- `enrolled_at timestamp with time zone null`
- `first_send_at timestamp with time zone null`
- `first_reply_at timestamp with time zone null`
- `days_import_to_fetch numeric null`
- `days_import_to_enroll numeric null`
- `days_enroll_to_send numeric null`
- `days_import_to_send numeric null`
- `days_send_to_reply numeric null`

## public.open_outcomes (view)

- `niche varchar(32) null`
- `sequence_name varchar(64) null`
- `step integer null`
- `template varchar(64) null`
- `tracked_sent bigint null`
- `opened_raw bigint null`
- `opened_human_plausible bigint null`
- `fetches numeric null`
- `open_rate_raw numeric null`
- `open_rate_human_plausible numeric null`

## public.rejections_by_reason (view)

- `niche varchar(32) null`
- `template varchar(64) null`
- `template_version varchar(12) null`
- `reason varchar null`
- `rejected bigint null`

## public.reply_by_arm_step (view)

- `niche varchar(32) null`
- `arm varchar null`
- `step integer null`
- `template varchar(64) null`
- `template_version varchar(12) null`
- `sent bigint null`
- `replies bigint null`
- `interested bigint null`
- `hard_bounces bigint null`
- `reply_rate_pct numeric null`

## public.reply_by_evidence (view)

- `niche varchar(32) null`
- `enrollment_kind varchar(32) null`
- `evidence text null`
- `verification_result text null`
- `pick_method text null`
- `enrolled bigint null`
- `opened bigint null`
- `replied bigint null`
- `interested bigint null`
- `hard_bounced bigint null`
- `unsubscribed bigint null`
- `reply_rate_pct numeric null`
- `bounce_rate_pct numeric null`

## public.reply_outcomes (view)

- `event_id integer null`
- `enrollment_id integer null`
- `niche varchar(32) null`
- `sequence_name varchar(64) null`
- `enrollment_kind varchar(32) null`
- `sender varchar(320) null`
- `company_id integer null`
- `to_email varchar(320) null`
- `kind varchar(32) null`
- `bounce_class varchar(32) null`
- `disposition varchar(32) null`
- `disposition_source varchar(32) null`
- `received_at timestamp with time zone null`
- `replied_to_step integer null`
- `replied_to_template varchar(64) null`
- `replied_to_template_version varchar(12) null`

## public.review_outcomes (view)

- `niche varchar(32) null`
- `template varchar(64) null`
- `template_version varchar(12) null`
- `drafted bigint null`
- `awaiting bigint null`
- `edited bigint null`
- `approved bigint null`
- `auto_approved bigint null`
- `rejected bigint null`
- `sent bigint null`
- `reviewed bigint null`
- `edit_rate_pct numeric null`
- `reject_rate_pct numeric null`

## public.send_health (view)

- `sender varchar(320) null`
- `domain text null`
- `day date null`
- `sent bigint null`
- `hard_bounces bigint null`
- `soft_bounces bigint null`
- `replies bigint null`
- `auto_replies bigint null`
- `unsubscribes bigint null`
- `complaints bigint null`
- `bounce_rate numeric null`

## public.verification_yield (view)

- `niche varchar(32) null`
- `evidence varchar(32) null`
- `candidates bigint null`
- `verified bigint null`
- `valid bigint null`
- `invalid bigint null`
- `risky bigint null`
- `catch_all bigint null`
- `valid_rate_pct numeric null`

## public.reports (table)

- `id integer = nextval('reports_id_seq'::regclass)`
- `kind varchar(32)`
- `period_start timestamp with time zone`
- `period_end timestamp with time zone`
- `stats jsonb`
- `body text`
- `sent_to varchar(320) null`
- `created_at timestamp with time zone = now()`
- `run_id uuid null`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_reports ON public.reports USING btree (id)`
- `CREATE INDEX ix_reports_kind_period_end ON public.reports USING btree (kind, period_end)`
- `CREATE INDEX ix_reports_run_id ON public.reports USING btree (run_id)`

## public.discovery_attempts (table)

- `id integer = nextval('discovery_attempts_id_seq'::regclass)`
- `company_id integer`
- `kind varchar(16)`
- `outcome varchar(32)`
- `import_id integer null`
- `attempted_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_discovery_attempts ON public.discovery_attempts USING btree (id)`
- `CREATE INDEX ix_discovery_attempts_company_kind ON public.discovery_attempts USING btree (company_id, kind, attempted_at)`
- `CREATE INDEX ix_discovery_attempts_import_id ON public.discovery_attempts USING btree (import_id)`

## public.content_drafts (table)

- `id uuid = gen_random_uuid()`
- `created_at timestamp with time zone = now()`
- `idea_id uuid`
- `platform varchar(16)`
- `text text`
- `title varchar(2000) null`
- `media jsonb null`
- `extra jsonb = '{}'::jsonb`
- `status varchar(16) = 'draft'::character varying`
- `edited boolean = false`
- `scheduled_for timestamp with time zone null`
- `approved_at timestamp with time zone null`
- `published_at timestamp with time zone null`
- `published_id varchar(255) null`
- `url varchar(2048) null`
- `error text null`
- `prompt_version varchar(16)`
- `llm jsonb null`
- `redraft_of uuid null`
- `note text null`
- `playbook_id uuid null`
- `stage varchar(16) = 'reach'::character varying`
- `points_to varchar(16) = 'site'::character varying`
- `video_draft uuid null`
- `linked boolean null`
- `site_page uuid null`
- `check jsonb null`

References:

- public.content_drafts (redraft_of → id; video_draft → id)
- public.content_ideas (idea_id → id)
- public.content_playbooks (playbook_id → id)
- public.platform_objects (platform → platform, published_id → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_content_drafts ON public.content_drafts USING btree (id)`
- `CREATE INDEX ix_content_drafts_idea_id ON public.content_drafts USING btree (idea_id)`
- `CREATE INDEX ix_content_drafts_status_scheduled_for ON public.content_drafts USING btree (status, scheduled_for)`
- `CREATE INDEX ix_content_drafts_platform_created_at ON public.content_drafts USING btree (platform, created_at)`
- `CREATE INDEX ix_content_drafts_redraft_of ON public.content_drafts USING btree (redraft_of)`
- `CREATE INDEX ix_content_drafts_playbook_id ON public.content_drafts USING btree (playbook_id)`
- `CREATE INDEX ix_content_drafts_video_draft ON public.content_drafts USING btree (video_draft)`
- `CREATE INDEX ix_content_drafts_platform_published_id ON public.content_drafts USING btree (platform, published_id)`

## public.content_ideas (table)

- `id uuid = gen_random_uuid()`
- `created_at timestamp with time zone = now()`
- `text text`
- `media jsonb null`
- `source varchar(16)`
- `status varchar(16) = 'open'::character varying`
- `ref varchar(200) null`
- `line varchar(64) null`
- `angle varchar(16) null`

Indexes:

- `CREATE UNIQUE INDEX pk_content_ideas ON public.content_ideas USING btree (id)`
- `CREATE INDEX ix_content_ideas_status_created_at ON public.content_ideas USING btree (status, created_at)`
- `CREATE UNIQUE INDEX uq_content_ideas_ref ON public.content_ideas USING btree (ref)`

## public.content_metrics (table)

- `id uuid = gen_random_uuid()`
- `created_at timestamp with time zone = now()`
- `draft_id uuid`
- `as_of timestamp with time zone`
- `views integer`
- `reactions integer`
- `comments integer`
- `shares integer`
- `fetched_with varchar(16)`
- `follows integer null`

References:

- public.content_drafts (draft_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_content_metrics ON public.content_metrics USING btree (id)`
- `CREATE INDEX ix_content_metrics_draft_id_created_at ON public.content_metrics USING btree (draft_id, created_at)`

## public.ad_launches (table)

- `id uuid = gen_random_uuid()`
- `created_at timestamp with time zone = now()`
- `name varchar(200)`
- `ad_account_id varchar(32)`
- `campaign_id varchar(32)`
- `adset_id varchar(32)`
- `creative_id varchar(32)`
- `ad_id varchar(32)`
- `spec jsonb`
- `status varchar(16) = 'paused'::character varying`
- `daily_budget_usd real`
- `started_at timestamp with time zone null`
- `stopped_at timestamp with time zone null`
- `stop_reason varchar(3000) null`

Indexes:

- `CREATE UNIQUE INDEX pk_ad_launches ON public.ad_launches USING btree (id)`
- `CREATE INDEX ix_ad_launches_status ON public.ad_launches USING btree (status)`
- `CREATE INDEX ix_ad_launches_campaign_id ON public.ad_launches USING btree (campaign_id)`

## public.sms_contacts (table)

- `id integer = nextval('sms_contacts_id_seq'::regclass)`
- `e164 varchar(16)`
- `company_id integer null`
- `person_id integer null`
- `source_document_id integer null`
- `source_url text null`
- `source_kind varchar(16)`
- `basis varchar(16)`
- `basis_detail text null`
- `line_type varchar(16) = 'unknown'::character varying`
- `carrier varchar(128) null`
- `looked_up_at timestamp with time zone null`
- `lookup jsonb null`
- `number_id uuid null`
- `state varchar(16) = 'new'::character varying`
- `state_reason text null`
- `niche varchar(32) null`
- `sequence varchar(64) null`
- `enrolled_at timestamp with time zone null`
- `ended_at timestamp with time zone null`
- `read_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `source_ref varchar(64) null`
- `name text null`
- `email text null`
- `zone varchar(64) null`
- `paid_cents integer null`
- `paid_at timestamp with time zone null`
- `imessage boolean null`
- `booking_link text null`

References:

- public.companies (company_id → id)
- public.people (person_id → id)
- public.documents (source_document_id → id)
- public.sms_numbers (number_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_sms_contacts ON public.sms_contacts USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_contacts_e164_company ON public.sms_contacts USING btree (e164, company_id)`
- `CREATE UNIQUE INDEX uq_sms_contacts_enrolled_e164 ON public.sms_contacts USING btree (e164) WHERE ((state)::text = 'enrolled'::text)`
- `CREATE INDEX ix_sms_contacts_company_id ON public.sms_contacts USING btree (company_id)`
- `CREATE INDEX ix_sms_contacts_state ON public.sms_contacts USING btree (state)`
- `CREATE UNIQUE INDEX uq_sms_contacts_source_ref ON public.sms_contacts USING btree (source_kind, source_ref)`
- `CREATE INDEX ix_sms_contacts_person_id ON public.sms_contacts USING btree (person_id)`
- `CREATE INDEX ix_sms_contacts_number_id ON public.sms_contacts USING btree (number_id)`
- `CREATE INDEX ix_sms_contacts_source_document_id ON public.sms_contacts USING btree (source_document_id)`

## public.sms_events (table)

- `id integer = nextval('sms_events_id_seq'::regclass)`
- `provider varchar(16)`
- `provider_event_id varchar(64)`
- `type varchar(64)`
- `payload jsonb`
- `received_at timestamp with time zone = now()`
- `outcome text null`

Indexes:

- `CREATE UNIQUE INDEX pk_sms_events ON public.sms_events USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_events_provider_event ON public.sms_events USING btree (provider, provider_event_id)`

## public.sms_messages (table)

- `id integer = nextval('sms_messages_id_seq'::regclass)`
- `contact_id integer`
- `direction varchar(4)`
- `kind varchar(16)`
- `step smallint null`
- `template varchar(64) null`
- `number_id uuid null`
- `from_e164 varchar(16) null`
- `to_e164 varchar(16)`
- `body text`
- `state varchar(16)`
- `provider_id varchar(64) null`
- `parts smallint null`
- `cost_usd double precision null`
- `error_code varchar(32) null`
- `detail text null`
- `due_at timestamp with time zone null`
- `attempted_at timestamp with time zone null`
- `sent_at timestamp with time zone null`
- `delivered_at timestamp with time zone null`
- `received_at timestamp with time zone null`
- `disposition varchar(16) null`
- `disposition_source varchar(16) null`
- `classification jsonb null`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`
- `ref varchar(64) null`
- `template_version varchar(12) null`
- `provenance jsonb null`
- `service varchar(8) null`

References:

- public.runs (run_id → id)
- public.sms_contacts (contact_id → id)
- public.sms_numbers (number_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_sms_messages ON public.sms_messages USING btree (id)`
- `CREATE INDEX ix_sms_messages_contact_id ON public.sms_messages USING btree (contact_id)`
- `CREATE INDEX ix_sms_messages_state_due ON public.sms_messages USING btree (state, due_at)`
- `CREATE INDEX ix_sms_messages_number_attempted ON public.sms_messages USING btree (number_id, attempted_at)`
- `CREATE UNIQUE INDEX uq_sms_messages_provider_id ON public.sms_messages USING btree (provider_id)`
- `CREATE UNIQUE INDEX uq_sms_messages_contact_step ON public.sms_messages USING btree (contact_id, step) WHERE ((kind)::text = 'sequence'::text)`
- `CREATE UNIQUE INDEX uq_sms_messages_reminder_ref ON public.sms_messages USING btree (template, ref) WHERE ((kind)::text = 'reminder'::text)`
- `CREATE INDEX ix_sms_messages_run_id ON public.sms_messages USING btree (run_id)`
- `CREATE UNIQUE INDEX uq_sms_messages_follow_up_ref ON public.sms_messages USING btree (contact_id, ref) WHERE ((kind)::text = 'follow_up'::text)`
- `CREATE UNIQUE INDEX uq_sms_messages_answer_ref ON public.sms_messages USING btree (contact_id, ref) WHERE ((kind)::text = ANY (ARRAY['text_back'::text, 'review'::text]))`
- `CREATE UNIQUE INDEX uq_sms_messages_broadcast_ref ON public.sms_messages USING btree (contact_id, ref) WHERE ((kind)::text = 'broadcast'::text)`
- `CREATE INDEX ix_sms_messages_in ON public.sms_messages USING btree (contact_id, received_at DESC NULLS LAST) WHERE ((direction)::text = 'in'::text)`

## public.sms_numbers (table)

- `id uuid = gen_random_uuid()`
- `created_at timestamp with time zone = now()`
- `e164 varchar(16)`
- `provider varchar(16)`
- `provider_id varchar(64) null`
- `state varchar(16) = 'active'::character varying`
- `paused_reason text null`
- `paused_at timestamp with time zone null`
- `ramp_started_on date`
- `retired_at timestamp with time zone null`
- `country varchar(2) = 'US'::character varying`
- `registered_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_sms_numbers ON public.sms_numbers USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_numbers_e164 ON public.sms_numbers USING btree (e164)`

## public.clients (table)

- `id varchar(40)`
- `name text`
- `database varchar(63)`
- `accounts jsonb = '{}'::jsonb`
- `demo boolean = false`
- `created_at timestamp with time zone = now()`
- `products jsonb = '{}'::jsonb`
- `look jsonb null`
- `setup_mode varchar(8) = 'self'::character varying`
- `buys_ok boolean = false`
- `approver varchar(8) = 'wren'::character varying`
- `sends text[] = '{}'::text[]`
- `sandbox boolean = false`

Indexes:

- `CREATE UNIQUE INDEX pk_clients ON public.clients USING btree (id)`
- `CREATE UNIQUE INDEX uq_clients_database ON public.clients USING btree (database)`

## public.crm_contacts (table)

- `id integer = nextval('crm_contacts_id_seq'::regclass)`
- `person_id integer`
- `company_id integer`
- `import_id integer`
- `row_number integer`
- `format varchar(32)`
- `crm_key varchar(128)`
- `email varchar(320) null`
- `phone varchar(64) null`
- `owner text null`
- `status text null`
- `last_contacted_on date null`
- `last_placement_on date null`
- `added_on date null`
- `raw jsonb`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_crm_contacts ON public.crm_contacts USING btree (id)`
- `CREATE UNIQUE INDEX uq_crm_contacts_key ON public.crm_contacts USING btree (format, crm_key)`
- `CREATE INDEX ix_crm_contacts_person_id ON public.crm_contacts USING btree (person_id)`
- `CREATE INDEX ix_crm_contacts_import_id ON public.crm_contacts USING btree (import_id)`
- `CREATE INDEX ix_crm_contacts_company_id ON public.crm_contacts USING btree (company_id)`

## public.findings (table)

- `id integer = nextval('findings_id_seq'::regclass)`
- `kind varchar(32)`
- `person_id integer null`
- `company_id integer null`
- `fact_key varchar(400)`
- `value jsonb`
- `document_id integer null`
- `source_url text null`
- `confidence real`
- `via varchar(64)`
- `observed_at timestamp with time zone = now()`
- `created_at timestamp with time zone = now()`
- `signal_at timestamp with time zone null`
- `signal_dated varchar(12) null`
- `question varchar(80) null`
- `proof jsonb null`
- `by varchar(8) null`

References:

- public.companies (company_id → id)
- public.people (person_id → id)
- public.documents (document_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_findings ON public.findings USING btree (id)`
- `CREATE UNIQUE INDEX uq_findings_fact_key ON public.findings USING btree (fact_key)`
- `CREATE INDEX ix_findings_person_id ON public.findings USING btree (person_id)`
- `CREATE INDEX ix_findings_company_id ON public.findings USING btree (company_id)`
- `CREATE INDEX ix_findings_document_id ON public.findings USING btree (document_id)`
- `CREATE INDEX ix_findings_signal_at ON public.findings USING btree (signal_at) WHERE (signal_at IS NOT NULL)`

## public.person_lookups (table)

- `person_id integer`
- `state varchar(16)`
- `tried jsonb`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `looked_up_at timestamp with time zone = now()`

References:

- public.people (person_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_person_lookups ON public.person_lookups USING btree (person_id)`
- `CREATE INDEX ix_person_lookups_run_id ON public.person_lookups USING btree (run_id)`

## public.company_checks (table)

- `company_id integer`
- `state varchar(16)`
- `finding_id integer null`
- `tried jsonb`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `checked_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.runs (run_id → id)
- public.findings (finding_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_company_checks ON public.company_checks USING btree (company_id)`
- `CREATE INDEX ix_company_checks_run_id ON public.company_checks USING btree (run_id)`
- `CREATE INDEX ix_company_checks_finding_id ON public.company_checks USING btree (finding_id)`

## public.briefs (table)

- `person_id integer`
- `state varchar(16)`
- `text text`
- `citations jsonb`
- `dropped jsonb`
- `inputs_hash varchar(32)`
- `model varchar(128)`
- `prompt_version varchar(16)`
- `llm jsonb null`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`

References:

- public.people (person_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_briefs ON public.briefs USING btree (person_id)`
- `CREATE INDEX ix_briefs_run_id ON public.briefs USING btree (run_id)`

## public.contact_scores (table)

- `person_id integer`
- `score integer`
- `reasons jsonb`
- `computed_at timestamp with time zone = now()`
- `next_step varchar(16) null`

References:

- public.people (person_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_contact_scores ON public.contact_scores USING btree (person_id)`
- `CREATE INDEX ix_contact_scores_score ON public.contact_scores USING btree (score)`

## public.client_profile (table)

- `one boolean = true`
- `firm text`
- `sells text`
- `fee_avg integer null`
- `voice text`
- `recruiters jsonb = '[]'::jsonb`
- `default_recruiter varchar(320) null`
- `signature text`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_client_profile ON public.client_profile USING btree (one)`

## public.compositions (table)

- `id integer = nextval('compositions_id_seq'::regclass)`
- `person_id integer`
- `state varchar(16)`
- `enrollment_id integer null`
- `detail text null`
- `inputs_hash varchar(32)`
- `model varchar(128)`
- `prompt_version varchar(16)`
- `llm jsonb null`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`

References:

- public.people (person_id → id)
- public.runs (run_id → id)
- public.enrollments (enrollment_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_compositions ON public.compositions USING btree (id)`
- `CREATE INDEX ix_compositions_person_id ON public.compositions USING btree (person_id)`
- `CREATE INDEX ix_compositions_run_id ON public.compositions USING btree (run_id)`
- `CREATE INDEX ix_compositions_enrollment_id ON public.compositions USING btree (enrollment_id)`

## public.handoffs (table)

- `id integer = nextval('handoffs_id_seq'::regclass)`
- `thread_event_id integer`
- `enrollment_id integer`
- `person_id integer null`
- `recruiter_email varchar(320)`
- `forward_message_id varchar(255)`
- `forwarded_at timestamp with time zone null`
- `meeting_booked_at timestamp with time zone null`
- `booked_by varchar(320) null`
- `created_at timestamp with time zone = now()`
- `attempted_at timestamp with time zone null`

References:

- public.people (person_id → id)
- public.enrollments (enrollment_id → id)
- public.thread_events (thread_event_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_handoffs ON public.handoffs USING btree (id)`
- `CREATE UNIQUE INDEX uq_handoffs_thread_event_id ON public.handoffs USING btree (thread_event_id)`
- `CREATE INDEX ix_handoffs_person_id ON public.handoffs USING btree (person_id)`
- `CREATE INDEX ix_handoffs_enrollment_id ON public.handoffs USING btree (enrollment_id)`

## public.search_answers (table)

- `engine varchar(16)`
- `keyword_id integer`
- `asked_on date`
- `cited boolean`
- `rank integer null`
- `overview boolean null`
- `sources jsonb`
- `questions jsonb`
- `run_id uuid null`

References:

- public.runs (run_id → id)
- public.search_keywords (keyword_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_search_answers ON public.search_answers USING btree (engine, keyword_id, asked_on)`
- `CREATE INDEX ix_search_answers_run_id ON public.search_answers USING btree (run_id)`
- `CREATE INDEX ix_search_answers_keyword_id ON public.search_answers USING btree (keyword_id)`

## public.search_days (table)

- `day date`
- `query text`
- `page text`
- `clicks integer`
- `impressions integer`
- `position double precision`
- `synced_at timestamp with time zone = now()`
- `run_id uuid null`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_search_days ON public.search_days USING btree (day, query, page)`
- `CREATE INDEX ix_search_days_query ON public.search_days USING btree (query)`
- `CREATE INDEX ix_search_days_run_id ON public.search_days USING btree (run_id)`

## public.search_keywords (table)

- `id integer = nextval('search_keywords_id_seq'::regclass)`
- `phrase text`
- `page text null`
- `source varchar(16)`
- `parent_id integer null`
- `added_at timestamp with time zone = now()`
- `retired_at timestamp with time zone null`
- `run_id uuid null`

References:

- public.runs (run_id → id)
- public.search_keywords (parent_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_search_keywords ON public.search_keywords USING btree (id)`
- `CREATE UNIQUE INDEX uq_search_keywords_phrase ON public.search_keywords USING btree (phrase)`
- `CREATE INDEX ix_search_keywords_run_id ON public.search_keywords USING btree (run_id)`
- `CREATE INDEX ix_search_keywords_parent_id ON public.search_keywords USING btree (parent_id)`

## public.search_pages (table)

- `url text`
- `checked_on date`
- `verdict varchar(32)`
- `coverage text null`
- `last_crawl timestamp with time zone null`
- `google_canonical text null`
- `raw jsonb`
- `run_id uuid null`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_search_pages ON public.search_pages USING btree (url, checked_on)`
- `CREATE INDEX ix_search_pages_run_id ON public.search_pages USING btree (run_id)`

## public.search_proposals (table)

- `id integer = nextval('search_proposals_id_seq'::regclass)`
- `made_on date`
- `page text`
- `kind varchar(16)`
- `current text`
- `proposed text`
- `why text`
- `keywords jsonb`
- `state varchar(16) = 'open'::character varying`
- `pr text null`
- `llm jsonb null`
- `run_id uuid null`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_search_proposals ON public.search_proposals USING btree (id)`
- `CREATE INDEX ix_search_proposals_state ON public.search_proposals USING btree (state)`
- `CREATE INDEX ix_search_proposals_run_id ON public.search_proposals USING btree (run_id)`

## public.run_events (table)

- `seq integer = nextval('run_events_seq_seq'::regclass)`
- `run_id uuid`
- `at timestamp with time zone = now()`
- `step varchar(64)`
- `kind varchar(16)`
- `line text`
- `subject text null`
- `count integer null`
- `source jsonb null`
- `detail text null`
- `trace_id varchar(32) null`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_run_events ON public.run_events USING btree (seq)`
- `CREATE INDEX ix_run_events_run_id_seq ON public.run_events USING btree (run_id, seq)`

## public.studies (table)

- `id integer = nextval('studies_id_seq'::regclass)`
- `slug varchar(80)`
- `question text`
- `angles jsonb`
- `drafts jsonb`
- `niche varchar(64) null`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_studies ON public.studies USING btree (id)`
- `CREATE UNIQUE INDEX uq_studies_slug ON public.studies USING btree (slug)`

## public.study_steps (table)

- `id integer = nextval('study_steps_id_seq'::regclass)`
- `study_id integer`
- `step varchar(16)`
- `key text`
- `outcome varchar(16)`
- `document_id integer null`
- `detail jsonb`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`

References:

- public.runs (run_id → id)
- public.documents (document_id → id)
- public.studies (study_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_study_steps ON public.study_steps USING btree (id)`
- `CREATE UNIQUE INDEX uq_study_steps_unit ON public.study_steps USING btree (study_id, step, key)`
- `CREATE INDEX ix_study_steps_run_id ON public.study_steps USING btree (run_id)`
- `CREATE INDEX ix_study_steps_document_id ON public.study_steps USING btree (document_id)`

## public.client_members (table)

- `client_id varchar(40)`
- `email text`
- `role varchar(64) = 'member'::character varying`
- `invited_by text null`
- `invited_at timestamp with time zone = now()`
- `last_seen_at timestamp with time zone null`

References:

- public.clients (client_id → id)
- public.roles (role → id)

Indexes:

- `CREATE UNIQUE INDEX pk_client_members ON public.client_members USING btree (client_id, email)`
- `CREATE INDEX ix_client_members_email ON public.client_members USING btree (email)`
- `CREATE INDEX ix_client_members_role ON public.client_members USING btree (role)`

## public.operators (table)

- `email text`
- `added_at timestamp with time zone = now()`
- `role varchar(64) = 'admin'::character varying`
- `clients text[] null`

References:

- public.roles (role → id)

Indexes:

- `CREATE UNIQUE INDEX pk_operators ON public.operators USING btree (email)`
- `CREATE INDEX ix_operators_role ON public.operators USING btree (role)`

## public.recruiting_facts (view)

- `company_id integer null`
- `source_key varchar(64) null`
- `domain varchar(255) null`
- `name varchar null`
- `country varchar(2) null`
- `employees integer null`
- `payroll_yearly_usd bigint null`
- `founded_year integer null`
- `opener text null`
- `video_url text null`

## public.person_facts (view)

- `person_id integer null`
- `company_id integer null`
- `company_source_key varchar(64) null`
- `company_name varchar null`
- `company_domain varchar(255) null`
- `company_niche varchar(32) null`
- `source_key varchar(64) null`
- `full_name text null`
- `first_name varchar null`
- `last_name varchar null`
- `title text null`
- `is_compliance boolean null`
- `is_testimonial boolean null`
- `testimonial_org text null`
- `origin varchar(32) null`
- `as_of date null`
- `linkedin_url varchar(512) null`
- `role_rank integer null`
- `avoid_emailing_first boolean null`

## public.sms_push_subscriptions (table)

- `id uuid = gen_random_uuid()`
- `created_at timestamp with time zone = now()`
- `endpoint text`
- `p256dh text`
- `auth text`
- `operator varchar(200)`
- `last_pushed_at timestamp with time zone null`

References:

- public.operators (operator → email)

Indexes:

- `CREATE UNIQUE INDEX pk_sms_push_subscriptions ON public.sms_push_subscriptions USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_push_subscriptions_endpoint ON public.sms_push_subscriptions USING btree (endpoint)`
- `CREATE INDEX ix_sms_push_subscriptions_operator ON public.sms_push_subscriptions USING btree (operator)`

## public.call_invites (table)

- `id integer = nextval('call_invites_id_seq'::regclass)`
- `thread_event_id integer`
- `enrollment_id integer`
- `state varchar(32)`
- `start timestamp with time zone null`
- `time_zone varchar(64) null`
- `email varchar(320)`
- `booking_uid varchar(64) null`
- `detail text null`
- `reading jsonb null`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `reply_message_id integer null`

References:

- public.runs (run_id → id)
- public.enrollments (enrollment_id → id)
- public.messages (reply_message_id → id)
- public.thread_events (thread_event_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_call_invites ON public.call_invites USING btree (id)`
- `CREATE UNIQUE INDEX uq_call_invites_thread_event_id ON public.call_invites USING btree (thread_event_id)`
- `CREATE INDEX ix_call_invites_enrollment_id ON public.call_invites USING btree (enrollment_id)`
- `CREATE INDEX ix_call_invites_reply_message_id ON public.call_invites USING btree (reply_message_id)`
- `CREATE INDEX ix_call_invites_run_id ON public.call_invites USING btree (run_id)`

## public.reach_accounts (table)

- `id uuid = gen_random_uuid()`
- `created_at timestamp with time zone = now()`
- `platform varchar(16)`
- `account varchar(120)`
- `handle varchar(120) null`
- `state varchar(16) = 'warming'::character varying`
- `paused_reason text null`
- `started_on date`
- `health jsonb null`
- `health_at timestamp with time zone null`
- `retired_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_reach_accounts ON public.reach_accounts USING btree (id)`
- `CREATE UNIQUE INDEX uq_reach_accounts_platform_account ON public.reach_accounts USING btree (platform, account)`

## public.reach_contacts (table)

- `id integer = nextval('reach_contacts_id_seq'::regclass)`
- `platform varchar(16)`
- `handle varchar(120)`
- `url text`
- `name text null`
- `headline text null`
- `found_in varchar(200)`
- `company_id integer null`
- `person_id integer null`
- `niche varchar(32) null`
- `profile jsonb null`
- `enriched_at timestamp with time zone null`
- `account_id uuid null`
- `state varchar(16) = 'new'::character varying`
- `state_reason text null`
- `sequence varchar(64) null`
- `enrolled_at timestamp with time zone null`
- `connected_at timestamp with time zone null`
- `ended_at timestamp with time zone null`
- `read_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `withdrawn_at timestamp with time zone null`
- `draft text null`
- `draft_at timestamp with time zone null`
- `draft_for integer null`
- `fit jsonb null`

References:

- public.companies (company_id → id)
- public.people (person_id → id)
- public.reach_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_reach_contacts ON public.reach_contacts USING btree (id)`
- `CREATE UNIQUE INDEX uq_reach_contacts_platform_handle ON public.reach_contacts USING btree (platform, handle)`
- `CREATE INDEX ix_reach_contacts_state ON public.reach_contacts USING btree (state)`
- `CREATE INDEX ix_reach_contacts_company_id ON public.reach_contacts USING btree (company_id)`
- `CREATE INDEX ix_reach_contacts_person_id ON public.reach_contacts USING btree (person_id)`
- `CREATE INDEX ix_reach_contacts_account_id ON public.reach_contacts USING btree (account_id)`

## public.reach_messages (table)

- `id integer = nextval('reach_messages_id_seq'::regclass)`
- `contact_id integer`
- `account_id uuid null`
- `direction varchar(4)`
- `kind varchar(16)`
- `step smallint null`
- `template varchar(120) null`
- `subject text null`
- `body text`
- `state varchar(16)`
- `state_reason text null`
- `due_at timestamp with time zone null`
- `sent_at timestamp with time zone null`
- `ref varchar(200) null`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`
- `template_version varchar(12) null`
- `provenance jsonb null`

References:

- public.runs (run_id → id)
- public.reach_accounts (account_id → id)
- public.reach_contacts (contact_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_reach_messages ON public.reach_messages USING btree (id)`
- `CREATE INDEX ix_reach_messages_contact_id ON public.reach_messages USING btree (contact_id)`
- `CREATE INDEX ix_reach_messages_due ON public.reach_messages USING btree (state, due_at)`
- `CREATE UNIQUE INDEX uq_reach_messages_in_ref ON public.reach_messages USING btree (contact_id, ref) WHERE ((direction)::text = 'in'::text)`
- `CREATE INDEX ix_reach_messages_account_id ON public.reach_messages USING btree (account_id)`
- `CREATE INDEX ix_reach_messages_run_id ON public.reach_messages USING btree (run_id)`
- `CREATE UNIQUE INDEX uq_reach_messages_follow_up ON public.reach_messages USING btree (contact_id, ((provenance ->> 'follow'::text))) WHERE ((kind)::text = 'follow_up'::text)`

## public.candidate_mints (table)

- `person_id integer`
- `minted_at timestamp with time zone = now()`

References:

- public.people (person_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_candidate_mints ON public.candidate_mints USING btree (person_id)`

## public.pg_stat_statements_info (view)

- `dealloc bigint null`
- `stats_reset timestamp with time zone null`

## public.pg_stat_statements (view)

- `userid oid null`
- `dbid oid null`
- `toplevel boolean null`
- `queryid bigint null`
- `query text null`
- `plans bigint null`
- `total_plan_time double precision null`
- `min_plan_time double precision null`
- `max_plan_time double precision null`
- `mean_plan_time double precision null`
- `stddev_plan_time double precision null`
- `calls bigint null`
- `total_exec_time double precision null`
- `min_exec_time double precision null`
- `max_exec_time double precision null`
- `mean_exec_time double precision null`
- `stddev_exec_time double precision null`
- `rows bigint null`
- `shared_blks_hit bigint null`
- `shared_blks_read bigint null`
- `shared_blks_dirtied bigint null`
- `shared_blks_written bigint null`
- `local_blks_hit bigint null`
- `local_blks_read bigint null`
- `local_blks_dirtied bigint null`
- `local_blks_written bigint null`
- `temp_blks_read bigint null`
- `temp_blks_written bigint null`
- `shared_blk_read_time double precision null`
- `shared_blk_write_time double precision null`
- `local_blk_read_time double precision null`
- `local_blk_write_time double precision null`
- `temp_blk_read_time double precision null`
- `temp_blk_write_time double precision null`
- `wal_records bigint null`
- `wal_fpi bigint null`
- `wal_bytes numeric null`
- `jit_functions bigint null`
- `jit_generation_time double precision null`
- `jit_inlining_count bigint null`
- `jit_inlining_time double precision null`
- `jit_optimization_count bigint null`
- `jit_optimization_time double precision null`
- `jit_emission_count bigint null`
- `jit_emission_time double precision null`
- `jit_deform_count bigint null`
- `jit_deform_time double precision null`
- `stats_since timestamp with time zone null`
- `minmax_stats_since timestamp with time zone null`

## public.pipeline_funnel (view)

- `niche varchar(32) null`
- `in_play bigint null`
- `with_domain bigint null`
- `crawled bigint null`
- `named_person bigint null`
- `verified_named_lead bigint null`

## public.pipeline_leaks (view)

- `niche varchar(32) null`
- `catch_all_leads bigint null`
- `risky_leads bigint null`
- `queued_firms bigint null`
- `crawled_no_person_firms bigint null`

## public.mover_addresses (table)

- `finding_id integer`
- `person_id integer`
- `domain varchar(255) null`
- `outcome varchar(16)`
- `candidate_id integer null`
- `tried_at timestamp with time zone = now()`

References:

- public.people (person_id → id)
- public.contact_candidates (candidate_id → id)
- public.findings (finding_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_mover_addresses ON public.mover_addresses USING btree (finding_id)`
- `CREATE INDEX ix_mover_addresses_person_id ON public.mover_addresses USING btree (person_id)`
- `CREATE INDEX ix_mover_addresses_candidate_id ON public.mover_addresses USING btree (candidate_id)`

## public.reactivation_emails (view)

- `id integer null`
- `person integer null`
- `name text null`
- `company varchar null`
- `domain varchar(255) null`
- `subject text null`
- `status text null`
- `stop_reason varchar(32) null`
- `sent integer null`
- `approved_by text null`
- `written timestamp with time zone null`
- `last_sent timestamp with time zone null`

## public.reactivation_findings (view)

- `id integer null`
- `kind varchar(32) null`
- `person integer null`
- `subject text null`
- `via varchar(64) null`
- `title text null`
- `url text null`
- `confidence real null`
- `observed timestamp with time zone null`

## public.email_reply_thread (view)

- `reply_id integer null`
- `at timestamp with time zone null`
- `kind text null`
- `what text null`

## public.company_lookups (table)

- `company_id integer`
- `state varchar(16)`
- `tried jsonb`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `looked_up_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_company_lookups ON public.company_lookups USING btree (company_id)`
- `CREATE INDEX ix_company_lookups_run_id ON public.company_lookups USING btree (run_id)`

## public.lead_checks (table)

- `lead_id integer`
- `kind varchar(32)`
- `result varchar(16)`
- `evidence jsonb`
- `checked_at timestamp with time zone = now()`

References:

- public.leads (lead_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_lead_checks ON public.lead_checks USING btree (lead_id, kind)`

## public.campaign_controls (table)

- `campaign text`
- `kill_switch boolean null`
- `openers_per_day integer null`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

Indexes:

- `CREATE UNIQUE INDEX pk_campaign_controls ON public.campaign_controls USING btree (campaign)`

## public.placement_checks (table)

- `sender varchar(320)`
- `seed varchar(320)`
- `day date`
- `message_id varchar(255) null`
- `sent_at timestamp with time zone null`
- `landed varchar(16) null`
- `checked_at timestamp with time zone null`
- `detail text null`
- `kind varchar(8)`
- `auth jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_placement_checks ON public.placement_checks USING btree (sender, seed, day, kind)`

## public.reactivation_replies (view)

- `id integer null`
- `person integer null`
- `name text null`
- `company varchar null`
- `domain varchar(255) null`
- `subject text null`
- `status text null`
- `disposition varchar(32) null`
- `handed_to varchar(320) null`
- `received timestamp with time zone null`
- `booked timestamp with time zone null`

## public.calls (table)

- `id integer = nextval('calls_id_seq'::regclass)`
- `person_id integer`
- `called_by varchar(320)`
- `called_at timestamp with time zone = now()`

References:

- public.people (person_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_calls ON public.calls USING btree (id)`
- `CREATE INDEX ix_calls_person_id ON public.calls USING btree (person_id, called_at)`

## public.reactivation_person_activity (view)

- `person integer null`
- `at timestamp with time zone null`
- `kind varchar null`
- `what text null`

## public.content_playbooks (table)

- `id uuid = gen_random_uuid()`
- `created_at timestamp with time zone = now()`
- `platform varchar(16)`
- `sop varchar(64)`
- `text text`
- `scope jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_content_playbooks ON public.content_playbooks USING btree (id)`
- `CREATE INDEX ix_content_playbooks_platform_created_at ON public.content_playbooks USING btree (platform, created_at)`

## public.call_bookings (table)

- `id integer = nextval('call_bookings_id_seq'::regclass)`
- `uid varchar(64)`
- `state varchar(16)`
- `start timestamp with time zone null`
- `email varchar(320) null`
- `name text null`
- `offer varchar(64) null`
- `code varchar(40) null`
- `message_id integer null`
- `enrollment_id integer null`
- `booked_at timestamp with time zone`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `outcome varchar(16) null`
- `outcome_reason text null`
- `outcome_at timestamp with time zone null`
- `outcome_by text null`

References:

- public.enrollments (enrollment_id → id)
- public.messages (message_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_call_bookings ON public.call_bookings USING btree (id)`
- `CREATE UNIQUE INDEX uq_call_bookings_uid ON public.call_bookings USING btree (uid)`
- `CREATE INDEX ix_call_bookings_enrollment_id ON public.call_bookings USING btree (enrollment_id)`
- `CREATE INDEX ix_call_bookings_message_id ON public.call_bookings USING btree (message_id)`

## public.contact_outcomes (view)

- `enrollment_id integer null`
- `company_id integer null`
- `niche varchar(32) null`
- `sequence_name varchar(64) null`
- `offer varchar(64) null`
- `to_email varchar(320) null`
- `contact_round integer null`
- `enrolled_at timestamp with time zone null`
- `last_touch_at timestamp with time zone null`
- `outcome text null`

## public.ad_days (table)

- `day date`
- `adset_id varchar(32)`
- `campaign_id varchar(32)`
- `campaign_name text`
- `adset_name text`
- `currency varchar(3)`
- `spend double precision`
- `impressions integer`
- `reach integer`
- `clicks integer`
- `leads integer`
- `results integer`
- `synced_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_ad_days ON public.ad_days USING btree (adset_id, day)`
- `CREATE INDEX ix_ad_days_day ON public.ad_days USING btree (day)`
- `CREATE INDEX ix_ad_days_campaign_id ON public.ad_days USING btree (campaign_id)`

## public.site_days (table)

- `day date`
- `channel varchar(16)`
- `campaign varchar(100)`
- `visits integer`
- `first_touches integer`
- `forms integer`
- `bookings integer`
- `watch_plays integer`
- `synced_at timestamp with time zone = now()`
- `calls integer = 0`
- `paid integer = 0`

Indexes:

- `CREATE UNIQUE INDEX pk_site_days ON public.site_days USING btree (day, channel, campaign)`

## public.marketing_ad_day_records (view)

- `id text null`
- `day date null`
- `campaign text null`
- `adset text null`
- `currency text null`
- `spend double precision null`
- `impressions integer null`
- `reach integer null`
- `clicks integer null`
- `leads integer null`
- `cost_per_lead double precision null`
- `state text null`
- `age text null`

## public.marketing_text_contact_records (view)

- `id integer null`
- `name text null`
- `state text null`
- `basis text null`
- `niche text null`
- `sent integer null`
- `replies integer null`
- `texted integer null`
- `replied integer null`
- `last_text text null`
- `last_at timestamp with time zone null`
- `disposition text null`
- `waiting text null`
- `enrolled timestamp with time zone null`

## public.marketing_answer_records (view)

- `id text null`
- `phrase text null`
- `engine text null`
- `asked date null`
- `cited text null`
- `rank integer null`
- `overview text null`
- `latest text null`

## public.marketing_keyword_records (view)

- `id integer null`
- `phrase text null`
- `source text null`
- `page text null`
- `state text null`
- `clicks integer null`
- `impressions integer null`
- `position double precision null`
- `clicks_change integer null`
- `impressions_change integer null`
- `added timestamp with time zone null`

## public.marketing_search_day_records (view)

- `id text null`
- `day date null`
- `clicks integer null`
- `impressions integer null`
- `position double precision null`

## public.marketing_search_page_records (view)

- `id text null`
- `url text null`
- `indexed text null`
- `coverage text null`
- `checked date null`
- `clicks integer null`
- `impressions integer null`
- `position double precision null`
- `clicks_change integer null`
- `impressions_change integer null`

## public.consent_events (table)

- `id integer = nextval('consent_events_id_seq'::regclass)`
- `consent_id integer`
- `kind varchar(16)`
- `by varchar(320)`
- `evidence jsonb null`
- `created_at timestamp with time zone = now()`
- `message_id varchar(998) null`

References:

- public.consents (consent_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_consent_events ON public.consent_events USING btree (id)`
- `CREATE INDEX ix_consent_events_consent_id ON public.consent_events USING btree (consent_id, created_at)`
- `CREATE INDEX ix_consent_events_message_id ON public.consent_events USING btree (message_id)`

## public.consents (table)

- `id integer = nextval('consents_id_seq'::regclass)`
- `channel varchar(16)`
- `address varchar(320)`
- `topic_id integer`
- `state varchar(16)`
- `source varchar(32)`
- `text_version varchar(64)`
- `frequency varchar(16) = 'as_sent'::character varying`
- `paused_until timestamp with time zone null`
- `pending_at timestamp with time zone null`
- `confirmed_at timestamp with time zone null`
- `withdrawn_at timestamp with time zone null`
- `last_sent_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

References:

- public.topics (topic_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_consents ON public.consents USING btree (id)`
- `CREATE UNIQUE INDEX uq_consents_channel ON public.consents USING btree (channel, address, topic_id)`
- `CREATE INDEX ix_consents_topic_id ON public.consents USING btree (topic_id)`

## public.topics (table)

- `id integer = nextval('topics_id_seq'::regclass)`
- `name varchar(64)`
- `public_name varchar(120)`
- `line text`
- `channel varchar(16)`
- `cadence varchar(64)`
- `public boolean = false`
- `created_at timestamp with time zone = now()`
- `keyword varchar(32) null`

Indexes:

- `CREATE UNIQUE INDEX pk_topics ON public.topics USING btree (id)`
- `CREATE UNIQUE INDEX uq_topics_name ON public.topics USING btree (name)`
- `CREATE UNIQUE INDEX uq_topics_keyword ON public.topics USING btree (keyword)`

## public.marketing_subscriber_activity (view)

- `subscriber text null`
- `at timestamp with time zone null`
- `kind varchar null`
- `what text null`

## public.marketing_subscriber_records (view)

- `id text null`
- `address varchar(320) null`
- `channel varchar(16) null`
- `topics text null`
- `state text null`
- `source varchar null`
- `can_send text null`
- `since timestamp with time zone null`
- `last_sent timestamp with time zone null`
- `frequency text null`
- `actor varchar(320) null`

## public.marketing_topic_records (view)

- `id varchar(64) null`
- `public_name varchar(120) null`
- `channel varchar(16) null`
- `cadence varchar(64) null`
- `shown text null`
- `confirmed bigint null`
- `net_week bigint null`
- `confirms bigint null`
- `signups bigint null`
- `leaves bigint null`
- `sends bigint null`
- `last_sent timestamp with time zone null`

## public.contact_points (table)

- `id integer = nextval('contact_points_id_seq'::regclass)`
- `company_id integer`
- `person_id integer null`
- `kind varchar(32)`
- `value varchar(512)`
- `source varchar(16)`
- `pages integer = 1`
- `document_id integer null`
- `source_url text`
- `created_at timestamp with time zone = now()`
- `seen_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.people (person_id → id)
- public.documents (document_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_contact_points ON public.contact_points USING btree (id)`
- `CREATE UNIQUE INDEX uq_contact_points_company_kind_value ON public.contact_points USING btree (company_id, kind, value)`
- `CREATE INDEX ix_contact_points_person_id ON public.contact_points USING btree (person_id)`
- `CREATE INDEX ix_contact_points_document_id ON public.contact_points USING btree (document_id)`
- `CREATE INDEX ix_contact_points_kind_id ON public.contact_points USING btree (kind, id)`
- `CREATE INDEX ix_contact_points_kind_value ON public.contact_points USING btree (kind, value)`

## public.own_contact_points (view)

- `id integer null`
- `company_id integer null`
- `person_id integer null`
- `kind varchar(32) null`
- `value varchar(512) null`
- `source varchar(16) null`
- `pages integer null`
- `document_id integer null`
- `source_url text null`
- `created_at timestamp with time zone null`
- `seen_at timestamp with time zone null`

## public.lead_sheet (view)

- `lead_id integer null`
- `niche varchar(32) null`
- `person_id integer null`
- `company_id integer null`
- `person_name text null`
- `result_title text null`
- `linkedin_url varchar(512) null`
- `email varchar(320) null`
- `valid_email_on date null`
- `email_type text null`
- `mail_status text null`
- `company_name varchar null`
- `company_domain varchar(255) null`
- `company_linkedin varchar(512) null`
- `phone varchar(512) null`
- `socials text null`
- `company_location text null`
- `industry text null`
- `description text null`
- `checks text null`
- `verified text null`

## public.team_searches (table)

- `company_id integer`
- `state varchar(16)`
- `query text`
- `profiles jsonb`
- `kept integer = 0`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `searched_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_team_searches ON public.team_searches USING btree (company_id)`
- `CREATE INDEX ix_team_searches_run_id ON public.team_searches USING btree (run_id)`

## public.fills (table)

- `id integer = nextval('fills_id_seq'::regclass)`
- `kind varchar(16)`
- `prompt_version varchar(12)`
- `input text`
- `key varchar(64)`
- `value jsonb null`
- `refused text null`
- `model varchar(128)`
- `envelope jsonb`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_fills ON public.fills USING btree (id)`
- `CREATE UNIQUE INDEX uq_fills_key ON public.fills USING btree (key)`

## public.events (table)

- `id uuid = gen_random_uuid()`
- `workflow varchar(64)`
- `node varchar(200)`
- `port varchar(64)`
- `subject varchar(200)`
- `kind varchar(16)`
- `data jsonb`
- `at timestamp with time zone = now()`
- `due timestamp with time zone null`
- `by varchar(64)`
- `error text null`
- `sent jsonb null`
- `sent_at timestamp with time zone null`
- `version integer null`
- `until varchar(16) null`
- `about varchar(200) null`

Indexes:

- `CREATE UNIQUE INDEX pk_events ON public.events USING btree (id)`
- `CREATE UNIQUE INDEX uq_events_entry ON public.events USING btree (workflow, node, port, subject)`
- `CREATE INDEX ix_events_subject ON public.events USING btree (subject)`
- `CREATE INDEX ix_events_until ON public.events USING btree (until, about) WHERE ((due IS NOT NULL) AND (until IS NOT NULL))`
- `CREATE INDEX ix_events_failed ON public.events USING btree (workflow) WHERE (error IS NOT NULL)`

## public.hooks (table)

- `id uuid = gen_random_uuid()`
- `token_hash varchar(64)`
- `name text`
- `client varchar(40) null`
- `workflow varchar(64)`
- `input varchar(64)`
- `subject varchar(200)`
- `created_at timestamp with time zone = now()`
- `last_at timestamp with time zone null`
- `calls integer = 0`
- `fields jsonb = '{}'::jsonb`
- `open boolean = true`
- `sealed text null`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_hooks ON public.hooks USING btree (id)`
- `CREATE UNIQUE INDEX uq_hooks_token_hash ON public.hooks USING btree (token_hash)`
- `CREATE INDEX ix_hooks_client ON public.hooks USING btree (client)`

## public.workflow_saves (table)

- `id integer = nextval('workflow_saves_id_seq'::regclass)`
- `client varchar(40) null`
- `workflow varchar(64)`
- `edits jsonb null`
- `by text`
- `at timestamp with time zone = now()`
- `live boolean = true`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_workflow_saves ON public.workflow_saves USING btree (id)`
- `CREATE INDEX ix_workflow_saves_client_workflow ON public.workflow_saves USING btree (client, workflow, id)`

## public.social_groups (table)

- `id integer = nextval('social_groups_id_seq'::regclass)`
- `network varchar(16)`
- `ref varchar(100)`
- `niche varchar(32)`
- `keyword text`
- `name text null`
- `url text`
- `about jsonb null`
- `hit jsonb`
- `error text null`
- `read_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

References:

- public.platform_objects (network → platform, ref → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_social_groups ON public.social_groups USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_groups_ref ON public.social_groups USING btree (network, ref)`
- `CREATE INDEX ix_social_groups_niche_read ON public.social_groups USING btree (niche, read_at)`

## public.social_posts (table)

- `id integer = nextval('social_posts_id_seq'::regclass)`
- `network varchar(16)`
- `group_id integer`
- `ref varchar(32)`
- `url text`
- `author text null`
- `posted text null`
- `text text null`
- `raw jsonb`
- `company_id integer null`
- `person_id integer null`
- `mapped_by varchar(16) null`
- `error text null`
- `read_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.people (person_id → id)
- public.social_groups (group_id → id)
- public.platform_objects (network → platform, ref → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_social_posts ON public.social_posts USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_posts_ref ON public.social_posts USING btree (network, ref)`
- `CREATE INDEX ix_social_posts_group_id ON public.social_posts USING btree (group_id)`
- `CREATE INDEX ix_social_posts_company_id ON public.social_posts USING btree (company_id)`
- `CREATE INDEX ix_social_posts_person_id ON public.social_posts USING btree (person_id)`
- `CREATE INDEX ix_social_posts_read_at ON public.social_posts USING btree (read_at)`

## public.social_searches (table)

- `id integer = nextval('social_searches_id_seq'::regclass)`
- `network varchar(16)`
- `niche varchar(32)`
- `keyword text`
- `n integer`
- `groups integer`
- `answer jsonb`
- `searched_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_social_searches ON public.social_searches USING btree (id)`
- `CREATE INDEX ix_social_searches_keyword ON public.social_searches USING btree (network, niche, keyword, searched_at)`

## public.check_outcomes (table)

- `id integer = nextval('check_outcomes_id_seq'::regclass)`
- `stage varchar(64)`
- `source varchar(64)`
- `check varchar(120)`
- `subject varchar(200) null`
- `ok boolean`
- `reason text null`
- `at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_check_outcomes ON public.check_outcomes USING btree (id)`
- `CREATE INDEX ix_check_outcomes_stage_source ON public.check_outcomes USING btree (stage, source, id)`

## public.unit_holds (table)

- `id integer = nextval('unit_holds_id_seq'::regclass)`
- `stage varchar(64)`
- `subject varchar(200)`
- `reason text`
- `held_at timestamp with time zone = now()`
- `until timestamp with time zone`
- `tries integer = 1`
- `released_at timestamp with time zone null`
- `released_by varchar(320) null`

Indexes:

- `CREATE UNIQUE INDEX pk_unit_holds ON public.unit_holds USING btree (id)`
- `CREATE UNIQUE INDEX uq_unit_holds_stage_subject ON public.unit_holds USING btree (stage, subject)`

## public.check_rates (view)

- `id text null`
- `stage varchar(64) null`
- `source varchar(64) null`
- `check varchar(120) null`
- `total integer null`
- `passed integer null`
- `rate real null`
- `last_at timestamp with time zone null`
- `state text null`

## public.company_event_checks (table)

- `company_id integer`
- `state varchar(16)`
- `events integer = 0`
- `tried jsonb`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `checked_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_company_event_checks ON public.company_event_checks USING btree (company_id)`
- `CREATE INDEX ix_company_event_checks_run_id ON public.company_event_checks USING btree (run_id)`

## public.comments (table)

- `id integer = nextval('comments_id_seq'::regclass)`
- `platform varchar(16)`
- `account_id uuid null`
- `ref varchar(200)`
- `post varchar(200)`
- `parent varchar(200)`
- `kind varchar(32)`
- `place varchar(200) null`
- `post_title text null`
- `author varchar(120)`
- `body text`
- `url text`
- `at timestamp with time zone`
- `raw jsonb`
- `sort varchar(16) null`
- `why text null`
- `draft text null`
- `state varchar(16) = 'new'::character varying`
- `answer text null`
- `answer_ref varchar(200) null`
- `answered_at timestamp with time zone null`
- `contact_id integer null`
- `created_at timestamp with time zone = now()`
- `channel varchar(16) = 'reach'::character varying`
- `stars smallint null`

References:

- public.reach_accounts (account_id → id)
- public.reach_contacts (contact_id → id)
- public.platform_objects (platform → platform, answer_ref → ref; platform → platform, parent → ref; platform → platform, post → ref; platform → platform, ref → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_comments ON public.comments USING btree (id)`
- `CREATE UNIQUE INDEX uq_comments_platform_ref ON public.comments USING btree (platform, ref)`
- `CREATE INDEX ix_comments_state ON public.comments USING btree (state)`
- `CREATE INDEX ix_comments_account_id ON public.comments USING btree (account_id)`
- `CREATE INDEX ix_comments_post ON public.comments USING btree (post)`
- `CREATE INDEX ix_comments_contact_id ON public.comments USING btree (contact_id)`
- `CREATE INDEX ix_comments_platform_post ON public.comments USING btree (platform, post)`
- `CREATE INDEX ix_comments_platform_parent ON public.comments USING btree (platform, parent)`
- `CREATE INDEX ix_comments_platform_answer_ref ON public.comments USING btree (platform, answer_ref)`

## public.marketing_funnel_records (view)

- `id text null`
- `window text null`
- `channel text null`
- `visitors integer null`
- `forms integer null`
- `calls integer null`
- `paid integer null`

## public.marketing_site_day_records (view)

- `id text null`
- `day date null`
- `channel text null`
- `campaign text null`
- `visits integer null`
- `first_touches integer null`
- `forms integer null`
- `bookings integer null`
- `watch_plays integer null`
- `calls integer null`
- `paid integer null`
- `age text null`

## public.latest_verifications (view)

- `id integer null`
- `email varchar(320) null`
- `result varchar(32) null`
- `verifier varchar(64) null`
- `raw jsonb null`
- `checked_at timestamp with time zone null`
- `lead_id integer null`
- `contact_candidate_id integer null`

## public.lead_channels (view)

- `channel text null`
- `id integer null`
- `company_id integer null`
- `person_id integer null`
- `state text null`
- `active boolean null`
- `created_at timestamp with time zone null`
- `first_touch_at timestamp with time zone null`

## public.wren_settings (table)

- `component varchar(64)`
- `settings jsonb = '{}'::jsonb`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(320) null`

Indexes:

- `CREATE UNIQUE INDEX pk_wren_settings ON public.wren_settings USING btree (component)`

## public.reddit_people (table)

- `handle varchar(64)`
- `name varchar(64)`
- `raw jsonb`
- `facts jsonb`
- `read jsonb null`
- `fit smallint null`
- `site varchar(253) null`
- `read_at timestamp with time zone`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_reddit_people ON public.reddit_people USING btree (handle)`
- `CREATE INDEX ix_reddit_people_read_at ON public.reddit_people USING btree (read_at)`

## public.reddit_places (table)

- `subreddit varchar(64)`
- `name varchar(64)`
- `found_by text`
- `raw jsonb null`
- `judged jsonb null`
- `fit smallint null`
- `subscribers integer null`
- `state varchar(16) = 'found'::character varying`
- `account_id uuid null`
- `read_at timestamp with time zone null`
- `threads_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `joined_at timestamp with time zone null`
- `purpose varchar(16) = 'reach'::character varying`

References:

- public.reach_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_reddit_places ON public.reddit_places USING btree (subreddit)`
- `CREATE INDEX ix_reddit_places_state ON public.reddit_places USING btree (state)`
- `CREATE INDEX ix_reddit_places_account_id ON public.reddit_places USING btree (account_id)`

## public.reddit_threads (table)

- `id varchar(20)`
- `subreddit varchar(64)`
- `title text`
- `body text`
- `author varchar(64)`
- `url text`
- `posted_at timestamp with time zone`
- `comments integer`
- `raw jsonb`
- `dropped text null`
- `kind varchar(16) null`
- `fit smallint null`
- `angle text null`
- `target varchar(20) null`
- `target_text text null`
- `draft text null`
- `sources jsonb null`
- `state varchar(16) = 'new'::character varying`
- `account_id uuid null`
- `answer text null`
- `answer_ref varchar(20) null`
- `answered_at timestamp with time zone null`
- `score integer null`
- `scored_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `send_at timestamp with time zone null`
- `platform varchar(16) = 'reddit'::character varying`

References:

- public.reach_accounts (account_id → id)
- public.reddit_places (subreddit → subreddit)
- public.platform_objects (platform → platform, answer_ref → ref; platform → platform, id → ref; platform → platform, target → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_reddit_threads ON public.reddit_threads USING btree (id)`
- `CREATE INDEX ix_reddit_threads_subreddit ON public.reddit_threads USING btree (subreddit)`
- `CREATE INDEX ix_reddit_threads_state ON public.reddit_threads USING btree (state)`
- `CREATE INDEX ix_reddit_threads_account_id ON public.reddit_threads USING btree (account_id)`
- `CREATE INDEX ix_reddit_threads_platform_target ON public.reddit_threads USING btree (platform, target)`
- `CREATE INDEX ix_reddit_threads_platform_answer_ref ON public.reddit_threads USING btree (platform, answer_ref)`

## public.social_activity (table)

- `id integer = nextval('social_activity_id_seq'::regclass)`
- `platform varchar(16)`
- `kind varchar(16)`
- `ref varchar(200)`
- `actor text null`
- `actor_url text null`
- `text text`
- `url text null`
- `at timestamp with time zone`
- `raw jsonb`
- `state varchar(8) = 'new'::character varying`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_social_activity ON public.social_activity USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_activity_platform_ref ON public.social_activity USING btree (platform, ref)`
- `CREATE INDEX ix_social_activity_state ON public.social_activity USING btree (state)`
- `CREATE INDEX ix_social_activity_platform_at ON public.social_activity USING btree (platform, at)`

## public.social_days (table)

- `platform varchar(16)`
- `day date`
- `followers integer`
- `raw jsonb`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_social_days ON public.social_days USING btree (platform, day)`

## public.signal_checks (table)

- `collector varchar(32)`
- `subject varchar(160)`
- `state varchar(16)`
- `found integer = 0`
- `tried jsonb`
- `answer jsonb null`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `checked_at timestamp with time zone = now()`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_signal_checks ON public.signal_checks USING btree (collector, subject)`
- `CREATE INDEX ix_signal_checks_run_id ON public.signal_checks USING btree (run_id)`
- `CREATE INDEX ix_signal_checks_checked_at ON public.signal_checks USING btree (checked_at)`

## public.video_edits (table)

- `id integer = nextval('video_edits_id_seq'::regclass)`
- `title text = ''::text`
- `state varchar(16) = 'added'::character varying`
- `dir text`
- `tracks jsonb`
- `script jsonb null`
- `words jsonb = '[]'::jsonb`
- `cuts jsonb = '[]'::jsonb`
- `layout jsonb = '[]'::jsonb`
- `captions jsonb = '{"on": true, "style": "word"}'::jsonb`
- `shorts jsonb = '[]'::jsonb`
- `description text = ''::text`
- `chapters jsonb = '[]'::jsonb`
- `tags jsonb = '[]'::jsonb`
- `thumbnail jsonb null`
- `looks jsonb = '{}'::jsonb`
- `files jsonb = '{}'::jsonb`
- `keys jsonb = '{}'::jsonb`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `render jsonb null`
- `formats jsonb = '["long"]'::jsonb`
- `stress jsonb = '[]'::jsonb`
- `overlays jsonb = '[]'::jsonb`
- `crops jsonb = '{}'::jsonb`
- `locked jsonb = '[]'::jsonb`
- `short_cuts jsonb = '[]'::jsonb`
- `sounds jsonb = '[]'::jsonb`
- `music jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_video_edits ON public.video_edits USING btree (id)`

## public.templates (table)

- `id integer = nextval('templates_id_seq'::regclass)`
- `kind varchar(16)`
- `system varchar(32)`
- `name varchar(64)`
- `live_version_id integer null`
- `draft_version_id integer null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `waiting_version_id integer null`
- `waiting_by varchar(200) null`
- `folder text = ''::text`
- `follows_default boolean = false`
- `why text null`

References:

- public.template_versions (draft_version_id → id; live_version_id → id; waiting_version_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_templates ON public.templates USING btree (id)`
- `CREATE UNIQUE INDEX uq_templates_kind_system_name ON public.templates USING btree (kind, system, name)`
- `CREATE INDEX ix_templates_live_version_id ON public.templates USING btree (live_version_id)`
- `CREATE INDEX ix_templates_draft_version_id ON public.templates USING btree (draft_version_id)`
- `CREATE INDEX ix_templates_waiting_version_id ON public.templates USING btree (waiting_version_id)`

## public.client_domains (table)

- `hostname text`
- `client_id varchar(40)`
- `cf_id text`
- `status text`
- `ssl_status text`
- `records jsonb`
- `problem text null`
- `added_by text`
- `checked_at timestamp with time zone = now()`
- `created_at timestamp with time zone = now()`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_client_domains ON public.client_domains USING btree (hostname)`
- `CREATE INDEX ix_client_domains_client ON public.client_domains USING btree (client_id)`

## public.template_stats (view)

- `kind text null`
- `system text null`
- `template text null`
- `template_id integer null`
- `version text null`
- `picks jsonb null`
- `sends bigint null`
- `replies bigint null`
- `booked bigint null`
- `last_sent timestamp with time zone null`

## public.changes (table)

- `id integer = nextval('changes_id_seq'::regclass)`
- `record varchar(64)`
- `record_id varchar(200)`
- `before jsonb`
- `after jsonb`
- `version varchar(16)`
- `by varchar(200)`
- `via varchar(16)`
- `run_id uuid null`
- `undoes integer null`
- `at timestamp with time zone = now()`

References:

- public.runs (run_id → id)
- public.changes (undoes → id)

Indexes:

- `CREATE UNIQUE INDEX pk_changes ON public.changes USING btree (id)`
- `CREATE UNIQUE INDEX uq_changes_undoes ON public.changes USING btree (undoes)`
- `CREATE INDEX ix_changes_record_record_id ON public.changes USING btree (record, record_id, id)`
- `CREATE INDEX ix_changes_run_id ON public.changes USING btree (run_id)`

## public.saved_views (table)

- `id integer = nextval('saved_views_id_seq'::regclass)`
- `workspace varchar(64)`
- `viewer varchar(200)`
- `record varchar(64)`
- `name varchar(60)`
- `params text`
- `shared boolean = false`
- `position integer = 0`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_saved_views ON public.saved_views USING btree (id)`
- `CREATE INDEX ix_saved_views_workspace_record ON public.saved_views USING btree (workspace, record, "position")`

## public.snippets (table)

- `id integer = nextval('snippets_id_seq'::regclass)`
- `workspace varchar(64)`
- `title varchar(500)`
- `body text`
- `tags text[] = '{}'::text[]`
- `channel varchar(16) null`
- `created_by varchar(200)`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_snippets ON public.snippets USING btree (id)`
- `CREATE INDEX ix_snippets_workspace ON public.snippets USING btree (workspace, title)`

## public.viewer_prefs (table)

- `workspace varchar(64)`
- `viewer varchar(200)`
- `key varchar(100)`
- `value jsonb`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_viewer_prefs ON public.viewer_prefs USING btree (workspace, viewer, key)`

## public.heat_days (table)

- `day date`
- `page varchar(200)`
- `width varchar(8)`
- `path varchar(300)`
- `cell integer`
- `clicks integer`
- `rage integer`
- `synced_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_heat_days ON public.heat_days USING btree (day, page, width, path, cell)`

## public.scroll_days (table)

- `day date`
- `page varchar(200)`
- `width varchar(8)`
- `band integer`
- `views integer`
- `synced_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_scroll_days ON public.scroll_days USING btree (day, page, width, band)`

## public.phone_consents (table)

- `id integer = nextval('phone_consents_id_seq'::regclass)`
- `e164 varchar(16)`
- `whose varchar(64) = 'wren'::character varying`
- `source varchar(16)`
- `text text`
- `text_version varchar(64)`
- `ai_voice boolean = false`
- `evidence jsonb = '{}'::jsonb`
- `given_at timestamp with time zone`
- `revoked_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_phone_consents ON public.phone_consents USING btree (id)`
- `CREATE INDEX ix_phone_consents_e164 ON public.phone_consents USING btree (e164)`

## public.voice_calls (table)

- `id integer = nextval('voice_calls_id_seq'::regclass)`
- `whose varchar(64) = 'wren'::character varying`
- `direction varchar(16)`
- `pipeline varchar(200)`
- `ref varchar(200)`
- `from_number varchar(32) = ''::character varying`
- `to_number varchar(32) = ''::character varying`
- `sms_contact_id integer null`
- `lead_name text null`
- `outcome varchar(16)`
- `transcript jsonb = '[]'::jsonb`
- `booking_id integer null`
- `message text null`
- `recording_key text null`
- `by varchar(320) null`
- `started_at timestamp with time zone`
- `ended_at timestamp with time zone`
- `created_at timestamp with time zone = now()`

References:

- public.sms_contacts (sms_contact_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_voice_calls ON public.voice_calls USING btree (id)`
- `CREATE INDEX ix_voice_calls_started_at ON public.voice_calls USING btree (started_at)`
- `CREATE INDEX ix_voice_calls_sms_contact_id ON public.voice_calls USING btree (sms_contact_id)`
- `CREATE INDEX ix_voice_calls_booking_id ON public.voice_calls USING btree (booking_id)`

## public.voice_turns (table)

- `id integer = nextval('voice_turns_id_seq'::regclass)`
- `call_id integer`
- `n integer`
- `pipeline varchar(200)`
- `caller text = ''::text`
- `agent text = ''::text`
- `tools jsonb = '[]'::jsonb`
- `speculative boolean = false`
- `barged boolean = false`
- `final_ms integer null`
- `end_ms integer null`
- `token_ms integer null`
- `audio_ms integer null`
- `heard_ms integer null`
- `at timestamp with time zone = now()`

References:

- public.voice_calls (call_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_voice_turns ON public.voice_turns USING btree (id)`
- `CREATE UNIQUE INDEX uq_voice_turns_call_id_n ON public.voice_turns USING btree (call_id, n)`
- `CREATE INDEX ix_voice_turns_at ON public.voice_turns USING btree (at)`

## public.voice_call_records (view)

- `id integer null`
- `whose text null`
- `direction text null`
- `pipeline text null`
- `who text null`
- `number text null`
- `outcome text null`
- `turns integer null`
- `heard integer null`
- `started timestamp with time zone null`
- `seconds integer null`
- `message text null`
- `by text null`

## public.voice_latency (view)

- `id text null`
- `pipeline text null`
- `stage text null`
- `rank integer null`
- `p50 integer null`
- `p95 integer null`
- `turns integer null`
- `last timestamp with time zone null`

## public.flags (table)

- `key varchar(60)`
- `about text = ''::text`
- `variants text[] = '{off,on}'::text[]`
- `rules jsonb = '[]'::jsonb`
- `fallback varchar(40) = 'off'::character varying`
- `killed boolean = false`
- `surface varchar(8) = 'portal'::character varying`
- `created_by varchar(200)`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_flags ON public.flags USING btree (key)`

## public.flag_days (table)

- `flag varchar(60)`
- `day date`
- `variant varchar(40)`
- `channel varchar(40)`
- `visitors integer = 0`
- `forms integer = 0`
- `calls integer = 0`
- `paid integer = 0`
- `synced_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_flag_days ON public.flag_days USING btree (flag, day, variant, channel)`

## public.flag_experiments (table)

- `flag varchar(60)`
- `goal varchar(8)`
- `state varchar(10) = 'draft'::character varying`
- `shares jsonb = '{}'::jsonb`
- `p_best jsonb = '{}'::jsonb`
- `retired text[] = '{}'::text[]`
- `best varchar(40) null`
- `winner varchar(40) null`
- `started_at timestamp with time zone null`
- `started_by varchar(200) null`
- `ended_at timestamp with time zone null`
- `ended_by varchar(200) null`
- `decided_at timestamp with time zone null`
- `created_by varchar(200)`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

References:

- public.flags (flag → key)

Indexes:

- `CREATE UNIQUE INDEX pk_flag_experiments ON public.flag_experiments USING btree (flag)`

## public.grants (table)

- `id integer = nextval('grants_id_seq'::regclass)`
- `email text`
- `client varchar(40)`
- `verbs text[]`
- `apps text[] null`
- `channels text[] null`
- `record text null`
- `until timestamp with time zone null`
- `uses_left integer null`
- `reason text null`
- `by text`
- `at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_grants ON public.grants USING btree (id)`
- `CREATE INDEX ix_grants_email ON public.grants USING btree (email, client)`

## public.role_grants (table)

- `id integer = nextval('role_grants_id_seq'::regclass)`
- `role varchar(64)`
- `verbs text[]`
- `apps text[] null`
- `channels text[] null`
- `record text null`

References:

- public.roles (role → id)

Indexes:

- `CREATE UNIQUE INDEX pk_role_grants ON public.role_grants USING btree (id)`
- `CREATE INDEX ix_role_grants_role ON public.role_grants USING btree (role)`

## public.roles (table)

- `id varchar(64)`
- `client varchar(40) null`
- `name text`
- `about text null`
- `created_by text null`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_roles ON public.roles USING btree (id)`
- `CREATE INDEX ix_roles_client ON public.roles USING btree (client)`

## public.access_asks (table)

- `id integer = nextval('access_asks_id_seq'::regclass)`
- `email text`
- `client varchar(40)`
- `verbs text[]`
- `apps text[] null`
- `channels text[] null`
- `record text null`
- `until timestamp with time zone null`
- `reason text null`
- `at timestamp with time zone = now()`
- `decided_by text null`
- `decided_at timestamp with time zone null`
- `approved boolean null`
- `grant_id integer null`

References:

- public.grants (grant_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_access_asks ON public.access_asks USING btree (id)`
- `CREATE INDEX ix_access_asks_grant ON public.access_asks USING btree (grant_id)`
- `CREATE INDEX ix_access_asks_open ON public.access_asks USING btree (client, decided_at)`
- `CREATE INDEX ix_access_asks_email ON public.access_asks USING btree (email)`

## public.issues (table)

- `id integer = nextval('issues_id_seq'::regclass)`
- `client varchar(40)`
- `record text`
- `title text null`
- `app varchar(40)`
- `channel varchar(40) null`
- `body text`
- `by text`
- `at timestamp with time zone = now()`
- `resolved_by text null`
- `resolved_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_issues ON public.issues USING btree (id)`
- `CREATE INDEX ix_issues_record ON public.issues USING btree (client, record)`
- `CREATE INDEX ix_issues_open ON public.issues USING btree (client, resolved_at)`

## public.survey_answers (table)

- `id integer = nextval('survey_answers_id_seq'::regclass)`
- `survey varchar(60)`
- `client varchar(40)`
- `person varchar(200)`
- `value text`
- `at timestamp with time zone = now()`

References:

- public.clients (client → id)
- public.surveys (survey → key)

Indexes:

- `CREATE UNIQUE INDEX pk_survey_answers ON public.survey_answers USING btree (id)`
- `CREATE UNIQUE INDEX uq_survey_answers_survey_client_person ON public.survey_answers USING btree (survey, client, person)`
- `CREATE INDEX ix_survey_answers_client ON public.survey_answers USING btree (client)`

## public.survey_days (table)

- `survey varchar(60)`
- `day date`
- `value varchar(80)`
- `channel varchar(40)`
- `answers integer = 0`
- `synced_at timestamp with time zone = now()`

References:

- public.surveys (survey → key)

Indexes:

- `CREATE UNIQUE INDEX pk_survey_days ON public.survey_days USING btree (survey, day, value, channel)`

## public.surveys (table)

- `key varchar(60)`
- `question text`
- `kind varchar(8)`
- `choices text[] = '{}'::text[]`
- `surface varchar(8) = 'site'::character varying`
- `trigger jsonb = '{"on": "view"}'::jsonb`
- `audience jsonb = '{}'::jsonb`
- `state varchar(8) = 'draft'::character varying`
- `started_at timestamp with time zone null`
- `started_by varchar(200) null`
- `created_by varchar(200)`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_surveys ON public.surveys USING btree (key)`

## public.speed_runs (table)

- `id integer = nextval('speed_runs_id_seq'::regclass)`
- `workflow varchar(64)`
- `subject varchar(200)`
- `lead_at timestamp with time zone`
- `name text null`
- `phone varchar(64) null`
- `e164 varchar(16) null`
- `email text null`
- `source text null`
- `consent boolean`
- `consent_detail text null`
- `zone varchar(64) null`
- `sms_contact_id integer null`
- `first_touch varchar(16)`
- `first_touch_at timestamp with time zone null`
- `first_touch_detail text null`
- `call varchar(16) null`
- `call_at timestamp with time zone null`
- `call_detail text null`
- `booked_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `call_done_at timestamp with time zone null`
- `call_outcome varchar(16) null`
- `call_done_by text null`
- `first_due_at timestamp with time zone null`
- `email_at timestamp with time zone null`
- `email_detail text null`
- `notice_at timestamp with time zone null`

References:

- public.sms_contacts (sms_contact_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_speed_runs ON public.speed_runs USING btree (id)`
- `CREATE UNIQUE INDEX uq_speed_runs_workflow_subject ON public.speed_runs USING btree (workflow, subject)`
- `CREATE INDEX ix_speed_runs_sms_contact_id ON public.speed_runs USING btree (sms_contact_id)`
- `CREATE INDEX ix_speed_runs_lead_at ON public.speed_runs USING btree (lead_at)`

## public.call_briefs (table)

- `call_booking_id integer`
- `start timestamp with time zone null`
- `brief jsonb`
- `model varchar(64) null`
- `built_at timestamp with time zone`
- `sent_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

References:

- public.call_bookings (call_booking_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_call_briefs ON public.call_briefs USING btree (call_booking_id)`

## public.account_facts (table)

- `account_id integer`
- `fact varchar(80)`
- `state varchar(8)`
- `why text null`
- `seen jsonb null`
- `by varchar(320)`
- `checked_at timestamp with time zone = now()`
- `ok_at timestamp with time zone null`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_account_facts ON public.account_facts USING btree (account_id, fact)`

## public.client_accounts (table)

- `id integer = nextval('client_accounts_id_seq'::regclass)`
- `client varchar(40) null`
- `site varchar(32)`
- `ref varchar(200)`
- `role varchar(32) = 'main'::character varying`
- `mode varchar(8) = 'self'::character varying`
- `login varchar(120) null`
- `created_by text`
- `created_at timestamp with time zone = now()`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_client_accounts ON public.client_accounts USING btree (id)`
- `CREATE UNIQUE INDEX uq_client_accounts_ref ON public.client_accounts USING btree (client, site, ref) NULLS NOT DISTINCT`

## public.setup_runs (table)

- `id integer = nextval('setup_runs_id_seq'::regclass)`
- `account_id integer`
- `setup varchar(64)`
- `gen integer = 1`
- `mode varchar(8)`
- `state varchar(16)`
- `step varchar(40) null`
- `why text null`
- `rounds integer = 0`
- `started_at timestamp with time zone = now()`
- `step_since timestamp with time zone = now()`
- `done_at timestamp with time zone null`
- `next_check_at timestamp with time zone null`
- `by varchar(320)`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_setup_runs ON public.setup_runs USING btree (id)`
- `CREATE UNIQUE INDEX uq_setup_runs_account ON public.setup_runs USING btree (account_id, setup)`
- `CREATE INDEX ix_setup_runs_due ON public.setup_runs USING btree (state, next_check_at)`

## public.vendor_modes (table)

- `id integer = nextval('vendor_modes_id_seq'::regclass)`
- `client varchar(40) null`
- `vendor varchar(32)`
- `mode varchar(8)`
- `key_name varchar(200) null`
- `per_day integer = 0`
- `cap_cents integer = 0`
- `updated_by varchar(320)`
- `updated_at timestamp with time zone = now()`
- `purpose varchar(32) = 'default'::character varying`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_vendor_modes ON public.vendor_modes USING btree (id)`
- `CREATE UNIQUE INDEX uq_vendor_modes_owner ON public.vendor_modes USING btree (client, vendor, purpose) NULLS NOT DISTINCT`

## public.vendor_usage (table)

- `id bigint = nextval('vendor_usage_id_seq'::regclass)`
- `client varchar(40) null`
- `vendor varchar(32)`
- `mode varchar(8)`
- `bucket varchar(80)`
- `units integer`
- `micros bigint`
- `part varchar(64) null`
- `run_id uuid null`
- `at timestamp with time zone = now()`
- `key_id varchar(12) null`

Indexes:

- `CREATE UNIQUE INDEX pk_vendor_usage ON public.vendor_usage USING btree (id)`
- `CREATE INDEX ix_vendor_usage_bucket ON public.vendor_usage USING btree (bucket, at)`
- `CREATE INDEX ix_vendor_usage_owner ON public.vendor_usage USING btree (client, vendor, at)`
- `CREATE INDEX ix_vendor_usage_key ON public.vendor_usage USING btree (key_id, at)`

## public.workflow_installs (table)

- `id integer = nextval('workflow_installs_id_seq'::regclass)`
- `client varchar(40)`
- `template varchar(64)`
- `workflow varchar(64)`
- `version varchar(16)`
- `state varchar(16) = 'draft'::character varying`
- `applied jsonb`
- `hook uuid null`
- `by text`
- `at timestamp with time zone = now()`
- `asked_by text null`
- `asked_at timestamp with time zone null`
- `approved_by text null`
- `approved_at timestamp with time zone null`
- `removed_by text null`
- `removed_at timestamp with time zone null`

References:

- public.clients (client → id)
- public.hooks (hook → id)

Indexes:

- `CREATE UNIQUE INDEX pk_workflow_installs ON public.workflow_installs USING btree (id)`
- `CREATE UNIQUE INDEX uq_workflow_installs_client_template ON public.workflow_installs USING btree (client, template)`
- `CREATE INDEX ix_workflow_installs_hook ON public.workflow_installs USING btree (hook)`

## public.email_campaign_records (view)

- `id text null`
- `enrolled bigint null`
- `reached bigint null`
- `sent bigint null`
- `replies bigint null`
- `interested bigint null`
- `bounces bigint null`
- `last_sent timestamp with time zone null`

## public.email_reply_records (view)

- `id integer null`
- `state text null`
- `who text null`
- `company text null`
- `domain text null`
- `email text null`
- `subject text null`
- `words text null`
- `draft text null`
- `start timestamp with time zone null`
- `time_zone text null`
- `detail text null`
- `niche text null`
- `received timestamp with time zone null`

## public.unit_holds_now (view)

- `id integer null`
- `stage varchar(64) null`
- `subject varchar(200) null`
- `reason text null`
- `state text null`
- `held_at timestamp with time zone null`
- `until timestamp with time zone null`
- `tries integer null`
- `released_at timestamp with time zone null`
- `released_by varchar(320) null`
- `title text null`

## public.workflow_templates (table)

- `id varchar(64)`
- `name varchar(1200)`
- `blurb text = ''::text`
- `workflow varchar(64)`
- `edits jsonb null`
- `from_client varchar(40) null`
- `by text`
- `at timestamp with time zone = now()`

References:

- public.clients (from_client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_workflow_templates ON public.workflow_templates USING btree (id)`
- `CREATE INDEX ix_workflow_templates_from_client ON public.workflow_templates USING btree (from_client)`

## public.executor_events (view)

- `id text null`
- `workflow varchar(64) null`
- `node varchar(200) null`
- `port varchar(64) null`
- `subject varchar(200) null`
- `kind varchar(16) null`
- `state text null`
- `at timestamp with time zone null`
- `due timestamp with time zone null`
- `until varchar null`
- `error text null`

## public.draft_events (table)

- `id integer = nextval('draft_events_id_seq'::regclass)`
- `item varchar(200)`
- `round integer = 1`
- `kind varchar(16)`
- `platform varchar(16) null`
- `event varchar(16)`
- `via varchar(8)`
- `by varchar(200) null`
- `text text null`
- `title text null`
- `ask text null`
- `reason varchar(16) null`
- `note text null`
- `llm jsonb null`
- `slot timestamp with time zone null`
- `external_id varchar(255) null`
- `url text null`
- `meta jsonb = '{}'::jsonb`
- `run_id uuid null`
- `ref varchar(200) null`
- `at timestamp with time zone = now()`

References:

- public.platform_objects (platform → platform, external_id → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_draft_events ON public.draft_events USING btree (id)`
- `CREATE UNIQUE INDEX uq_draft_events_ref ON public.draft_events USING btree (ref)`
- `CREATE INDEX ix_draft_events_item_id ON public.draft_events USING btree (item, id)`
- `CREATE INDEX ix_draft_events_kind_at ON public.draft_events USING btree (kind, at)`
- `CREATE INDEX ix_draft_events_platform_external_id ON public.draft_events USING btree (platform, external_id)`

## public.reach_invites (view)

- `id integer null`
- `contact_id integer null`
- `account_id uuid null`
- `handle varchar(120) null`
- `url text null`
- `name text null`
- `headline text null`
- `niche varchar(32) null`
- `person_id integer null`
- `company_id integer null`
- `found_in varchar(200) null`
- `fit jsonb null`
- `note text null`
- `status varchar null`
- `state_reason text null`
- `queued_at timestamp with time zone null`
- `sent_at timestamp with time zone null`
- `connected_at timestamp with time zone null`
- `withdrawn_at timestamp with time zone null`

## public.reach_posts (table)

- `id integer = nextval('reach_posts_id_seq'::regclass)`
- `ref varchar(255)`
- `author text`
- `author_url text null`
- `headline text null`
- `text text`
- `url text`
- `posted_at timestamp with time zone null`
- `reactions integer = 0`
- `comments integer = 0`
- `found_by varchar(200)`
- `account varchar(80)`
- `fit smallint null`
- `why text null`
- `state varchar(12) = 'found'::character varying`
- `state_reason text null`
- `draft text null`
- `queued_at timestamp with time zone null`
- `comment text null`
- `commented_at timestamp with time zone null`
- `commented_by varchar(120) null`
- `raw jsonb`
- `created_at timestamp with time zone = now()`
- `platform varchar(12) = 'linkedin'::character varying`
- `handle varchar(120) null`
- `liked_at timestamp with time zone null`
- `followed_at timestamp with time zone null`
- `send_at timestamp with time zone null`

References:

- public.platform_objects (platform → platform, ref → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_reach_posts ON public.reach_posts USING btree (id)`
- `CREATE INDEX ix_reach_posts_state ON public.reach_posts USING btree (state)`
- `CREATE UNIQUE INDEX uq_reach_posts_platform_ref ON public.reach_posts USING btree (platform, ref)`

## public.setup_alerts (table)

- `id integer = nextval('setup_alerts_id_seq'::regclass)`
- `key varchar(200)`
- `client varchar(40) null`
- `account_id integer`
- `kind varchar(8)`
- `for varchar(8)`
- `level varchar(8)`
- `setup varchar(64) null`
- `step varchar(40) null`
- `fact varchar(80) null`
- `part varchar(64) null`
- `title text`
- `body text null`
- `at timestamp with time zone = now()`
- `cleared_at timestamp with time zone null`
- `told_at timestamp with time zone null`
- `digest_at timestamp with time zone null`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_setup_alerts ON public.setup_alerts USING btree (id)`
- `CREATE UNIQUE INDEX uq_setup_alerts_key ON public.setup_alerts USING btree (key)`
- `CREATE INDEX ix_setup_alerts_open ON public.setup_alerts USING btree (client, cleared_at)`
- `CREATE INDEX ix_setup_alerts_account ON public.setup_alerts USING btree (account_id, at)`

## public.note_links (table)

- `note_id uuid`
- `target varchar(300)`
- `label varchar(3000) = ''::character varying`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_links ON public.note_links USING btree (note_id, target)`
- `CREATE INDEX ix_note_links_target ON public.note_links USING btree (target)`

## public.note_seen (table)

- `note_id uuid`
- `email varchar(200)`
- `at timestamp with time zone = now()`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_seen ON public.note_seen USING btree (note_id, email)`
- `CREATE INDEX ix_note_seen_email ON public.note_seen USING btree (email, at)`

## public.note_shares (table)

- `note_id uuid`
- `who varchar(200)`
- `role varchar(8)`
- `by varchar(200)`
- `at timestamp with time zone = now()`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_shares ON public.note_shares USING btree (note_id, who)`
- `CREATE INDEX ix_note_shares_who ON public.note_shares USING btree (who)`

## public.note_stars (table)

- `note_id uuid`
- `email varchar(200)`
- `at timestamp with time zone = now()`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_stars ON public.note_stars USING btree (note_id, email)`

## public.note_updates (table)

- `id integer = nextval('note_updates_id_seq'::regclass)`
- `note_id uuid`
- `update bytea`
- `by varchar(200)`
- `at timestamp with time zone = now()`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_updates ON public.note_updates USING btree (id)`
- `CREATE INDEX ix_note_updates_note ON public.note_updates USING btree (note_id, id)`

## public.note_versions (table)

- `id integer = nextval('note_versions_id_seq'::regclass)`
- `note_id uuid`
- `number integer`
- `kind varchar(8)`
- `name varchar(2000) null`
- `title varchar(3000) = ''::character varying`
- `body jsonb`
- `text text`
- `authors text[] = '{}'::text[]`
- `started_at timestamp with time zone = now()`
- `at timestamp with time zone = now()`
- `restored_from integer null`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_versions ON public.note_versions USING btree (id)`
- `CREATE UNIQUE INDEX uq_note_versions_number ON public.note_versions USING btree (note_id, number)`

## public.notes (table)

- `id uuid = gen_random_uuid()`
- `parent_id uuid null`
- `kind varchar(8) = 'note'::character varying`
- `title varchar(3000) = ''::character varying`
- `body jsonb = '{"type": "doc", "content": []}'::jsonb`
- `text text = ''::text`
- `y_state bytea null`
- `owner varchar(200)`
- `created_by varchar(200)`
- `via varchar(8) = 'person'::character varying`
- `general varchar(12) = 'private'::character varying`
- `general_role varchar(8) = 'view'::character varying`
- `train boolean = false`
- `archived_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `edited_by varchar(200) null`
- `board_id uuid null`
- `column_id varchar(40) null`
- `position varchar(64) null`
- `assignee varchar(200) null`
- `due date null`
- `closed_at timestamp with time zone null`
- `labels text[] = '{}'::text[]`
- `version integer = 1`
- `search tsvector null`

References:

- public.notes (parent_id → id)
- public.boards (board_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_notes ON public.notes USING btree (id)`
- `CREATE INDEX ix_notes_owner ON public.notes USING btree (owner, updated_at)`
- `CREATE INDEX ix_notes_updated ON public.notes USING btree (updated_at)`
- `CREATE INDEX ix_notes_parent ON public.notes USING btree (parent_id)`
- `CREATE UNIQUE INDEX uq_notes_dump ON public.notes USING btree (owner) WHERE ((kind)::text = 'dump'::text)`
- `CREATE INDEX ix_notes_board ON public.notes USING btree (board_id, column_id)`
- `CREATE INDEX ix_notes_assignee ON public.notes USING btree (assignee) WHERE (assignee IS NOT NULL)`
- `CREATE INDEX ix_notes_search ON public.notes USING gin (search)`

## public.notes_settings (table)

- `id integer = 1`
- `train boolean = false`
- `updated_by varchar(200) null`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_notes_settings ON public.notes_settings USING btree (id)`

## public.note_comments (table)

- `id uuid = gen_random_uuid()`
- `note_id uuid`
- `parent_id uuid null`
- `anchor jsonb null`
- `quote varchar(5000) = ''::character varying`
- `body text`
- `mentions text[] = '{}'::text[]`
- `by varchar(200)`
- `at timestamp with time zone = now()`
- `edited_at timestamp with time zone null`
- `resolved_at timestamp with time zone null`
- `resolved_by varchar(200) null`

References:

- public.notes (note_id → id)
- public.note_comments (parent_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_comments ON public.note_comments USING btree (id)`
- `CREATE INDEX ix_note_comments_note ON public.note_comments USING btree (note_id, at)`
- `CREATE INDEX ix_note_comments_parent ON public.note_comments USING btree (parent_id)`

## public.note_mentions (table)

- `id uuid = gen_random_uuid()`
- `note_id uuid null`
- `comment_id uuid null`
- `who varchar(200)`
- `by varchar(200)`
- `at timestamp with time zone = now()`
- `seen_at timestamp with time zone null`
- `inbox_note_id uuid null`
- `mailed_at timestamp with time zone null`

References:

- public.notes (note_id → id)
- public.note_comments (comment_id → id)
- public.inbox_notes (inbox_note_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_mentions ON public.note_mentions USING btree (id)`
- `CREATE INDEX ix_note_mentions_who ON public.note_mentions USING btree (who, at)`
- `CREATE INDEX ix_note_mentions_note ON public.note_mentions USING btree (note_id)`
- `CREATE INDEX ix_note_mentions_comment ON public.note_mentions USING btree (comment_id)`
- `CREATE INDEX ix_note_mentions_inbox_note ON public.note_mentions USING btree (inbox_note_id)`
- `CREATE INDEX ix_note_mentions_unmailed ON public.note_mentions USING btree (at) WHERE ((mailed_at IS NULL) AND (seen_at IS NULL))`

## public.site_events (table)

- `id bigint = nextval('site_events_id_seq'::regclass)`
- `page uuid null`
- `at timestamp with time zone = now()`
- `view varchar(36)`
- `name varchar(8)`
- `channel varchar(10)`
- `source varchar(120) null`
- `medium varchar(120) null`
- `campaign varchar(120) null`
- `content varchar(120) null`
- `ref varchar(200) null`
- `width integer null`
- `form uuid null`
- `split uuid null`
- `step smallint null`
- `form_split uuid null`
- `arm varchar(1) null`

References:

- public.site_pages (page → id)
- public.site_form_defs (form → id)
- public.site_splits (split → id)
- public.site_form_splits (form_split → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_events ON public.site_events USING btree (id)`
- `CREATE INDEX ix_site_events_page_at ON public.site_events USING btree (page, at)`
- `CREATE INDEX ix_site_events_form_at ON public.site_events USING btree (form, at)`
- `CREATE INDEX ix_site_events_split ON public.site_events USING btree (split) WHERE (split IS NOT NULL)`
- `CREATE INDEX ix_site_events_form_split ON public.site_events USING btree (form_split) WHERE (form_split IS NOT NULL)`

## public.site_forms (table)

- `id uuid = gen_random_uuid()`
- `page uuid null`
- `at timestamp with time zone = now()`
- `fields jsonb`
- `touch jsonb`
- `channel varchar(10)`
- `entered boolean = false`
- `why text null`
- `form uuid null`
- `consent jsonb null`
- `visitor varchar(64) null`
- `human varchar(4) null`
- `split uuid null`
- `form_split uuid null`
- `arm varchar(1) null`
- `pages jsonb null`

References:

- public.site_pages (page → id)
- public.site_form_defs (form → id)
- public.site_splits (split → id)
- public.site_form_splits (form_split → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_forms ON public.site_forms USING btree (id)`
- `CREATE INDEX ix_site_forms_page_at ON public.site_forms USING btree (page, at)`
- `CREATE INDEX ix_site_forms_form_at ON public.site_forms USING btree (form, at)`
- `CREATE INDEX ix_site_forms_split ON public.site_forms USING btree (split) WHERE (split IS NOT NULL)`
- `CREATE INDEX ix_site_forms_form_split ON public.site_forms USING btree (form_split) WHERE (form_split IS NOT NULL)`

## public.site_page_versions (table)

- `page uuid`
- `number integer`
- `content jsonb`
- `origin varchar(8)`
- `why text null`
- `by text`
- `at timestamp with time zone = now()`

References:

- public.site_pages (page → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_page_versions ON public.site_page_versions USING btree (page, number)`

## public.site_pages (table)

- `id uuid = gen_random_uuid()`
- `client varchar(40) null`
- `slug varchar(80)`
- `title varchar(2000)`
- `kind varchar(12)`
- `source varchar(8)`
- `url text null`
- `repo_path text null`
- `template varchar(16) null`
- `offer varchar(64) null`
- `angle varchar(1200) null`
- `audience varchar(120) null`
- `variant_of uuid null`
- `stage varchar(8) = 'convert'::character varying`
- `status varchar(8) = 'draft'::character varying`
- `live_version integer null`
- `draft_version integer null`
- `waiting_version integer null`
- `waiting_by text null`
- `waiting_at timestamp with time zone null`
- `preview_token varchar(43)`
- `hook uuid null`
- `notes text null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `updated_at timestamp with time zone = now()`
- `updated_by text`
- `retire_by text null`
- `retire_at timestamp with time zone null`

References:

- public.clients (client → id)
- public.hooks (hook → id)
- public.site_pages (variant_of → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_pages ON public.site_pages USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_pages_slug ON public.site_pages USING btree (COALESCE(client, ''::character varying), slug)`
- `CREATE UNIQUE INDEX uq_site_pages_url ON public.site_pages USING btree (url) WHERE (url IS NOT NULL)`
- `CREATE INDEX ix_site_pages_client ON public.site_pages USING btree (client)`
- `CREATE INDEX ix_site_pages_offer ON public.site_pages USING btree (offer)`
- `CREATE INDEX ix_site_pages_variant_of ON public.site_pages USING btree (variant_of)`
- `CREATE INDEX ix_site_pages_hook ON public.site_pages USING btree (hook)`

## public.social_handles (table)

- `id integer = nextval('social_handles_id_seq'::regclass)`
- `platform varchar(16)`
- `handle varchar(200)`
- `url text null`
- `name text null`
- `person_id integer null`
- `lead_id integer null`
- `linked_by varchar(16) null`
- `linked_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

References:

- public.leads (lead_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_social_handles ON public.social_handles USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_handles_platform_handle ON public.social_handles USING btree (platform, handle)`
- `CREATE INDEX ix_social_handles_person_id ON public.social_handles USING btree (person_id)`
- `CREATE INDEX ix_social_handles_lead_id ON public.social_handles USING btree (lead_id)`

## public.touches (table)

- `id integer = nextval('touches_id_seq'::regclass)`
- `handle_id integer`
- `kind varchar(16)`
- `direction varchar(8)`
- `account varchar(120) null`
- `url text null`
- `text text null`
- `at timestamp with time zone`
- `response varchar(16) null`
- `response_at timestamp with time zone null`
- `answers integer null`
- `external_id varchar(200) null`
- `source varchar(32)`
- `ref varchar(200)`
- `created_at timestamp with time zone = now()`
- `link text null`

References:

- public.social_handles (handle_id → id)
- public.touches (answers → id)

Indexes:

- `CREATE UNIQUE INDEX pk_touches ON public.touches USING btree (id)`
- `CREATE UNIQUE INDEX uq_touches_ref ON public.touches USING btree (ref)`
- `CREATE INDEX ix_touches_handle_id_at ON public.touches USING btree (handle_id, at)`
- `CREATE INDEX ix_touches_answers ON public.touches USING btree (answers)`
- `CREATE INDEX ix_touches_external_id ON public.touches USING btree (external_id) WHERE (external_id IS NOT NULL)`

## public.webhook_attempts (table)

- `id integer = nextval('webhook_attempts_id_seq'::regclass)`
- `delivery uuid`
- `n integer`
- `status integer null`
- `latency_ms integer`
- `response text null`
- `error text null`
- `at timestamp with time zone = now()`

References:

- public.webhook_deliveries (delivery → id)

Indexes:

- `CREATE UNIQUE INDEX pk_webhook_attempts ON public.webhook_attempts USING btree (id)`
- `CREATE INDEX ix_webhook_attempts_delivery ON public.webhook_attempts USING btree (delivery, n)`

## public.webhook_deliveries (table)

- `id uuid = gen_random_uuid()`
- `subscription uuid`
- `event varchar(40)`
- `event_id varchar(80)`
- `payload jsonb`
- `state varchar(12) = 'pending'::character varying`
- `attempts integer = 0`
- `status integer null`
- `latency_ms integer null`
- `response text null`
- `error text null`
- `at timestamp with time zone = now()`
- `last_at timestamp with time zone null`
- `next_at timestamp with time zone null`

References:

- public.webhook_subscriptions (subscription → id)

Indexes:

- `CREATE UNIQUE INDEX pk_webhook_deliveries ON public.webhook_deliveries USING btree (id)`
- `CREATE UNIQUE INDEX uq_webhook_deliveries_event ON public.webhook_deliveries USING btree (subscription, event_id)`
- `CREATE INDEX ix_webhook_deliveries_subscription_at ON public.webhook_deliveries USING btree (subscription, at)`

## public.webhook_subscriptions (table)

- `id uuid = gen_random_uuid()`
- `client varchar(40) null`
- `name text`
- `url text`
- `events text[]`
- `secret text`
- `prev_secret text null`
- `prev_until timestamp with time zone null`
- `active boolean = true`
- `by text`
- `at timestamp with time zone = now()`
- `rotated_at timestamp with time zone null`
- `failing_since timestamp with time zone null`
- `disabled_at timestamp with time zone null`
- `disabled_why text null`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_webhook_subscriptions ON public.webhook_subscriptions USING btree (id)`
- `CREATE INDEX ix_webhook_subscriptions_client ON public.webhook_subscriptions USING btree (client)`

## public.review_asks (table)

- `id integer = nextval('review_asks_id_seq'::regclass)`
- `subject varchar(200)`
- `source varchar(8)`
- `name text null`
- `phone varchar(64) null`
- `e164 varchar(16) null`
- `email text null`
- `token varchar(32)`
- `place_id varchar(200) null`
- `contact_id integer null`
- `ask varchar(16)`
- `ask_at timestamp with time zone`
- `ask_detail text null`
- `reminder varchar(16) null`
- `reminder_at timestamp with time zone null`
- `reminder_detail text null`
- `clicks integer = 0`
- `clicked_at timestamp with time zone null`
- `feedback text null`
- `feedback_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `via varchar(8) = 'text'::character varying`
- `sent_at timestamp with time zone null`

References:

- public.sms_contacts (contact_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_review_asks ON public.review_asks USING btree (id)`
- `CREATE UNIQUE INDEX uq_review_asks_subject ON public.review_asks USING btree (subject)`
- `CREATE UNIQUE INDEX uq_review_asks_token ON public.review_asks USING btree (token)`
- `CREATE INDEX ix_review_asks_ask_at ON public.review_asks USING btree (ask_at)`
- `CREATE INDEX ix_review_asks_e164 ON public.review_asks USING btree (e164)`
- `CREATE INDEX ix_review_asks_contact_id ON public.review_asks USING btree (contact_id)`
- `CREATE INDEX ix_review_asks_email ON public.review_asks USING btree (email)`

## public.sms_calls (table)

- `id integer = nextval('sms_calls_id_seq'::regclass)`
- `call_id varchar(128)`
- `from_e164 varchar(32)`
- `to_e164 varchar(32)`
- `number_id uuid null`
- `started_at timestamp with time zone`
- `answered_at timestamp with time zone null`
- `bridged_at timestamp with time zone null`
- `ended_at timestamp with time zone null`
- `cause varchar(32) null`
- `result varchar(16) null`
- `known boolean null`
- `contact_id integer null`
- `text_back varchar(16) null`
- `text_back_at timestamp with time zone null`
- `text_back_detail text null`
- `replied_at timestamp with time zone null`
- `booked_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

References:

- public.sms_contacts (contact_id → id)
- public.sms_numbers (number_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_sms_calls ON public.sms_calls USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_calls_call_id ON public.sms_calls USING btree (call_id)`
- `CREATE INDEX ix_sms_calls_from_text_back ON public.sms_calls USING btree (from_e164, text_back_at)`
- `CREATE INDEX ix_sms_calls_contact_id ON public.sms_calls USING btree (contact_id)`
- `CREATE INDEX ix_sms_calls_number_id ON public.sms_calls USING btree (number_id)`
- `CREATE INDEX ix_sms_calls_started_at ON public.sms_calls USING btree (started_at)`

## public.inbox_replies (table)

- `id integer = nextval('inbox_replies_id_seq'::regclass)`
- `thread varchar(80)`
- `channel varchar(8)`
- `target varchar(80)`
- `who text null`
- `body text`
- `why text null`
- `state varchar(8) = 'waiting'::character varying`
- `detail text null`
- `asked_by varchar(200)`
- `asked_at timestamp with time zone = now()`
- `decided_by varchar(200) null`
- `decided_at timestamp with time zone null`
- `send_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_inbox_replies ON public.inbox_replies USING btree (id)`
- `CREATE INDEX ix_inbox_replies_state ON public.inbox_replies USING btree (state, asked_at)`
- `CREATE INDEX ix_inbox_replies_thread ON public.inbox_replies USING btree (thread)`

## public.inbox_threads (table)

- `thread varchar(80)`
- `assignee varchar(200) null`
- `status varchar(8) null`
- `status_at timestamp with time zone null`
- `snooze_until timestamp with time zone null`
- `updated_by varchar(200)`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_inbox_threads ON public.inbox_threads USING btree (thread)`
- `CREATE INDEX ix_inbox_threads_assignee ON public.inbox_threads USING btree (assignee)`

## public.inbox_notes (table)

- `id uuid = gen_random_uuid()`
- `thread varchar(80)`
- `person_id integer null`
- `body text`
- `by varchar(200)`
- `at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_inbox_notes ON public.inbox_notes USING btree (id)`
- `CREATE INDEX ix_inbox_notes_thread ON public.inbox_notes USING btree (thread, at)`
- `CREATE INDEX ix_inbox_notes_person ON public.inbox_notes USING btree (person_id)`

## public.site_form_defs (table)

- `id uuid = gen_random_uuid()`
- `client varchar(40) null`
- `slug varchar(80)`
- `name varchar(2000)`
- `status varchar(8) = 'draft'::character varying`
- `spec jsonb`
- `hook uuid null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.clients (client → id)
- public.hooks (hook → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_form_defs ON public.site_form_defs USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_form_defs_slug ON public.site_form_defs USING btree (COALESCE(client, ''::character varying), slug)`
- `CREATE INDEX ix_site_form_defs_client ON public.site_form_defs USING btree (client)`
- `CREATE INDEX ix_site_form_defs_hook ON public.site_form_defs USING btree (hook)`

## public.pay_accounts (table)

- `client varchar(40)`
- `endpoint varchar(80) null`
- `secret_name text null`
- `how varchar(8) null`
- `live boolean null`
- `updated_at timestamp with time zone = now()`
- `updated_by text`
- `note text null`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_pay_accounts ON public.pay_accounts USING btree (client)`

## public.pay_events (table)

- `id varchar(80)`
- `client varchar(40)`
- `type varchar(80)`
- `link uuid null`
- `result varchar(16)`
- `seen jsonb`
- `at timestamp with time zone = now()`

References:

- public.clients (client → id)
- public.pay_links (link → id)

Indexes:

- `CREATE UNIQUE INDEX pk_pay_events ON public.pay_events USING btree (id)`
- `CREATE INDEX ix_pay_events_client_at ON public.pay_events USING btree (client, at)`
- `CREATE INDEX ix_pay_events_link ON public.pay_events USING btree (link)`

## public.pay_links (table)

- `id uuid = gen_random_uuid()`
- `client varchar(40)`
- `contact integer null`
- `email text null`
- `name text null`
- `channel varchar(8)`
- `description varchar(200)`
- `amount_cents integer`
- `quantity integer = 1`
- `currency varchar(3) = 'usd'::character varying`
- `status varchar(16) = 'waiting'::character varying`
- `why text null`
- `stripe_link varchar(80) null`
- `url text null`
- `message bigint null`
- `sent_at timestamp with time zone null`
- `paid_cents integer null`
- `paid_at timestamp with time zone null`
- `session varchar(80) null`
- `live boolean null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `approved_at timestamp with time zone null`
- `approved_by text null`
- `document uuid null`
- `intent varchar(80) null`
- `refunded_cents integer = 0`
- `refunded_at timestamp with time zone null`
- `dispute varchar(8) null`
- `dispute_at bigint null`
- `checked_at timestamp with time zone null`
- `told jsonb = '{}'::jsonb`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_pay_links ON public.pay_links USING btree (id)`
- `CREATE INDEX ix_pay_links_client_created ON public.pay_links USING btree (client, created_at)`
- `CREATE UNIQUE INDEX uq_pay_links_stripe_link ON public.pay_links USING btree (stripe_link)`
- `CREATE INDEX ix_pay_links_document ON public.pay_links USING btree (document)`
- `CREATE INDEX ix_pay_links_status ON public.pay_links USING btree (status)`
- `CREATE INDEX ix_pay_links_intent ON public.pay_links USING btree (intent)`

## public.mail_connections (table)

- `account_id integer`
- `provider varchar(12)`
- `address varchar(320)`
- `org varchar(255) null`
- `scopes text`
- `access varchar(8)`
- `token_name varchar(255)`
- `state varchar(12) = 'connected'::character varying`
- `why text null`
- `connected_at timestamp with time zone = now()`
- `checked_at timestamp with time zone null`
- `by varchar(320)`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_mail_connections ON public.mail_connections USING btree (account_id)`

## public.mail_consents (table)

- `account_id integer`
- `tenant varchar(64)`
- `scopes text`
- `by varchar(320)`
- `consented_at timestamp with time zone = now()`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_mail_consents ON public.mail_consents USING btree (account_id)`

## public.mail_grants (table)

- `state varchar(64)`
- `kind varchar(8)`
- `provider varchar(12)`
- `account_id integer`
- `want varchar(8)`
- `verifier varchar(128) null`
- `by varchar(320)`
- `created_at timestamp with time zone = now()`
- `expires_at timestamp with time zone`
- `used_at timestamp with time zone null`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_mail_grants ON public.mail_grants USING btree (state)`
- `CREATE INDEX ix_mail_grants_account ON public.mail_grants USING btree (account_id)`

## public.client_secret_events (table)

- `id bigint = nextval('client_secret_events_id_seq'::regclass)`
- `at timestamp with time zone = now()`
- `secret varchar(35)`
- `client varchar(40)`
- `name varchar(64)`
- `op varchar(8)`
- `by varchar(320)`
- `why text null`

Indexes:

- `CREATE UNIQUE INDEX pk_client_secret_events ON public.client_secret_events USING btree (id)`
- `CREATE INDEX ix_client_secret_events_client_at ON public.client_secret_events USING btree (client, at)`

## public.client_secrets (table)

- `id varchar(35)`
- `client varchar(40)`
- `name varchar(64)`
- `state varchar(8)`
- `kid varchar(16)`
- `wrapped bytea`
- `sealed bytea`
- `last4 varchar(4)`
- `version integer = 1`
- `bound_from varchar(35) null`
- `created_at timestamp with time zone = now()`
- `created_by varchar(320)`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(320)`
- `label varchar(64) = 'default'::character varying`
- `key_id varchar(12) null`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_client_secrets ON public.client_secrets USING btree (id)`
- `CREATE UNIQUE INDEX uq_client_secrets_live ON public.client_secrets USING btree (client, name, label) WHERE ((state)::text = 'live'::text)`

## public.site_hops (table)

- `id bigint = nextval('site_hops_id_seq'::regclass)`
- `client varchar(40) null`
- `at timestamp with time zone = now()`
- `link varchar(80)`
- `channel varchar(10)`
- `source varchar(120) null`
- `medium varchar(120) null`
- `campaign varchar(120) null`
- `content varchar(120) null`
- `to varchar(200)`
- `page uuid null`
- `ref varchar(200) null`

References:

- public.clients (client → id)
- public.site_pages (page → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_hops ON public.site_hops USING btree (id)`
- `CREATE INDEX ix_site_hops_client_at ON public.site_hops USING btree (client, at)`
- `CREATE INDEX ix_site_hops_page_at ON public.site_hops USING btree (page, at)`

## public.site_split_arms (table)

- `split uuid`
- `label varchar(2)`
- `page uuid`
- `weight integer`

References:

- public.site_pages (page → id)
- public.site_splits (split → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_split_arms ON public.site_split_arms USING btree (split, label)`
- `CREATE UNIQUE INDEX uq_site_split_arms_page ON public.site_split_arms USING btree (split, page)`
- `CREATE INDEX ix_site_split_arms_page ON public.site_split_arms USING btree (page)`

## public.site_splits (table)

- `id uuid = gen_random_uuid()`
- `client varchar(40) null`
- `page uuid`
- `state varchar(10) = 'running'::character varying`
- `goal varchar(8) = 'forms'::character varying`
- `winner varchar(2) null`
- `ship_version integer null`
- `started_at timestamp with time zone = now()`
- `started_by text`
- `ended_at timestamp with time zone null`
- `ended_by text null`
- `updated_at timestamp with time zone = now()`

References:

- public.clients (client → id)
- public.site_pages (page → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_splits ON public.site_splits USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_splits_live ON public.site_splits USING btree (page) WHERE ((state)::text = ANY ((ARRAY['running'::character varying, 'shipping'::character varying])::text[]))`
- `CREATE INDEX ix_site_splits_client ON public.site_splits USING btree (client)`

## public.account_metric_days (table)

- `platform varchar(16)`
- `day date`
- `metric varchar(32)`
- `key varchar(200) = ''::character varying`
- `value double precision`
- `fetched_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_account_metric_days ON public.account_metric_days USING btree (platform, day, metric, key)`

## public.content_digests (table)

- `week date`
- `platform varchar(16)`
- `lines jsonb`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_content_digests ON public.content_digests USING btree (week, platform)`

## public.metric_sources (table)

- `platform varchar(16)`
- `metric varchar(32)`
- `state varchar(16)`
- `why text null`
- `checked_at timestamp with time zone = now()`
- `live_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_metric_sources ON public.metric_sources USING btree (platform, metric)`

## public.post_metric_days (table)

- `draft_id uuid`
- `day date`
- `metric varchar(32)`
- `key varchar(200) = ''::character varying`
- `value double precision`
- `fetched_at timestamp with time zone = now()`

References:

- public.content_drafts (draft_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_post_metric_days ON public.post_metric_days USING btree (draft_id, day, metric, key)`

## public.link_days (table)

- `day date`
- `source varchar(40)`
- `campaign varchar(100)`
- `content varchar(100)`
- `clicks integer`
- `hops integer`
- `forms_first integer`
- `forms_last integer`
- `calls_first integer`
- `calls_last integer`
- `won_first integer`
- `won_last integer`
- `revenue_first integer`
- `revenue_last integer`
- `synced_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_link_days ON public.link_days USING btree (day, source, campaign, content)`
- `CREATE INDEX ix_link_days_content ON public.link_days USING btree (content)`

## public.site_links (table)

- `id uuid = gen_random_uuid()`
- `client varchar(40) null`
- `page uuid`
- `link varchar(80)`
- `source varchar(120)`
- `medium varchar(120)`
- `channel varchar(10)`
- `campaign varchar(80)`
- `content varchar(80) null`
- `name varchar(2000) null`
- `created_at timestamp with time zone = now()`
- `created_by text`

References:

- public.clients (client → id)
- public.site_pages (page → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_links ON public.site_links USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_links_utm ON public.site_links USING btree (COALESCE(client, ''::character varying), page, link, campaign, COALESCE(content, ''::character varying))`
- `CREATE INDEX ix_site_links_client ON public.site_links USING btree (client)`
- `CREATE INDEX ix_site_links_page ON public.site_links USING btree (page)`

## public.social_connections (table)

- `id integer = nextval('social_connections_id_seq'::regclass)`
- `client varchar(64)`
- `platform varchar(16)`
- `account_id integer`
- `external_id varchar(128)`
- `name text null`
- `handle varchar(120) null`
- `scopes text`
- `token_ref varchar(64)`
- `expires_at timestamp with time zone null`
- `extra jsonb = '{}'::jsonb`
- `state varchar(12) = 'connected'::character varying`
- `why text null`
- `connected_at timestamp with time zone = now()`
- `checked_at timestamp with time zone null`
- `by varchar(320)`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_social_connections ON public.social_connections USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_connections_account ON public.social_connections USING btree (client, platform, external_id)`
- `CREATE INDEX ix_social_connections_account ON public.social_connections USING btree (account_id)`

## public.social_grants (table)

- `state varchar(64)`
- `client varchar(64)`
- `platform varchar(16)`
- `verifier varchar(128) null`
- `by varchar(320)`
- `created_at timestamp with time zone = now()`
- `expires_at timestamp with time zone`
- `used_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_social_grants ON public.social_grants USING btree (state)`
- `CREATE INDEX ix_social_grants_client ON public.social_grants USING btree (client)`

## public.post_variants (table)

- `id integer = nextval('post_variants_id_seq'::regclass)`
- `draft_id uuid`
- `field varchar(16)`
- `value text`
- `state varchar(16)`
- `source varchar(16)`
- `why text null`
- `asked_by varchar(200) null`
- `asked_at timestamp with time zone = now()`
- `decided_by varchar(200) null`
- `started_at timestamp with time zone null`
- `ended_at timestamp with time zone null`

References:

- public.content_drafts (draft_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_post_variants ON public.post_variants USING btree (id)`
- `CREATE INDEX ix_post_variants_draft_id_field ON public.post_variants USING btree (draft_id, field)`
- `CREATE UNIQUE INDEX uq_post_variants_live ON public.post_variants USING btree (draft_id, field) WHERE ((state)::text = 'live'::text)`

## public.draft_outcomes (view)

- `item text null`
- `measured timestamp with time zone null`
- `views integer null`
- `reactions integer null`
- `comments integer null`
- `shares integer null`
- `follows integer null`
- `snapshots integer null`
- `replies jsonb null`

## public.draft_people (view)

- `item text null`
- `name varchar null`

## public.site_form_splits (table)

- `id uuid = gen_random_uuid()`
- `client varchar(40) null`
- `form uuid`
- `state varchar(8) = 'running'::character varying`
- `b jsonb`
- `weight integer = 50`
- `winner varchar(1) null`
- `started_at timestamp with time zone = now()`
- `started_by text`
- `ended_at timestamp with time zone null`
- `ended_by text null`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.clients (client → id)
- public.site_form_defs (form → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_form_splits ON public.site_form_splits USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_form_splits_running ON public.site_form_splits USING btree (form) WHERE ((state)::text = 'running'::text)`
- `CREATE INDEX ix_site_form_splits_form ON public.site_form_splits USING btree (form)`
- `CREATE INDEX ix_site_form_splits_client ON public.site_form_splits USING btree (client)`

## public.account_visits (table)

- `id integer = nextval('account_visits_id_seq'::regclass)`
- `entry uuid`
- `company_id integer`
- `person_id integer null`
- `email varchar(320)`
- `what text`
- `at timestamp with time zone`
- `created_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_account_visits ON public.account_visits USING btree (id)`
- `CREATE UNIQUE INDEX uq_account_visits_entry ON public.account_visits USING btree (entry)`
- `CREATE INDEX ix_account_visits_company_at ON public.account_visits USING btree (company_id, at)`
- `CREATE INDEX ix_account_visits_person_id ON public.account_visits USING btree (person_id) WHERE (person_id IS NOT NULL)`

## public.job_orders (table)

- `id integer = nextval('job_orders_id_seq'::regclass)`
- `format varchar(32)`
- `order_key varchar(128)`
- `company_id integer null`
- `company_name text null`
- `title text null`
- `status text null`
- `open boolean`
- `openings integer null`
- `owner text null`
- `opened_on date null`
- `closed_on date null`
- `raw jsonb`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_job_orders ON public.job_orders USING btree (id)`
- `CREATE UNIQUE INDEX uq_job_orders_key ON public.job_orders USING btree (format, order_key)`
- `CREATE INDEX ix_job_orders_company_id ON public.job_orders USING btree (company_id) WHERE open`

## public.reactivation_keep (view)

- `id integer null`
- `company varchar null`
- `domain varchar(255) null`
- `champion text null`
- `champion_id integer null`
- `signal text null`
- `risk integer null`
- `why text null`
- `last_placement timestamp with time zone null`
- `placements integer null`
- `usual_gap integer null`
- `since integer null`
- `last_contact timestamp with time zone null`
- `visited timestamp with time zone null`
- `open_orders integer null`

## public.marketing_heat_records (view)

- `id text null`
- `window text null`
- `day date null`
- `page text null`
- `width text null`
- `views integer null`
- `clicks integer null`
- `rage integer null`

## public.access_tokens (table)

- `id uuid = gen_random_uuid()`
- `email text`
- `name text`
- `hash varchar(64)`
- `prefix varchar(16)`
- `client varchar(40) null`
- `created_at timestamp with time zone = now()`
- `last_used_at timestamp with time zone null`
- `expires_at timestamp with time zone null`
- `revoked_at timestamp with time zone null`
- `verbs text[] null`
- `apps text[] null`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_access_tokens ON public.access_tokens USING btree (id)`
- `CREATE UNIQUE INDEX uq_access_tokens_hash ON public.access_tokens USING btree (hash)`
- `CREATE INDEX ix_access_tokens_email ON public.access_tokens USING btree (email)`
- `CREATE INDEX ix_access_tokens_client ON public.access_tokens USING btree (client) WHERE (client IS NOT NULL)`

## public.custom_field_values (table)

- `field uuid`
- `row text`
- `value jsonb`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.custom_fields (field → id)

Indexes:

- `CREATE UNIQUE INDEX pk_custom_field_values ON public.custom_field_values USING btree (field, "row")`

## public.custom_fields (table)

- `id uuid = gen_random_uuid()`
- `owner varchar(40) null`
- `record varchar(80)`
- `key varchar(40)`
- `label varchar(800)`
- `kind varchar(8)`
- `options jsonb null`
- `position integer = 0`
- `archived_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.clients (owner → id)

Indexes:

- `CREATE UNIQUE INDEX pk_custom_fields ON public.custom_fields USING btree (id)`
- `CREATE UNIQUE INDEX uq_custom_fields_key ON public.custom_fields USING btree (owner, record, key) NULLS NOT DISTINCT`

## public.custom_values (table)

- `id uuid = gen_random_uuid()`
- `owner varchar(40) null`
- `key varchar(40)`
- `label varchar(800)`
- `value varchar(20000)`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.clients (owner → id)

Indexes:

- `CREATE UNIQUE INDEX pk_custom_values ON public.custom_values USING btree (id)`
- `CREATE UNIQUE INDEX uq_custom_values_key ON public.custom_values USING btree (owner, key) NULLS NOT DISTINCT`

## public.auto_replies (table)

- `channel varchar(8)`
- `mode varchar(8)`
- `updated_by varchar(200)`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_auto_replies ON public.auto_replies USING btree (channel)`

## public.chat_messages (table)

- `id integer = nextval('chat_messages_id_seq'::regclass)`
- `thread_id integer`
- `direction varchar(3)`
- `body text`
- `by varchar(200) null`
- `at timestamp with time zone = now()`

References:

- public.chat_threads (thread_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_chat_messages ON public.chat_messages USING btree (id)`
- `CREATE INDEX ix_chat_messages_thread ON public.chat_messages USING btree (thread_id, id)`

## public.chat_threads (table)

- `id integer = nextval('chat_threads_id_seq'::regclass)`
- `key_hash varchar(64)`
- `name varchar(1200) null`
- `email varchar(200) null`
- `phone varchar(32) null`
- `page text null`
- `last_in_at timestamp with time zone = now()`
- `read_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `ip_hash varchar(64) null`

Indexes:

- `CREATE UNIQUE INDEX pk_chat_threads ON public.chat_threads USING btree (id)`
- `CREATE UNIQUE INDEX uq_chat_threads_key ON public.chat_threads USING btree (key_hash)`
- `CREATE INDEX ix_chat_threads_last ON public.chat_threads USING btree (last_in_at)`
- `CREATE INDEX ix_chat_threads_created ON public.chat_threads USING btree (created_at)`
- `CREATE INDEX ix_chat_threads_ip ON public.chat_threads USING btree (ip_hash, created_at)`

## public.connector_fired (table)

- `link_id integer`
- `key varchar(160)`
- `at timestamp with time zone = now()`

References:

- public.connector_links (link_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_connector_fired ON public.connector_fired USING btree (link_id, key)`

## public.connector_grants (table)

- `state varchar(64)`
- `client varchar(64)`
- `app varchar(16)`
- `by varchar(320)`
- `created_at timestamp with time zone = now()`
- `expires_at timestamp with time zone`
- `used_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_connector_grants ON public.connector_grants USING btree (state)`
- `CREATE INDEX ix_connector_grants_client ON public.connector_grants USING btree (client)`

## public.connector_links (table)

- `id integer = nextval('connector_links_id_seq'::regclass)`
- `client varchar(64)`
- `app varchar(16)`
- `external_id varchar(128)`
- `name text null`
- `scopes text`
- `token_ref varchar(64)`
- `extra jsonb = '{}'::jsonb`
- `state varchar(12) = 'connected'::character varying`
- `why text null`
- `cursor jsonb = '{}'::jsonb`
- `people integer = 0`
- `fired integer = 0`
- `synced_at timestamp with time zone null`
- `connected_at timestamp with time zone = now()`
- `by varchar(320)`

Indexes:

- `CREATE UNIQUE INDEX pk_connector_links ON public.connector_links USING btree (id)`
- `CREATE UNIQUE INDEX uq_connector_links_account ON public.connector_links USING btree (client, app, external_id)`

## public.doc_counters (table)

- `client varchar(40)`
- `kind varchar(10)`
- `next integer = 1`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_doc_counters ON public.doc_counters USING btree (client, kind)`

## public.doc_events (table)

- `id bigint = nextval('doc_events_id_seq'::regclass)`
- `document uuid`
- `type varchar(10)`
- `at timestamp with time zone = now()`
- `by text`
- `ip varchar(64) null`
- `agent text null`
- `note text null`

References:

- public.docs (document → id)

Indexes:

- `CREATE UNIQUE INDEX pk_doc_events ON public.doc_events USING btree (id)`
- `CREATE INDEX ix_doc_events_document ON public.doc_events USING btree (document, at)`

## public.doc_templates (table)

- `id uuid = gen_random_uuid()`
- `client varchar(40)`
- `kind varchar(10)`
- `name varchar(1200)`
- `body text = ''::text`
- `lines jsonb = '[]'::jsonb`
- `deposit_pct integer null`
- `expires_days integer = 30`
- `starter varchar(20) null`
- `archived_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_doc_templates ON public.doc_templates USING btree (id)`
- `CREATE UNIQUE INDEX uq_doc_templates_starter ON public.doc_templates USING btree (client, starter)`

## public.docs (table)

- `id uuid = gen_random_uuid()`
- `client varchar(40)`
- `template uuid null`
- `kind varchar(10)`
- `number varchar(16)`
- `title varchar(2000)`
- `body text = ''::text`
- `lines jsonb = '[]'::jsonb`
- `currency varchar(3) = 'usd'::character varying`
- `subtotal_cents integer = 0`
- `tax_cents integer = 0`
- `total_cents integer = 0`
- `deposit_cents integer null`
- `name text null`
- `email text null`
- `contact integer null`
- `channel varchar(8) = 'email'::character varying`
- `status varchar(8) = 'draft'::character varying`
- `why text null`
- `token_hash varchar(64) null`
- `expires_days integer = 30`
- `expires_at timestamp with time zone null`
- `sha256 varchar(64) null`
- `message integer null`
- `sent_at timestamp with time zone null`
- `viewed_at timestamp with time zone null`
- `signed_at timestamp with time zone null`
- `declined_at timestamp with time zone null`
- `signer_name text null`
- `signer_email text null`
- `signed_ip varchar(64) null`
- `signed_agent text null`
- `consent_version varchar(16) null`
- `declined_why text null`
- `pay_link uuid null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `updated_at timestamp with time zone = now()`
- `approved_at timestamp with time zone null`
- `approved_by text null`
- `signing varchar(8) = 'own'::character varying`
- `envelope_id varchar(40) null`
- `sealed jsonb null`

References:

- public.clients (client → id)
- public.doc_templates (template → id)

Indexes:

- `CREATE UNIQUE INDEX pk_docs ON public.docs USING btree (id)`
- `CREATE INDEX ix_docs_client_created ON public.docs USING btree (client, created_at)`
- `CREATE UNIQUE INDEX uq_docs_number ON public.docs USING btree (client, number)`
- `CREATE UNIQUE INDEX uq_docs_token ON public.docs USING btree (token_hash)`
- `CREATE INDEX ix_docs_status ON public.docs USING btree (status)`
- `CREATE INDEX ix_docs_template ON public.docs USING btree (template)`
- `CREATE UNIQUE INDEX uq_docs_envelope ON public.docs USING btree (envelope_id) WHERE (envelope_id IS NOT NULL)`

## public.client_report_sends (table)

- `id integer = nextval('client_report_sends_id_seq'::regclass)`
- `report_id integer`
- `from timestamp with time zone`
- `to timestamp with time zone`
- `closed boolean`
- `lines jsonb`
- `sent_to jsonb = '[]'::jsonb`
- `why text null`
- `by varchar(320) null`
- `at timestamp with time zone = now()`

References:

- public.client_reports (report_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_client_report_sends ON public.client_report_sends USING btree (id)`
- `CREATE INDEX ix_client_report_sends_report ON public.client_report_sends USING btree (report_id, at)`

## public.client_reports (table)

- `id integer = nextval('client_reports_id_seq'::regclass)`
- `client varchar(64)`
- `name varchar(120)`
- `tiles jsonb`
- `every varchar(8)`
- `zone varchar(64)`
- `recipients jsonb = '[]'::jsonb`
- `on boolean = true`
- `next_at timestamp with time zone null`
- `by varchar(320)`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_client_reports ON public.client_reports USING btree (id)`
- `CREATE INDEX ix_client_reports_client ON public.client_reports USING btree (client)`

## public.dead_letters (table)

- `id integer = nextval('dead_letters_id_seq'::regclass)`
- `invocation_id varchar(64)`
- `target varchar(200)`
- `key text null`
- `error text null`
- `invoked_by varchar(200) null`
- `paused_at timestamp with time zone`
- `seen_at timestamp with time zone = now()`
- `told_at timestamp with time zone null`
- `ended_at timestamp with time zone null`
- `end varchar(8) null`
- `ended_by varchar(320) null`

Indexes:

- `CREATE UNIQUE INDEX pk_dead_letters ON public.dead_letters USING btree (id)`
- `CREATE UNIQUE INDEX uq_dead_letters_invocation ON public.dead_letters USING btree (invocation_id)`
- `CREATE INDEX ix_dead_letters_open ON public.dead_letters USING btree (ended_at, paused_at)`

## public.email_firm_records (view)

- `id integer null`
- `name text null`
- `domain text null`
- `niche text null`
- `stage text null`
- `declined text null`
- `added timestamp with time zone null`
- `crawled timestamp with time zone null`
- `named timestamp with time zone null`
- `lead timestamp with time zone null`

## public.ad_formats (table)

- `slug varchar(48)`
- `name text`
- `family varchar(16)`
- `what text`
- `use text`
- `state varchar(16) = 'idea'::character varying`
- `notes text null`
- `source text null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `updated_by text null`

Indexes:

- `CREATE UNIQUE INDEX pk_ad_formats ON public.ad_formats USING btree (slug)`

## public.ad_format_records (view)

- `id varchar(48) null`
- `name text null`
- `family varchar(16) null`
- `what text null`
- `use text null`
- `state varchar(16) null`
- `notes text null`
- `source text null`
- `launches integer null`
- `spend double precision null`
- `currency text null`
- `impressions integer null`
- `clicks integer null`
- `leads integer null`
- `ctr double precision null`
- `cost_per_lead double precision null`
- `updated_at timestamp with time zone null`
- `updated_by text null`

## public.comment_keywords (table)

- `id integer = nextval('comment_keywords_id_seq'::regclass)`
- `keyword varchar(40)`
- `platform varchar(16) null`
- `post varchar(200) null`
- `dm text`
- `reply text null`
- `active boolean = true`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `updated_by text null`

References:

- public.platform_objects (platform → platform, post → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_comment_keywords ON public.comment_keywords USING btree (id)`
- `CREATE UNIQUE INDEX uq_comment_keywords_scope ON public.comment_keywords USING btree (keyword, COALESCE(platform, ''::character varying), COALESCE(post, ''::character varying))`
- `CREATE INDEX ix_comment_keywords_platform_post ON public.comment_keywords USING btree (platform, post)`

## public.keyword_hits (table)

- `id integer = nextval('keyword_hits_id_seq'::regclass)`
- `keyword_id integer`
- `comment_id integer`
- `platform varchar(16)`
- `author varchar(120)`
- `state varchar(16) = 'queued'::character varying`
- `why text null`
- `ref varchar(200) null`
- `at timestamp with time zone = now()`
- `sent_at timestamp with time zone null`

References:

- public.comment_keywords (keyword_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_keyword_hits ON public.keyword_hits USING btree (id)`
- `CREATE UNIQUE INDEX uq_keyword_hits_comment_id ON public.keyword_hits USING btree (comment_id)`
- `CREATE UNIQUE INDEX uq_keyword_hits_person ON public.keyword_hits USING btree (keyword_id, platform, author)`

## public.comment_keyword_records (view)

- `id text null`
- `keyword varchar(40) null`
- `platform varchar null`
- `post varchar null`
- `dm text null`
- `reply text null`
- `state text null`
- `caught integer null`
- `sent integer null`
- `failed integer null`
- `last_at timestamp with time zone null`
- `updated_at timestamp with time zone null`
- `updated_by text null`

## public.keyword_hit_records (view)

- `id text null`
- `keyword varchar(40) null`
- `platform varchar(16) null`
- `author varchar(120) null`
- `comment text null`
- `post text null`
- `url text null`
- `state varchar(16) null`
- `why text null`
- `at timestamp with time zone null`
- `sent_at timestamp with time zone null`

## public.reach_passes (table)

- `id integer = nextval('reach_passes_id_seq'::regclass)`
- `platform varchar(16)`
- `handle varchar(200)`
- `name text`
- `reason varchar(16)`
- `note text null`
- `item varchar(80) null`
- `by varchar(120) null`
- `until timestamp with time zone null`
- `lifted_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_reach_passes ON public.reach_passes USING btree (id)`
- `CREATE UNIQUE INDEX uq_reach_passes_platform_handle ON public.reach_passes USING btree (platform, handle)`

## public.blog_posts (table)

- `slug varchar(80)`
- `title text`
- `description text`
- `body text`
- `date date`
- `draft boolean = true`
- `published_at timestamp with time zone null`
- `emailed_at timestamp with time zone null`
- `commit_sha varchar(40) null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `updated_by text null`
- `from_ref text null`

Indexes:

- `CREATE UNIQUE INDEX pk_blog_posts ON public.blog_posts USING btree (slug)`
- `CREATE INDEX ix_blog_posts_published_at ON public.blog_posts USING btree (published_at)`

## public.marketing_sends (table)

- `id integer = nextval('marketing_sends_id_seq'::regclass)`
- `person_key varchar(340)`
- `channel varchar(16)`
- `campaign varchar(120) null`
- `sent_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_marketing_sends ON public.marketing_sends USING btree (id)`
- `CREATE INDEX ix_marketing_sends_person_key ON public.marketing_sends USING btree (person_key, sent_at)`

## public.message_settings (table)

- `id integer = 1`
- `cap_per_day integer null`
- `cap_per_week integer null`
- `utm_links boolean = true`
- `updated_by varchar(200) null`
- `updated_at timestamp with time zone = now()`
- `sender varchar(320) null`
- `postal varchar(1000) null`

Indexes:

- `CREATE UNIQUE INDEX pk_message_settings ON public.message_settings USING btree (id)`

## public.profile_keys (table)

- `id integer = nextval('profile_keys_id_seq'::regclass)`
- `profile_id integer`
- `kind varchar(48)`
- `value varchar(320)`
- `source varchar(32)`
- `first_seen timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_keys ON public.profile_keys USING btree (id)`
- `CREATE UNIQUE INDEX uq_profile_keys_kind_value ON public.profile_keys USING btree (kind, value)`
- `CREATE INDEX ix_profile_keys_profile_id ON public.profile_keys USING btree (profile_id, kind)`
- `CREATE INDEX ix_profile_keys_profile_text ON public.profile_keys USING btree (((profile_id)::text))`

## public.profile_merges (table)

- `id integer = nextval('profile_merges_id_seq'::regclass)`
- `into_id integer`
- `from_id integer`
- `by varchar(400)`
- `keys integer`
- `traits integer`
- `source varchar(32)`
- `at timestamp with time zone = now()`

References:

- public.profiles (from_id → id; into_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_merges ON public.profile_merges USING btree (id)`
- `CREATE INDEX ix_profile_merges_into_id ON public.profile_merges USING btree (into_id)`
- `CREATE INDEX ix_profile_merges_from_id ON public.profile_merges USING btree (from_id)`

## public.profile_trait_events (table)

- `id integer = nextval('profile_trait_events_id_seq'::regclass)`
- `profile_id integer`
- `key varchar(64)`
- `old jsonb null`
- `new jsonb`
- `source varchar(32)`
- `at timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_trait_events ON public.profile_trait_events USING btree (id)`
- `CREATE INDEX ix_profile_trait_events_profile_id ON public.profile_trait_events USING btree (profile_id, at)`

## public.profile_traits (table)

- `profile_id integer`
- `key varchar(64)`
- `value jsonb`
- `source varchar(32)`
- `at timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_traits ON public.profile_traits USING btree (profile_id, key)`
- `CREATE INDEX ix_profile_traits_key ON public.profile_traits USING btree (key)`

## public.profiles (table)

- `id integer = nextval('profiles_id_seq'::regclass)`
- `name text null`
- `first_seen timestamp with time zone = now()`
- `last_seen timestamp with time zone = now()`
- `merged_into integer null`
- `created_at timestamp with time zone = now()`

References:

- public.profiles (merged_into → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profiles ON public.profiles USING btree (id)`
- `CREATE INDEX ix_profiles_merged_into ON public.profiles USING btree (merged_into)`
- `CREATE INDEX ix_profiles_last_seen ON public.profiles USING btree (last_seen)`

## public.profile_key_records (view)

- `id integer null`
- `profile_id integer null`
- `kind text null`
- `value text null`
- `source text null`
- `first_seen timestamp with time zone null`
- `profile_link text null`

## public.profile_merge_records (view)

- `id integer null`
- `into_id integer null`
- `from_id integer null`
- `from_name text null`
- `by text null`
- `keys integer null`
- `traits integer null`
- `source text null`
- `at timestamp with time zone null`
- `into_link text null`

## public.profile_trait_activity (view)

- `trait text null`
- `seq integer null`
- `at timestamp with time zone null`
- `kind text null`
- `what text null`

## public.profile_trait_records (view)

- `id text null`
- `profile_id integer null`
- `key text null`
- `value text null`
- `source text null`
- `at timestamp with time zone null`
- `changes integer null`
- `profile_link text null`

## public.reactivation_people (view)

- `id integer null`
- `name text null`
- `title text null`
- `company varchar null`
- `domain varchar(255) null`
- `now text null`
- `score integer null`
- `next_step varchar(16) null`
- `last_contact timestamp with time zone null`
- `last_placement timestamp with time zone null`
- `owner text null`
- `email varchar(32) null`
- `reason text null`
- `brief text null`
- `profile text null`

## public.click_syncs (table)

- `base_url varchar(255)`
- `cursor_id bigint = 0`
- `synced_at timestamp with time zone null`
- `stats jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_click_syncs ON public.click_syncs USING btree (base_url)`

## public.email_clicks (table)

- `id integer = nextval('email_clicks_id_seq'::regclass)`
- `link_code varchar(40)`
- `url varchar(200)`
- `message_id integer null`
- `first_at timestamp with time zone`
- `last_at timestamp with time zone`
- `clicks integer = 1`

References:

- public.messages (message_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_email_clicks ON public.email_clicks USING btree (id)`
- `CREATE UNIQUE INDEX uq_email_clicks_link_code_url ON public.email_clicks USING btree (link_code, url)`
- `CREATE INDEX ix_email_clicks_message_id ON public.email_clicks USING btree (message_id)`

## public.profile_events (table)

- `id integer = nextval('profile_events_id_seq'::regclass)`
- `profile_id integer`
- `kind varchar(24)`
- `channel varchar(24)`
- `at timestamp with time zone`
- `summary text`
- `body text null`
- `link text null`
- `source varchar(32)`
- `source_id varchar(64)`
- `updated_at timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_events ON public.profile_events USING btree (id)`
- `CREATE UNIQUE INDEX uq_profile_events_source ON public.profile_events USING btree (source, source_id)`
- `CREATE INDEX ix_profile_events_profile_id ON public.profile_events USING btree (profile_id, at)`

## public.segment_member_events (table)

- `id integer = nextval('segment_member_events_id_seq'::regclass)`
- `segment_id integer`
- `profile_id integer`
- `change varchar(8)`
- `at timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)
- public.segments (segment_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_segment_member_events ON public.segment_member_events USING btree (id)`
- `CREATE INDEX ix_segment_member_events_segment_id ON public.segment_member_events USING btree (segment_id, at)`
- `CREATE INDEX ix_segment_member_events_profile_id ON public.segment_member_events USING btree (profile_id, at)`

## public.segment_members (table)

- `segment_id integer`
- `profile_id integer`
- `since timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)
- public.segments (segment_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_segment_members ON public.segment_members USING btree (segment_id, profile_id)`
- `CREATE INDEX ix_segment_members_profile_id ON public.segment_members USING btree (profile_id)`

## public.segments (table)

- `id integer = nextval('segments_id_seq'::regclass)`
- `name varchar(120)`
- `kind varchar(16)`
- `rule jsonb null`
- `words text null`
- `state varchar(16) = 'active'::character varying`
- `size integer = 0`
- `computed_at timestamp with time zone null`
- `uses jsonb = '[]'::jsonb`
- `used_at timestamp with time zone = now()`
- `archived_at timestamp with time zone null`
- `by varchar(320)`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `version integer = 1`

Indexes:

- `CREATE UNIQUE INDEX pk_segments ON public.segments USING btree (id)`
- `CREATE UNIQUE INDEX uq_segments_name ON public.segments USING btree (name)`
- `CREATE INDEX ix_segments_state ON public.segments USING btree (state, kind)`

## public.segment_member_records (view)

- `id text null`
- `segment_id integer null`
- `segment text null`
- `segment_kind text null`
- `profile_id integer null`
- `name text null`
- `emails text null`
- `phones text null`
- `since timestamp with time zone null`
- `profile_link text null`

## public.segment_records (view)

- `id integer null`
- `name text null`
- `kind text null`
- `state text null`
- `size integer null`
- `words text null`
- `used_by text null`
- `uses integer null`
- `computed_at timestamp with time zone null`
- `used_at timestamp with time zone null`
- `archived_at timestamp with time zone null`
- `by text null`
- `created_at timestamp with time zone null`
- `members text null`

## public.comment_proofs (table)

- `item varchar(80)`
- `platform varchar(16)`
- `state varchar(16) = 'pending'::character varying`
- `url text null`
- `shot text null`
- `note text null`
- `checked_at timestamp with time zone null`
- `checks jsonb = '[]'::jsonb`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_comment_proofs ON public.comment_proofs USING btree (item)`
- `CREATE INDEX ix_comment_proofs_checked_at ON public.comment_proofs USING btree (checked_at)`

## public.broadcast_recipients (table)

- `id integer = nextval('broadcast_recipients_id_seq'::regclass)`
- `broadcast_id integer`
- `profile_id integer`
- `address varchar(320) null`
- `zone varchar(64) null`
- `state varchar(8) = 'due'::character varying`
- `due_at timestamp with time zone`
- `why text null`
- `sent_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `message_id varchar(998) null`

References:

- public.profiles (profile_id → id)
- public.broadcasts (broadcast_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_broadcast_recipients ON public.broadcast_recipients USING btree (id)`
- `CREATE UNIQUE INDEX uq_broadcast_recipients_broadcast_profile ON public.broadcast_recipients USING btree (broadcast_id, profile_id)`
- `CREATE INDEX ix_broadcast_recipients_due ON public.broadcast_recipients USING btree (broadcast_id, state, due_at)`
- `CREATE INDEX ix_broadcast_recipients_profile_id ON public.broadcast_recipients USING btree (profile_id)`
- `CREATE INDEX ix_broadcast_recipients_message_id ON public.broadcast_recipients USING btree (message_id)`

## public.broadcasts (table)

- `id integer = nextval('broadcasts_id_seq'::regclass)`
- `name varchar(120)`
- `channel varchar(8)`
- `segment_id integer`
- `topic_id integer`
- `subject varchar(200) null`
- `body text`
- `send_at timestamp with time zone null`
- `local boolean = false`
- `zone varchar(64) = 'America/New_York'::character varying`
- `state varchar(16) = 'draft'::character varying`
- `asked_by varchar(320) null`
- `asked_at timestamp with time zone null`
- `decided_by varchar(320) null`
- `decided_at timestamp with time zone null`
- `note text null`
- `tested_to varchar(320) null`
- `tested_at timestamp with time zone null`
- `started_at timestamp with time zone null`
- `finished_at timestamp with time zone null`
- `by varchar(320)`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

References:

- public.topics (topic_id → id)
- public.segments (segment_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_broadcasts ON public.broadcasts USING btree (id)`
- `CREATE INDEX ix_broadcasts_segment_id ON public.broadcasts USING btree (segment_id)`
- `CREATE INDEX ix_broadcasts_topic_id ON public.broadcasts USING btree (topic_id)`
- `CREATE INDEX ix_broadcasts_state ON public.broadcasts USING btree (state, send_at)`

## public.broadcast_recipient_records (view)

- `id integer null`
- `broadcast_id integer null`
- `broadcast text null`
- `channel text null`
- `profile_id integer null`
- `name text null`
- `address text null`
- `state text null`
- `why text null`
- `zone text null`
- `due_at timestamp with time zone null`
- `sent_at timestamp with time zone null`
- `profile_link text null`

## public.broadcast_records (view)

- `id integer null`
- `name text null`
- `channel text null`
- `state text null`
- `segment_id integer null`
- `segment text null`
- `size integer null`
- `topic text null`
- `subject text null`
- `body text null`
- `send_at timestamp with time zone null`
- `local boolean null`
- `zone text null`
- `when timestamp with time zone null`
- `people integer null`
- `sent integer null`
- `waiting integer null`
- `skipped integer null`
- `failed integer null`
- `by text null`
- `asked_at timestamp with time zone null`
- `decided_by text null`
- `decided_at timestamp with time zone null`
- `note text null`
- `tested_to text null`
- `tested_at timestamp with time zone null`
- `started_at timestamp with time zone null`
- `finished_at timestamp with time zone null`
- `created_at timestamp with time zone null`
- `sent_log text null`
- `recipients text null`

## public.reddit_requirements (table)

- `subreddit varchar(64)`
- `source varchar(16)`
- `min_age_days integer null`
- `min_karma integer null`
- `min_comment_karma integer null`
- `other text null`
- `hold boolean = false`
- `item varchar(80) null`
- `evidence text null`
- `learned_at timestamp with time zone = now()`
- `cleared_at timestamp with time zone null`

References:

- public.reddit_places (subreddit → subreddit)

Indexes:

- `CREATE UNIQUE INDEX pk_reddit_requirements ON public.reddit_requirements USING btree (subreddit, source)`

## public.mail_bounce_reads (table)

- `mailbox varchar(320)`
- `read_at timestamp with time zone null`
- `stats jsonb null`
- `last_sender_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_mail_bounce_reads ON public.mail_bounce_reads USING btree (mailbox)`

## public.mail_bounces (table)

- `id integer = nextval('mail_bounces_id_seq'::regclass)`
- `mailbox varchar(320)`
- `provider_id varchar(255)`
- `message_id varchar(998) null`
- `address varchar(320) null`
- `class varchar(8)`
- `matched_by varchar(16)`
- `status varchar(16) null`
- `diagnostic text null`
- `recipient_id integer null`
- `consent_event_id integer null`
- `suppression_id integer null`
- `received_at timestamp with time zone`
- `created_at timestamp with time zone = now()`

References:

- public.suppressions (suppression_id → id)
- public.consent_events (consent_event_id → id)
- public.broadcast_recipients (recipient_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_mail_bounces ON public.mail_bounces USING btree (id)`
- `CREATE UNIQUE INDEX uq_mail_bounces_mailbox_provider ON public.mail_bounces USING btree (mailbox, provider_id)`
- `CREATE INDEX ix_mail_bounces_recipient_id ON public.mail_bounces USING btree (recipient_id)`
- `CREATE INDEX ix_mail_bounces_consent_event_id ON public.mail_bounces USING btree (consent_event_id)`
- `CREATE INDEX ix_mail_bounces_suppression_id ON public.mail_bounces USING btree (suppression_id)`

## public.sent_activity (view)

- `message text null`
- `at timestamp with time zone null`
- `kind text null`
- `what text null`
- `seq integer null`

## public.sent_records (view)

- `id text null`
- `channel text null`
- `kind text null`
- `to_address varchar null`
- `key_kind text null`
- `key_value text null`
- `subject text null`
- `channel_state varchar null`
- `state text null`
- `campaign text null`
- `at timestamp with time zone null`
- `broadcast integer null`

## public.board_shares (table)

- `board_id uuid`
- `who varchar(200)`
- `role varchar(8)`
- `by varchar(200)`
- `at timestamp with time zone = now()`

References:

- public.boards (board_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_board_shares ON public.board_shares USING btree (board_id, who)`
- `CREATE INDEX ix_board_shares_who ON public.board_shares USING btree (who)`

## public.boards (table)

- `id uuid = gen_random_uuid()`
- `name varchar(1200)`
- `columns jsonb`
- `owner varchar(200)`
- `general varchar(12) = 'private'::character varying`
- `general_role varchar(8) = 'view'::character varying`
- `is_default boolean = false`
- `archived_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `version integer = 1`

Indexes:

- `CREATE UNIQUE INDEX pk_boards ON public.boards USING btree (id)`
- `CREATE INDEX ix_boards_owner ON public.boards USING btree (owner)`
- `CREATE UNIQUE INDEX uq_boards_default ON public.boards USING btree (is_default) WHERE is_default`

## public.task_blocks (table)

- `task_id uuid`
- `blocked_by uuid`
- `by varchar(200)`
- `at timestamp with time zone = now()`

References:

- public.notes (blocked_by → id; task_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_task_blocks ON public.task_blocks USING btree (task_id, blocked_by)`
- `CREATE INDEX ix_task_blocks_blocked_by ON public.task_blocks USING btree (blocked_by)`

## public.task_moves (table)

- `id bigint = nextval('task_moves_id_seq'::regclass)`
- `task_id uuid`
- `kind varchar(8)`
- `from_column varchar(40) null`
- `to_column varchar(40) null`
- `assignee varchar(200) null`
- `by varchar(200)`
- `at timestamp with time zone = now()`
- `why varchar(3000) null`

References:

- public.notes (task_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_task_moves ON public.task_moves USING btree (id)`
- `CREATE INDEX ix_task_moves_task_at ON public.task_moves USING btree (task_id, at)`

## public.client_records (view)

- `id text null`
- `name text null`
- `kind text null`
- `products text null`
- `members bigint null`
- `sends text null`
- `last_seen timestamp with time zone null`
- `added timestamp with time zone null`

## public.profile_rollups (table)

- `profile_id integer`
- `stage varchar(16)`
- `warmth varchar(8)`
- `why text = ''::text`
- `warmth_line text null`
- `warm_since timestamp with time zone null`
- `subscribed_n integer = 0`
- `subscribed_first timestamp with time zone null`
- `subscribed_last timestamp with time zone null`
- `replied_n integer = 0`
- `replied_first timestamp with time zone null`
- `replied_last timestamp with time zone null`
- `booked_n integer = 0`
- `booked_first timestamp with time zone null`
- `booked_last timestamp with time zone null`
- `form_n integer = 0`
- `form_first timestamp with time zone null`
- `form_last timestamp with time zone null`
- `visited_n integer = 0`
- `visited_first timestamp with time zone null`
- `visited_last timestamp with time zone null`
- `watched_n integer = 0`
- `watched_first timestamp with time zone null`
- `watched_last timestamp with time zone null`
- `opened_n integer = 0`
- `opened_first timestamp with time zone null`
- `opened_last timestamp with time zone null`
- `clicked_n integer = 0`
- `clicked_first timestamp with time zone null`
- `clicked_last timestamp with time zone null`
- `engaged_n integer = 0`
- `engaged_first timestamp with time zone null`
- `engaged_last timestamp with time zone null`
- `contacted_n integer = 0`
- `contacted_first timestamp with time zone null`
- `contacted_last timestamp with time zone null`
- `subscriptions text null`
- `replied_channels text null`
- `replied_last_channel varchar(24) null`
- `first_touch_at timestamp with time zone null`
- `first_channel varchar(24) null`
- `first_touch text null`
- `last_touch_at timestamp with time zone null`
- `last_channel varchar(24) null`
- `last_touch text null`
- `came_from varchar(32) null`
- `persona varchar(64)`
- `persona_role varchar(16)`
- `persona_niche varchar(32)`
- `persona_size varchar(16)`
- `refreshed_at timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_rollups ON public.profile_rollups USING btree (profile_id)`
- `CREATE INDEX ix_profile_rollups_stage ON public.profile_rollups USING btree (stage)`
- `CREATE INDEX ix_profile_rollups_warmth ON public.profile_rollups USING btree (warmth, warm_since)`
- `CREATE INDEX ix_profile_rollups_persona ON public.profile_rollups USING btree (persona)`
- `CREATE INDEX ix_profile_rollups_replied_last ON public.profile_rollups USING btree (replied_last)`

## public.profile_site_reads (table)

- `profile_id integer`
- `visits integer`
- `visit_first timestamp with time zone null`
- `visit_last timestamp with time zone null`
- `watches integer`
- `watch_first timestamp with time zone null`
- `watch_last timestamp with time zone null`
- `read_at timestamp with time zone`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_site_reads ON public.profile_site_reads USING btree (profile_id)`
- `CREATE INDEX ix_profile_site_reads_read_at ON public.profile_site_reads USING btree (read_at)`

## public.segment_versions (table)

- `segment_id integer`
- `version integer`
- `name varchar(120)`
- `kind varchar(16)`
- `rule jsonb null`
- `words text null`
- `by varchar(320)`
- `at timestamp with time zone = now()`

References:

- public.segments (segment_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_segment_versions ON public.segment_versions USING btree (segment_id, version)`

## public.draft_accounts (table)

- `item varchar(120)`
- `account varchar(120)`
- `by varchar(255) null`
- `at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_draft_accounts ON public.draft_accounts USING btree (item)`

## public.comment_threads (table)

- `id integer = nextval('comment_threads_id_seq'::regclass)`
- `platform varchar(16)`
- `post varchar(200)`
- `account_id uuid`
- `post_title text null`
- `post_text text null`
- `post_url text null`
- `post_place varchar(200) null`
- `post_author varchar(120) null`
- `post_media text null`
- `post_at timestamp with time zone null`
- `nodes jsonb = '[]'::jsonb`
- `more integer = 0`
- `count integer null`
- `read_at timestamp with time zone null`
- `check_at timestamp with time zone = now()`
- `active_at timestamp with time zone`
- `until timestamp with time zone`
- `created_at timestamp with time zone = now()`

References:

- public.reach_accounts (account_id → id)
- public.platform_objects (platform → platform, post → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_comment_threads ON public.comment_threads USING btree (id)`
- `CREATE UNIQUE INDEX uq_comment_threads_platform_post ON public.comment_threads USING btree (platform, post)`
- `CREATE INDEX ix_comment_threads_account_id ON public.comment_threads USING btree (account_id)`
- `CREATE INDEX ix_comment_threads_until ON public.comment_threads USING btree (until)`

## public.send_attempts (table)

- `item varchar(80)`
- `state varchar(12)`
- `platform varchar(16)`
- `account varchar(80) null`
- `words text`
- `target varchar(200)`
- `url text null`
- `tries smallint = 0`
- `invocation varchar(120) null`
- `ref varchar(200) null`
- `sent_at timestamp with time zone null`
- `why text null`
- `settled_by varchar(120) null`
- `started_at timestamp with time zone`
- `updated_at timestamp with time zone`
- `send_key varchar(200) null`

Indexes:

- `CREATE UNIQUE INDEX pk_send_attempts ON public.send_attempts USING btree (item)`
- `CREATE INDEX ix_send_attempts_state ON public.send_attempts USING btree (state)`

## public.call_recordings (table)

- `id integer = nextval('call_recordings_id_seq'::regclass)`
- `call_booking_id integer null`
- `file_key text`
- `bytes bigint`
- `duration_s integer`
- `started_at timestamp with time zone`
- `ended_at timestamp with time zone`
- `transcript text`
- `segments jsonb`
- `notes jsonb null`
- `model varchar(64) null`
- `by varchar(8)`
- `created_at timestamp with time zone = now()`

References:

- public.call_bookings (call_booking_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_call_recordings ON public.call_recordings USING btree (id)`
- `CREATE UNIQUE INDEX uq_call_recordings_file_key ON public.call_recordings USING btree (file_key)`
- `CREATE INDEX ix_call_recordings_call_booking_id ON public.call_recordings USING btree (call_booking_id)`

## public.decision_calls (table)

- `id integer = nextval('decision_calls_id_seq'::regclass)`
- `kind varchar(40)`
- `subject varchar(200)`
- `label varchar(40)`
- `keep boolean`
- `source varchar(40)`
- `by varchar(320) null`
- `decision_id integer null`
- `agreed boolean null`
- `override boolean = false`
- `ref varchar(300) null`
- `at timestamp with time zone = now()`
- `comment text null`

References:

- public.decisions (decision_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_decision_calls ON public.decision_calls USING btree (id)`
- `CREATE UNIQUE INDEX uq_decision_calls_ref ON public.decision_calls USING btree (ref)`
- `CREATE INDEX ix_decision_calls_subject ON public.decision_calls USING btree (kind, subject, at)`
- `CREATE INDEX ix_decision_calls_decision_id ON public.decision_calls USING btree (decision_id)`

## public.decisions (table)

- `id integer = nextval('decisions_id_seq'::regclass)`
- `kind varchar(40)`
- `subject varchar(200)`
- `mode varchar(10)`
- `backend varchar(20)`
- `model varchar(100)`
- `state jsonb`
- `questions jsonb`
- `answers jsonb null`
- `label varchar(40) null`
- `p double precision null`
- `confidence double precision null`
- `input_tokens integer null`
- `output_tokens integer null`
- `cost_usd double precision = 0`
- `latency_ms integer null`
- `error text null`
- `ref varchar(300) null`
- `at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_decisions ON public.decisions USING btree (id)`
- `CREATE UNIQUE INDEX uq_decisions_ref ON public.decisions USING btree (ref)`
- `CREATE INDEX ix_decisions_subject ON public.decisions USING btree (kind, subject, at)`
- `CREATE INDEX ix_decisions_kind_at ON public.decisions USING btree (kind, at)`

## public.send_journal (table)

- `key varchar(200)`
- `site varchar(40)`
- `method varchar(8)`
- `path text`
- `account varchar(120) null`
- `started_at timestamp with time zone`
- `verdict jsonb null`
- `updated_at timestamp with time zone`

Indexes:

- `CREATE UNIQUE INDEX pk_send_journal ON public.send_journal USING btree (key)`
- `CREATE INDEX ix_send_journal_started ON public.send_journal USING btree (started_at)`

## public.profile_findings (table)

- `id integer = nextval('profile_findings_id_seq'::regclass)`
- `profile_id integer`
- `lookup_id integer null`
- `kind varchar(16)`
- `platform varchar(24) null`
- `value text`
- `url text null`
- `source varchar(24)`
- `confidence double precision`
- `detail jsonb null`
- `state varchar(8) = 'found'::character varying`
- `decided_by varchar(320) null`
- `decided_at timestamp with time zone null`
- `ref varchar(400)`
- `at timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)
- public.profile_lookups (lookup_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_findings ON public.profile_findings USING btree (id)`
- `CREATE UNIQUE INDEX uq_profile_findings_profile_ref ON public.profile_findings USING btree (profile_id, ref)`
- `CREATE INDEX ix_profile_findings_lookup_id ON public.profile_findings USING btree (lookup_id)`

## public.profile_lookups (table)

- `id integer = nextval('profile_lookups_id_seq'::regclass)`
- `profile_id integer`
- `state varchar(12)`
- `by varchar(320) null`
- `subject jsonb null`
- `tried jsonb null`
- `outcome varchar(24) null`
- `error text null`
- `retry_at timestamp with time zone null`
- `started_at timestamp with time zone null`
- `finished_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_lookups ON public.profile_lookups USING btree (id)`
- `CREATE INDEX ix_profile_lookups_profile_id ON public.profile_lookups USING btree (profile_id, created_at)`

## public.llm_usage_by_month (view)

- `month date null`
- `kind text null`
- `model text null`
- `provider text null`
- `calls bigint null`
- `input_tokens bigint null`
- `output_tokens bigint null`
- `rejected_calls bigint null`
- `parse_failures bigint null`
- `usd double precision null`

## public.email_model_records (view)

- `id text null`
- `month date null`
- `kind text null`
- `model text null`
- `provider text null`
- `calls bigint null`
- `input_tokens bigint null`
- `output_tokens bigint null`
- `rejected_calls bigint null`
- `parse_failures bigint null`
- `usd double precision null`
- `age text null`
- `currency text null`

## public.fetch_tiers (table)

- `domain text`
- `tier text`
- `block text null`
- `learned_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_fetch_tiers ON public.fetch_tiers USING btree (domain)`

## public.vault_keys (table)

- `address varchar(160)`
- `site varchar(64)`
- `account varchar(64)`
- `owner varchar(80)`
- `key_id varchar(12)`
- `purposes text[] = '{}'::text[]`
- `status varchar(8)`
- `spent_until timestamp with time zone null`
- `made_at timestamp with time zone`
- `revoked_at timestamp with time zone null`
- `via varchar(160) null`
- `vendor_id varchar(160) null`
- `uses integer = 0`
- `last_used_at timestamp with time zone null`
- `read_at timestamp with time zone`

Indexes:

- `CREATE UNIQUE INDEX pk_vault_keys ON public.vault_keys USING btree (address)`
- `CREATE INDEX ix_vault_keys_key_id ON public.vault_keys USING btree (key_id)`

## public.platform_object_refs (table)

- `platform varchar(16)`
- `alias text`
- `ref varchar(255)`
- `created_at timestamp with time zone = now()`

References:

- public.platform_objects (platform → platform, ref → ref)

Indexes:

- `CREATE UNIQUE INDEX pk_platform_object_refs ON public.platform_object_refs USING btree (platform, alias)`
- `CREATE INDEX ix_platform_object_refs_platform_ref ON public.platform_object_refs USING btree (platform, ref)`

## public.platform_objects (table)

- `platform varchar(16)`
- `ref varchar(255)`
- `kind varchar(16)`
- `url text null`
- `post varchar(255) null`
- `parent varchar(255) null`
- `author varchar(200) null`
- `at timestamp with time zone null`
- `first_seen timestamp with time zone = now()`
- `last_seen timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_platform_objects ON public.platform_objects USING btree (platform, ref)`
- `CREATE INDEX ix_platform_objects_platform_post ON public.platform_objects USING btree (platform, post)`

## public.person_touch_lines (view)

- `person text null`
- `at timestamp with time zone null`
- `kind text null`
- `what text null`
- `seq integer null`
- `link text null`
- `context text null`

## public.research_signals (view)

- `id integer null`
- `kind varchar(32) null`
- `topic text null`
- `company_id integer null`
- `person_id integer null`
- `subject text null`
- `title text null`
- `url text null`
- `at timestamp with time zone null`
- `dated varchar(12) null`
- `via varchar(64) null`
- `confidence real null`
- `document_id integer null`
- `first_seen timestamp with time zone null`
- `seen timestamp with time zone null`
- `age text null`

## public.done_records (view)

- `id integer null`
- `item varchar(200) null`
- `kind varchar(16) null`
- `platform varchar(16) null`
- `event varchar(16) null`
- `via varchar(8) null`
- `by varchar(200) null`
- `what text null`
- `words text null`
- `note text null`
- `url text null`
- `open text null`
- `at timestamp with time zone null`
- `day text null`

## public.draft_activity (view)

- `item varchar null`
- `draft text null`
- `post text null`
- `comment text null`
- `thread text null`
- `contact text null`
- `video text null`
- `at timestamp with time zone null`
- `seq integer null`
- `kind varchar null`
- `what text null`

## public.marketing_draft_records (view)

- `id text null`
- `platform text null`
- `title text null`
- `text text null`
- `state text null`
- `chars integer null`
- `written text null`
- `note text null`
- `error text null`
- `stage text null`
- `to text null`
- `format text null`
- `missing text null`
- `scheduled timestamp with time zone null`
- `created timestamp with time zone null`
- `due timestamp with time zone null`
- `version text null`
- `account text null`

## public.marketing_link_day_records (view)

- `id text null`
- `day date null`
- `source text null`
- `campaign text null`
- `content text null`
- `post text null`
- `post_title text null`
- `clicks integer null`
- `hops integer null`
- `forms_first integer null`
- `forms_last integer null`
- `calls_first integer null`
- `calls_last integer null`
- `won_first integer null`
- `won_last integer null`
- `revenue_first numeric null`
- `revenue_last numeric null`
- `currency text null`
- `age text null`

## public.profile_timeline (view)

- `id text null`
- `profile_id integer null`
- `at timestamp with time zone null`
- `kind text null`
- `channel text null`
- `summary text null`
- `body text null`
- `link text null`
- `source text null`
- `who text null`
- `profile_link text null`
- `context text null`
- `note text null`

## public.profile_steps (view)

- `profile_id integer null`
- `channel text null`
- `source_kind text null`
- `source text null`
- `step text null`
- `at timestamp with time zone null`
- `ref text null`
- `cost_usd double precision null`
- `sends integer null`

## public.site_entry_records (view)

- `id text null`
- `form text null`
- `form_name text null`
- `page text null`
- `page_title text null`
- `owner text null`
- `owner_name text null`
- `at timestamp with time zone null`
- `channel text null`
- `source text null`
- `campaign text null`
- `who text null`
- `email text null`
- `phone text null`
- `consented text null`
- `consent_version text null`
- `consent_text text null`
- `entered text null`
- `why text null`
- `visitor text null`
- `human text null`
- `answers text null`

## public.site_form_records (view)

- `id text null`
- `name text null`
- `slug text null`
- `owner text null`
- `status text null`
- `url text null`
- `fields integer null`
- `views integer null`
- `starts integer null`
- `submits integer null`
- `conversion double precision null`
- `last timestamp with time zone null`
- `changed timestamp with time zone null`
- `changed_by text null`
- `address text null`
- `owner_name text null`

## public.site_funnel_records (view)

- `id text null`
- `page text null`
- `title text null`
- `offer text null`
- `status text null`
- `channel text null`
- `views integer null`
- `ctas integer null`
- `forms integer null`
- `books integer null`
- `form_rate double precision null`
- `spend double precision null`
- `cost_per_form double precision null`
- `last timestamp with time zone null`
- `currency text null`

## public.site_link_records (view)

- `id text null`
- `owner text null`
- `owner_name text null`
- `name text null`
- `page text null`
- `page_title text null`
- `slug text null`
- `link text null`
- `source text null`
- `medium text null`
- `channel text null`
- `campaign text null`
- `content text null`
- `host text null`
- `url text null`
- `clicks integer null`
- `visits integer null`
- `forms integer null`
- `books integer null`
- `last timestamp with time zone null`
- `created timestamp with time zone null`
- `created_by text null`

## public.site_page_records (view)

- `id text null`
- `title text null`
- `url text null`
- `kind text null`
- `source text null`
- `owner text null`
- `status text null`
- `waiting integer null`
- `offer text null`
- `angle text null`
- `audience text null`
- `stage text null`
- `template text null`
- `variant_of text null`
- `repo_path text null`
- `views integer null`
- `ctas integer null`
- `forms integer null`
- `books integer null`
- `form_rate double precision null`
- `ads integer null`
- `spend double precision null`
- `cost_per_form double precision null`
- `changed timestamp with time zone null`
- `changed_by text null`
- `currency text null`
- `split text null`
- `asked text null`
- `address text null`
- `owner_name text null`

## public.marketing_conversation (view)

- `id text null`
- `span text null`
- `platform text null`
- `since timestamp with time zone null`
- `comments integer null`
- `answered integer null`
- `reply_secs double precision null`
- `dmed integer null`
- `dms integer null`
- `dms_answered integer null`
- `booked integer null`

## public.profile_list (table)

- `profile_id integer`
- `name text`
- `emails text null`
- `phones text null`
- `handles text null`
- `channels text null`
- `consent text null`
- `first_seen timestamp with time zone`
- `last_seen timestamp with time zone`
- `keys integer`
- `traits integer`
- `merged integer`
- `stage text`
- `warmth text`
- `why text null`
- `warmth_line text null`
- `warm_since timestamp with time zone null`
- `persona text`
- `persona_role text`
- `persona_niche text`
- `persona_size text`
- `subscriptions text null`
- `replies integer`
- `replied_last timestamp with time zone null`
- `replied_channel text null`
- `first_channel text null`
- `last_touch_at timestamp with time zone null`
- `last_channel text null`
- `came_from text null`
- `lead text null`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_profile_list ON public.profile_list USING btree (profile_id)`
- `CREATE INDEX ix_profile_list_profile_text ON public.profile_list USING btree (((profile_id)::text))`
- `CREATE INDEX ix_profile_list_last_seen ON public.profile_list USING btree (((last_seen IS NULL)), last_seen DESC, ((profile_id)::text) COLLATE "C")`

## public.profile_records (view)

- `id integer null`
- `name text null`
- `emails text null`
- `phones text null`
- `handles text null`
- `channels text null`
- `consent text null`
- `first_seen timestamp with time zone null`
- `last_seen timestamp with time zone null`
- `keys integer null`
- `traits integer null`
- `merged integer null`
- `stage text null`
- `warmth text null`
- `why text null`
- `warmth_line text null`
- `warm_since timestamp with time zone null`
- `persona text null`
- `persona_role text null`
- `persona_niche text null`
- `persona_size text null`
- `subscriptions text null`
- `replies integer null`
- `replied_last timestamp with time zone null`
- `replied_channel text null`
- `first_channel text null`
- `last_touch_at timestamp with time zone null`
- `last_channel text null`
- `came_from text null`
- `lead text null`

## public.marketing_post_records (view)

- `id text null`
- `platform text null`
- `title text null`
- `published timestamp with time zone null`
- `stage text null`
- `format text null`
- `views integer null`
- `reactions integer null`
- `comments integer null`
- `shares integer null`
- `engaged integer null`
- `score double precision null`
- `impressions double precision null`
- `reach double precision null`
- `ctr double precision null`
- `avg_view_pct double precision null`
- `avg_view_secs double precision null`
- `hold double precision null`
- `hook double precision null`
- `watch_minutes double precision null`
- `saves double precision null`
- `follows double precision null`
- `link_clicks double precision null`
- `clicks integer null`
- `forms integer null`
- `calls integer null`
- `won integer null`
- `revenue_first numeric null`
- `revenue_last numeric null`
- `currency text null`
- `theirs integer null`
- `answered integer null`
- `measured timestamp with time zone null`
- `url text null`
- `recent text null`
- `account text null`

## public.access_review_events (table)

- `id integer = nextval('access_review_events_id_seq'::regclass)`
- `review_id integer`
- `at timestamp with time zone = now()`
- `kind varchar(12)`
- `note text null`
- `ticket varchar(200) null`
- `by varchar(320)`

References:

- public.access_reviews (review_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_access_review_events ON public.access_review_events USING btree (id)`
- `CREATE INDEX ix_access_review_events_review ON public.access_review_events USING btree (review_id, at)`

## public.access_reviews (table)

- `id integer = nextval('access_reviews_id_seq'::regclass)`
- `client varchar(64)`
- `kind varchar(64)`
- `name text null`
- `where text null`
- `state varchar(12) = 'draft'::character varying`
- `ticket varchar(200) null`
- `reason text null`
- `filed_at timestamp with time zone null`
- `decided_at timestamp with time zone null`
- `next_check_at timestamp with time zone null`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_access_reviews ON public.access_reviews USING btree (id)`
- `CREATE UNIQUE INDEX uq_access_reviews_kind ON public.access_reviews USING btree (client, kind)`

## public.executions (view)

- `id text null`
- `workflow varchar(64) null`
- `subject varchar(200) null`
- `kind text null`
- `state text null`
- `node varchar null`
- `entered timestamp with time zone null`
- `last_at timestamp with time zone null`
- `due timestamp with time zone null`
- `until varchar null`
- `error text null`
- `steps integer null`
- `title text null`
- `person text null`
- `firm varchar null`

## public.limits (table)

- `id integer = nextval('limits_id_seq'::regclass)`
- `client varchar(40) null`
- `name varchar(64)`
- `per_day integer`
- `burst integer null`
- `updated_by varchar(320)`
- `updated_at timestamp with time zone = now()`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_limits ON public.limits USING btree (id)`
- `CREATE UNIQUE INDEX uq_limits_owner ON public.limits USING btree (client, name) NULLS NOT DISTINCT`

## public.audit_eras (table)

- `era integer`
- `cluster bigint`
- `follows integer`
- `began_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_audit_eras ON public.audit_eras USING btree (era)`
- `CREATE UNIQUE INDEX audit_eras_cluster_follows_key ON public.audit_eras USING btree (cluster, follows)`

## public.audit_events (table)

- `id bigint`
- `at timestamp with time zone = now()`
- `era integer = audit_era()`
- `tx bigint = ((pg_current_xact_id())::text)::bigint`
- `table_name text`
- `op text`
- `row_key jsonb null`
- `old_values jsonb null`
- `new_values jsonb null`
- `db_user text = SESSION_USER`
- `app text = current_setting('application_name'::text)`
- `actor text null = NULLIF(current_setting('wren.actor'::text, true), ''::text)`
- `acting_as text null = NULLIF(current_setting('wren.as'::text, true), ''::text)`

Indexes:

- `CREATE UNIQUE INDEX pk_audit_events ON public.audit_events USING btree (id)`
- `CREATE INDEX ix_audit_events_era_tx ON public.audit_events USING btree (era, tx, id)`
- `CREATE INDEX ix_audit_events_table_at ON public.audit_events USING btree (table_name, at)`
- `CREATE INDEX ix_audit_events_at ON public.audit_events USING btree (at)`

## public.audit_seals (table)

- `id integer`
- `sealed_at timestamp with time zone = now()`
- `from_era integer`
- `from_tx bigint`
- `through_era integer`
- `through_tx bigint`
- `events bigint`
- `prev_hash bytea null`
- `hash bytea`

Indexes:

- `CREATE UNIQUE INDEX pk_audit_seals ON public.audit_seals USING btree (id)`

## public.audit_changes (view)

- `id text null`
- `at timestamp with time zone null`
- `who text null`
- `made_by text null`
- `via text null`
- `as text null`
- `table text null`
- `area text null`
- `op text null`
- `row text null`
- `change text null`
- `age text null`
