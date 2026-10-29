# public: schema

Tables and views: 333.

## public.access_asks (table)

- `approved boolean null`
- `apps text[] null`
- `at timestamp with time zone = now()`
- `channels text[] null`
- `client varchar(40)`
- `decided_at timestamp with time zone null`
- `decided_by text null`
- `email text`
- `grant_id integer null`
- `id integer = nextval('access_asks_id_seq'::regclass)`
- `reason text null`
- `record text null`
- `until timestamp with time zone null`
- `verbs text[]`

References:

- public.grants (grant_id → id)

Indexes:

- `CREATE INDEX ix_access_asks_email ON public.access_asks USING btree (email)`
- `CREATE INDEX ix_access_asks_grant ON public.access_asks USING btree (grant_id)`
- `CREATE INDEX ix_access_asks_open ON public.access_asks USING btree (client, decided_at)`
- `CREATE UNIQUE INDEX pk_access_asks ON public.access_asks USING btree (id)`

## public.access_review_events (table)

- `at timestamp with time zone = now()`
- `by varchar(320)`
- `id integer = nextval('access_review_events_id_seq'::regclass)`
- `kind varchar(12)`
- `note text null`
- `review_id integer`
- `ticket varchar(200) null`

References:

- public.access_reviews (review_id → id)

Indexes:

- `CREATE INDEX ix_access_review_events_review ON public.access_review_events USING btree (review_id, at)`
- `CREATE UNIQUE INDEX pk_access_review_events ON public.access_review_events USING btree (id)`

## public.access_reviews (table)

- `client varchar(64)`
- `decided_at timestamp with time zone null`
- `filed_at timestamp with time zone null`
- `id integer = nextval('access_reviews_id_seq'::regclass)`
- `kind varchar(64)`
- `name text null`
- `next_check_at timestamp with time zone null`
- `reason text null`
- `state varchar(12) = 'draft'::character varying`
- `ticket varchar(200) null`
- `updated_at timestamp with time zone = now()`
- `where text null`

Indexes:

- `CREATE UNIQUE INDEX pk_access_reviews ON public.access_reviews USING btree (id)`
- `CREATE UNIQUE INDEX uq_access_reviews_kind ON public.access_reviews USING btree (client, kind)`

## public.access_tokens (table)

- `apps text[] null`
- `client varchar(40) null`
- `created_at timestamp with time zone = now()`
- `email text`
- `expires_at timestamp with time zone null`
- `hash varchar(64)`
- `id uuid = gen_random_uuid()`
- `last_used_at timestamp with time zone null`
- `name text`
- `prefix varchar(16)`
- `revoked_at timestamp with time zone null`
- `verbs text[] null`

References:

- public.clients (client → id)

Indexes:

- `CREATE INDEX ix_access_tokens_client ON public.access_tokens USING btree (client) WHERE (client IS NOT NULL)`
- `CREATE INDEX ix_access_tokens_email ON public.access_tokens USING btree (email)`
- `CREATE UNIQUE INDEX pk_access_tokens ON public.access_tokens USING btree (id)`
- `CREATE UNIQUE INDEX uq_access_tokens_hash ON public.access_tokens USING btree (hash)`

## public.account_facts (table)

- `account_id integer`
- `by varchar(320)`
- `checked_at timestamp with time zone = now()`
- `fact varchar(80)`
- `ok_at timestamp with time zone null`
- `seen jsonb null`
- `state varchar(8)`
- `why text null`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_account_facts ON public.account_facts USING btree (account_id, fact)`

## public.account_metric_days (table)

- `day date`
- `fetched_at timestamp with time zone = now()`
- `key varchar(200) = ''::character varying`
- `metric varchar(32)`
- `platform varchar(16)`
- `value double precision`

Indexes:

- `CREATE UNIQUE INDEX pk_account_metric_days ON public.account_metric_days USING btree (platform, day, metric, key)`

## public.account_visits (table)

- `at timestamp with time zone`
- `company_id integer`
- `created_at timestamp with time zone = now()`
- `email varchar(320)`
- `entry uuid`
- `id integer = nextval('account_visits_id_seq'::regclass)`
- `person_id integer null`
- `what text`

References:

- public.companies (company_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_account_visits_company_at ON public.account_visits USING btree (company_id, at)`
- `CREATE INDEX ix_account_visits_person_id ON public.account_visits USING btree (person_id) WHERE (person_id IS NOT NULL)`
- `CREATE UNIQUE INDEX pk_account_visits ON public.account_visits USING btree (id)`
- `CREATE UNIQUE INDEX uq_account_visits_entry ON public.account_visits USING btree (entry)`

## public.ad_days (table)

- `adset_id varchar(32)`
- `adset_name text`
- `campaign_id varchar(32)`
- `campaign_name text`
- `clicks integer`
- `currency varchar(3)`
- `day date`
- `impressions integer`
- `leads integer`
- `reach integer`
- `results integer`
- `spend double precision`
- `synced_at timestamp with time zone = now()`

Indexes:

- `CREATE INDEX ix_ad_days_campaign_id ON public.ad_days USING btree (campaign_id)`
- `CREATE INDEX ix_ad_days_day ON public.ad_days USING btree (day)`
- `CREATE UNIQUE INDEX pk_ad_days ON public.ad_days USING btree (adset_id, day)`

## public.ad_format_records (view)

- `clicks integer null`
- `cost_per_lead double precision null`
- `ctr double precision null`
- `currency text null`
- `family varchar(16) null`
- `id varchar(48) null`
- `impressions integer null`
- `launches integer null`
- `leads integer null`
- `name text null`
- `notes text null`
- `source text null`
- `spend double precision null`
- `state varchar(16) null`
- `updated_at timestamp with time zone null`
- `updated_by text null`
- `use text null`
- `what text null`

## public.ad_formats (table)

- `created_at timestamp with time zone = now()`
- `family varchar(16)`
- `name text`
- `notes text null`
- `slug varchar(48)`
- `source text null`
- `state varchar(16) = 'idea'::character varying`
- `updated_at timestamp with time zone = now()`
- `updated_by text null`
- `use text`
- `what text`

Indexes:

- `CREATE UNIQUE INDEX pk_ad_formats ON public.ad_formats USING btree (slug)`

## public.ad_launches (table)

- `ad_account_id varchar(32)`
- `ad_id varchar(32)`
- `adset_id varchar(32)`
- `campaign_id varchar(32)`
- `created_at timestamp with time zone = now()`
- `creative_id varchar(32)`
- `daily_budget_usd real`
- `id uuid = gen_random_uuid()`
- `name varchar(200)`
- `spec jsonb`
- `started_at timestamp with time zone null`
- `status varchar(16) = 'paused'::character varying`
- `stop_reason varchar(3000) null`
- `stopped_at timestamp with time zone null`

Indexes:

- `CREATE INDEX ix_ad_launches_campaign_id ON public.ad_launches USING btree (campaign_id)`
- `CREATE INDEX ix_ad_launches_status ON public.ad_launches USING btree (status)`
- `CREATE UNIQUE INDEX pk_ad_launches ON public.ad_launches USING btree (id)`

## public.agency_facts (view)

- `company_id integer null`
- `country varchar(2) null`
- `domain varchar(255) null`
- `employees integer null`
- `founded_year integer null`
- `hourly_rate_usd integer null`
- `industries text null`
- `last_seen_at timestamp with time zone null`
- `min_budget_usd bigint null`
- `name varchar null`
- `rating numeric null`
- `segment text null`
- `services text null`
- `source_key varchar(64) null`

## public.audit_changes (view)

- `age text null`
- `area text null`
- `as text null`
- `at timestamp with time zone null`
- `change text null`
- `id text null`
- `made_by text null`
- `op text null`
- `row text null`
- `table text null`
- `via text null`
- `who text null`

## public.audit_eras (table)

- `began_at timestamp with time zone = now()`
- `cluster bigint`
- `era integer`
- `follows integer`

Indexes:

- `CREATE UNIQUE INDEX audit_eras_cluster_follows_key ON public.audit_eras USING btree (cluster, follows)`
- `CREATE UNIQUE INDEX pk_audit_eras ON public.audit_eras USING btree (era)`

## public.audit_events (table)

- `acting_as text null = NULLIF(current_setting('wren.as'::text, true), ''::text)`
- `actor text null = NULLIF(current_setting('wren.actor'::text, true), ''::text)`
- `app text = current_setting('application_name'::text)`
- `at timestamp with time zone = now()`
- `db_user text = SESSION_USER`
- `era integer = audit_era()`
- `id bigint`
- `new_values jsonb null`
- `old_values jsonb null`
- `op text`
- `row_key jsonb null`
- `table_name text`
- `tx bigint = ((pg_current_xact_id())::text)::bigint`

Indexes:

- `CREATE INDEX ix_audit_events_at ON public.audit_events USING btree (at)`
- `CREATE INDEX ix_audit_events_era_tx ON public.audit_events USING btree (era, tx, id)`
- `CREATE INDEX ix_audit_events_table_at ON public.audit_events USING btree (table_name, at)`
- `CREATE UNIQUE INDEX pk_audit_events ON public.audit_events USING btree (id)`

## public.audit_seals (table)

- `events bigint`
- `from_era integer`
- `from_tx bigint`
- `hash bytea`
- `id integer`
- `prev_hash bytea null`
- `sealed_at timestamp with time zone = now()`
- `through_era integer`
- `through_tx bigint`

Indexes:

- `CREATE UNIQUE INDEX pk_audit_seals ON public.audit_seals USING btree (id)`

## public.auto_replies (table)

- `channel varchar(8)`
- `mode varchar(8)`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(200)`

Indexes:

- `CREATE UNIQUE INDEX pk_auto_replies ON public.auto_replies USING btree (channel)`

## public.blog_posts (table)

- `body text`
- `commit_sha varchar(40) null`
- `created_at timestamp with time zone = now()`
- `date date`
- `description text`
- `draft boolean = true`
- `emailed_at timestamp with time zone null`
- `from_ref text null`
- `published_at timestamp with time zone null`
- `slug varchar(80)`
- `title text`
- `updated_at timestamp with time zone = now()`
- `updated_by text null`

Indexes:

- `CREATE INDEX ix_blog_posts_published_at ON public.blog_posts USING btree (published_at)`
- `CREATE UNIQUE INDEX pk_blog_posts ON public.blog_posts USING btree (slug)`

## public.board_shares (table)

- `at timestamp with time zone = now()`
- `board_id uuid`
- `by varchar(200)`
- `role varchar(8)`
- `who varchar(200)`

References:

- public.boards (board_id → id)

Indexes:

- `CREATE INDEX ix_board_shares_who ON public.board_shares USING btree (who)`
- `CREATE UNIQUE INDEX pk_board_shares ON public.board_shares USING btree (board_id, who)`

## public.boards (table)

- `archived_at timestamp with time zone null`
- `columns jsonb`
- `created_at timestamp with time zone = now()`
- `general varchar(12) = 'private'::character varying`
- `general_role varchar(8) = 'view'::character varying`
- `id uuid = gen_random_uuid()`
- `is_default boolean = false`
- `name varchar(1200)`
- `owner varchar(200)`
- `updated_at timestamp with time zone = now()`
- `version integer = 1`

Indexes:

- `CREATE INDEX ix_boards_owner ON public.boards USING btree (owner)`
- `CREATE UNIQUE INDEX pk_boards ON public.boards USING btree (id)`
- `CREATE UNIQUE INDEX uq_boards_default ON public.boards USING btree (is_default) WHERE is_default`

## public.briefs (table)

- `citations jsonb`
- `created_at timestamp with time zone = now()`
- `dropped jsonb`
- `inputs_hash varchar(32)`
- `llm jsonb null`
- `model varchar(128)`
- `person_id integer`
- `prompt_version varchar(16)`
- `run_id uuid null`
- `state varchar(16)`
- `text text`

References:

- public.people (person_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_briefs_run_id ON public.briefs USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_briefs ON public.briefs USING btree (person_id)`

## public.broadcast_recipient_records (view)

- `address text null`
- `broadcast text null`
- `broadcast_id integer null`
- `channel text null`
- `due_at timestamp with time zone null`
- `id integer null`
- `name text null`
- `profile_id integer null`
- `profile_link text null`
- `sent_at timestamp with time zone null`
- `state text null`
- `why text null`
- `zone text null`

## public.broadcast_recipients (table)

- `address varchar(320) null`
- `broadcast_id integer`
- `created_at timestamp with time zone = now()`
- `due_at timestamp with time zone`
- `id integer = nextval('broadcast_recipients_id_seq'::regclass)`
- `message_id varchar(998) null`
- `profile_id integer`
- `sent_at timestamp with time zone null`
- `state varchar(8) = 'due'::character varying`
- `why text null`
- `zone varchar(64) null`

References:

- public.broadcasts (broadcast_id → id)
- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_broadcast_recipients_due ON public.broadcast_recipients USING btree (broadcast_id, state, due_at)`
- `CREATE INDEX ix_broadcast_recipients_message_id ON public.broadcast_recipients USING btree (message_id)`
- `CREATE INDEX ix_broadcast_recipients_profile_id ON public.broadcast_recipients USING btree (profile_id)`
- `CREATE UNIQUE INDEX pk_broadcast_recipients ON public.broadcast_recipients USING btree (id)`
- `CREATE UNIQUE INDEX uq_broadcast_recipients_broadcast_profile ON public.broadcast_recipients USING btree (broadcast_id, profile_id)`

## public.broadcast_records (view)

- `asked_at timestamp with time zone null`
- `body text null`
- `by text null`
- `channel text null`
- `created_at timestamp with time zone null`
- `decided_at timestamp with time zone null`
- `decided_by text null`
- `failed integer null`
- `finished_at timestamp with time zone null`
- `id integer null`
- `local boolean null`
- `name text null`
- `note text null`
- `people integer null`
- `recipients text null`
- `segment text null`
- `segment_id integer null`
- `send_at timestamp with time zone null`
- `sent integer null`
- `sent_log text null`
- `size integer null`
- `skipped integer null`
- `started_at timestamp with time zone null`
- `state text null`
- `subject text null`
- `tested_at timestamp with time zone null`
- `tested_to text null`
- `topic text null`
- `waiting integer null`
- `when timestamp with time zone null`
- `zone text null`

## public.broadcasts (table)

- `asked_at timestamp with time zone null`
- `asked_by varchar(320) null`
- `body text`
- `by varchar(320)`
- `channel varchar(8)`
- `created_at timestamp with time zone = now()`
- `decided_at timestamp with time zone null`
- `decided_by varchar(320) null`
- `finished_at timestamp with time zone null`
- `id integer = nextval('broadcasts_id_seq'::regclass)`
- `local boolean = false`
- `name varchar(120)`
- `note text null`
- `segment_id integer`
- `send_at timestamp with time zone null`
- `started_at timestamp with time zone null`
- `state varchar(16) = 'draft'::character varying`
- `subject varchar(200) null`
- `tested_at timestamp with time zone null`
- `tested_to varchar(320) null`
- `topic_id integer`
- `updated_at timestamp with time zone = now()`
- `zone varchar(64) = 'America/New_York'::character varying`

References:

- public.segments (segment_id → id)
- public.topics (topic_id → id)

Indexes:

- `CREATE INDEX ix_broadcasts_segment_id ON public.broadcasts USING btree (segment_id)`
- `CREATE INDEX ix_broadcasts_state ON public.broadcasts USING btree (state, send_at)`
- `CREATE INDEX ix_broadcasts_topic_id ON public.broadcasts USING btree (topic_id)`
- `CREATE UNIQUE INDEX pk_broadcasts ON public.broadcasts USING btree (id)`

## public.call_bookings (table)

- `booked_at timestamp with time zone`
- `code varchar(40) null`
- `created_at timestamp with time zone = now()`
- `email varchar(320) null`
- `enrollment_id integer null`
- `id integer = nextval('call_bookings_id_seq'::regclass)`
- `message_id integer null`
- `name text null`
- `offer varchar(64) null`
- `outcome varchar(16) null`
- `outcome_at timestamp with time zone null`
- `outcome_by text null`
- `outcome_reason text null`
- `start timestamp with time zone null`
- `state varchar(16)`
- `uid varchar(64)`
- `updated_at timestamp with time zone = now()`

References:

- public.enrollments (enrollment_id → id)
- public.messages (message_id → id)

Indexes:

- `CREATE INDEX ix_call_bookings_enrollment_id ON public.call_bookings USING btree (enrollment_id)`
- `CREATE INDEX ix_call_bookings_message_id ON public.call_bookings USING btree (message_id)`
- `CREATE UNIQUE INDEX pk_call_bookings ON public.call_bookings USING btree (id)`
- `CREATE UNIQUE INDEX uq_call_bookings_uid ON public.call_bookings USING btree (uid)`

## public.call_briefs (table)

- `brief jsonb`
- `built_at timestamp with time zone`
- `call_booking_id integer`
- `created_at timestamp with time zone = now()`
- `model varchar(64) null`
- `sent_at timestamp with time zone null`
- `start timestamp with time zone null`

References:

- public.call_bookings (call_booking_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_call_briefs ON public.call_briefs USING btree (call_booking_id)`

## public.call_invites (table)

- `booking_uid varchar(64) null`
- `created_at timestamp with time zone = now()`
- `detail text null`
- `email varchar(320)`
- `enrollment_id integer`
- `id integer = nextval('call_invites_id_seq'::regclass)`
- `reading jsonb null`
- `reply_message_id integer null`
- `run_id uuid null`
- `start timestamp with time zone null`
- `state varchar(32)`
- `thread_event_id integer`
- `time_zone varchar(64) null`
- `updated_at timestamp with time zone = now()`

References:

- public.enrollments (enrollment_id → id)
- public.messages (reply_message_id → id)
- public.runs (run_id → id)
- public.thread_events (thread_event_id → id)

Indexes:

- `CREATE INDEX ix_call_invites_enrollment_id ON public.call_invites USING btree (enrollment_id)`
- `CREATE INDEX ix_call_invites_reply_message_id ON public.call_invites USING btree (reply_message_id)`
- `CREATE INDEX ix_call_invites_run_id ON public.call_invites USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_call_invites ON public.call_invites USING btree (id)`
- `CREATE UNIQUE INDEX uq_call_invites_thread_event_id ON public.call_invites USING btree (thread_event_id)`

## public.call_recordings (table)

- `by varchar(8)`
- `bytes bigint`
- `call_booking_id integer null`
- `created_at timestamp with time zone = now()`
- `duration_s integer`
- `ended_at timestamp with time zone`
- `file_key text`
- `id integer = nextval('call_recordings_id_seq'::regclass)`
- `model varchar(64) null`
- `notes jsonb null`
- `segments jsonb`
- `started_at timestamp with time zone`
- `transcript text`

References:

- public.call_bookings (call_booking_id → id)

Indexes:

- `CREATE INDEX ix_call_recordings_call_booking_id ON public.call_recordings USING btree (call_booking_id)`
- `CREATE UNIQUE INDEX pk_call_recordings ON public.call_recordings USING btree (id)`
- `CREATE UNIQUE INDEX uq_call_recordings_file_key ON public.call_recordings USING btree (file_key)`

## public.calls (table)

- `called_at timestamp with time zone = now()`
- `called_by varchar(320)`
- `id integer = nextval('calls_id_seq'::regclass)`
- `person_id integer`

References:

- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_calls_person_id ON public.calls USING btree (person_id, called_at)`
- `CREATE UNIQUE INDEX pk_calls ON public.calls USING btree (id)`

## public.campaign_controls (table)

- `campaign text`
- `kill_switch boolean null`
- `openers_per_day integer null`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

Indexes:

- `CREATE UNIQUE INDEX pk_campaign_controls ON public.campaign_controls USING btree (campaign)`

## public.campaign_funnel (view)

- `active bigint null`
- `auto_replies numeric null`
- `enrolled bigint null`
- `enrollment_kind varchar(32) null`
- `finished bigint null`
- `followups_sent numeric null`
- `hard_bounces numeric null`
- `interested numeric null`
- `niche varchar(32) null`
- `openers_sent numeric null`
- `recycled boolean null`
- `replies numeric null`
- `sequence_name varchar(64) null`
- `stopped_bounce bigint null`
- `stopped_complaint bigint null`
- `stopped_manual bigint null`
- `stopped_opt_out bigint null`
- `stopped_reply bigint null`
- `unsubscribes numeric null`

## public.candidate_mints (table)

- `minted_at timestamp with time zone = now()`
- `person_id integer`

References:

- public.people (person_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_candidate_mints ON public.candidate_mints USING btree (person_id)`

## public.changes (table)

- `after jsonb`
- `at timestamp with time zone = now()`
- `before jsonb`
- `by varchar(200)`
- `id integer = nextval('changes_id_seq'::regclass)`
- `record varchar(64)`
- `record_id varchar(200)`
- `run_id uuid null`
- `undoes integer null`
- `version varchar(16)`
- `via varchar(16)`

References:

- public.changes (undoes → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_changes_record_record_id ON public.changes USING btree (record, record_id, id)`
- `CREATE INDEX ix_changes_run_id ON public.changes USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_changes ON public.changes USING btree (id)`
- `CREATE UNIQUE INDEX uq_changes_undoes ON public.changes USING btree (undoes)`

## public.chat_messages (table)

- `at timestamp with time zone = now()`
- `body text`
- `by varchar(200) null`
- `direction varchar(3)`
- `id integer = nextval('chat_messages_id_seq'::regclass)`
- `thread_id integer`

References:

- public.chat_threads (thread_id → id)

Indexes:

- `CREATE INDEX ix_chat_messages_thread ON public.chat_messages USING btree (thread_id, id)`
- `CREATE UNIQUE INDEX pk_chat_messages ON public.chat_messages USING btree (id)`

## public.chat_threads (table)

- `created_at timestamp with time zone = now()`
- `email varchar(200) null`
- `id integer = nextval('chat_threads_id_seq'::regclass)`
- `ip_hash varchar(64) null`
- `key_hash varchar(64)`
- `last_in_at timestamp with time zone = now()`
- `name varchar(1200) null`
- `page text null`
- `phone varchar(32) null`
- `read_at timestamp with time zone null`

Indexes:

- `CREATE INDEX ix_chat_threads_created ON public.chat_threads USING btree (created_at)`
- `CREATE INDEX ix_chat_threads_ip ON public.chat_threads USING btree (ip_hash, created_at)`
- `CREATE INDEX ix_chat_threads_last ON public.chat_threads USING btree (last_in_at)`
- `CREATE UNIQUE INDEX pk_chat_threads ON public.chat_threads USING btree (id)`
- `CREATE UNIQUE INDEX uq_chat_threads_key ON public.chat_threads USING btree (key_hash)`

## public.check_outcomes (table)

- `at timestamp with time zone = now()`
- `check varchar(120)`
- `id integer = nextval('check_outcomes_id_seq'::regclass)`
- `ok boolean`
- `reason text null`
- `source varchar(64)`
- `stage varchar(64)`
- `subject varchar(200) null`

Indexes:

- `CREATE INDEX ix_check_outcomes_stage_source ON public.check_outcomes USING btree (stage, source, id)`
- `CREATE UNIQUE INDEX pk_check_outcomes ON public.check_outcomes USING btree (id)`

## public.check_rates (view)

- `check varchar(120) null`
- `id text null`
- `last_at timestamp with time zone null`
- `passed integer null`
- `rate real null`
- `source varchar(64) null`
- `stage varchar(64) null`
- `state text null`
- `total integer null`

## public.click_syncs (table)

- `base_url varchar(255)`
- `cursor_id bigint = 0`
- `stats jsonb null`
- `synced_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_click_syncs ON public.click_syncs USING btree (base_url)`

## public.client_accounts (table)

- `client varchar(40) null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `id integer = nextval('client_accounts_id_seq'::regclass)`
- `login varchar(120) null`
- `mode varchar(8) = 'self'::character varying`
- `ref varchar(200)`
- `role varchar(32) = 'main'::character varying`
- `site varchar(32)`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_client_accounts ON public.client_accounts USING btree (id)`
- `CREATE UNIQUE INDEX uq_client_accounts_ref ON public.client_accounts USING btree (client, site, ref) NULLS NOT DISTINCT`

## public.client_domains (table)

- `added_by text`
- `cf_id text`
- `checked_at timestamp with time zone = now()`
- `client_id varchar(40)`
- `created_at timestamp with time zone = now()`
- `hostname text`
- `problem text null`
- `records jsonb`
- `ssl_status text`
- `status text`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE INDEX ix_client_domains_client ON public.client_domains USING btree (client_id)`
- `CREATE UNIQUE INDEX pk_client_domains ON public.client_domains USING btree (hostname)`

## public.client_members (table)

- `client_id varchar(40)`
- `email text`
- `invited_at timestamp with time zone = now()`
- `invited_by text null`
- `last_seen_at timestamp with time zone null`
- `role varchar(64) = 'member'::character varying`

References:

- public.clients (client_id → id)
- public.roles (role → id)

Indexes:

- `CREATE INDEX ix_client_members_email ON public.client_members USING btree (email)`
- `CREATE INDEX ix_client_members_role ON public.client_members USING btree (role)`
- `CREATE UNIQUE INDEX pk_client_members ON public.client_members USING btree (client_id, email)`

## public.client_profile (table)

- `default_recruiter varchar(320) null`
- `fee_avg integer null`
- `firm text`
- `one boolean = true`
- `recruiters jsonb = '[]'::jsonb`
- `sells text`
- `signature text`
- `updated_at timestamp with time zone = now()`
- `voice text`

Indexes:

- `CREATE UNIQUE INDEX pk_client_profile ON public.client_profile USING btree (one)`

## public.client_records (view)

- `added timestamp with time zone null`
- `id text null`
- `kind text null`
- `last_seen timestamp with time zone null`
- `members bigint null`
- `name text null`
- `products text null`
- `sends text null`

## public.client_report_sends (table)

- `at timestamp with time zone = now()`
- `by varchar(320) null`
- `closed boolean`
- `from timestamp with time zone`
- `id integer = nextval('client_report_sends_id_seq'::regclass)`
- `lines jsonb`
- `report_id integer`
- `sent_to jsonb = '[]'::jsonb`
- `to timestamp with time zone`
- `why text null`

References:

- public.client_reports (report_id → id)

Indexes:

- `CREATE INDEX ix_client_report_sends_report ON public.client_report_sends USING btree (report_id, at)`
- `CREATE UNIQUE INDEX pk_client_report_sends ON public.client_report_sends USING btree (id)`

## public.client_reports (table)

- `by varchar(320)`
- `client varchar(64)`
- `created_at timestamp with time zone = now()`
- `every varchar(8)`
- `id integer = nextval('client_reports_id_seq'::regclass)`
- `name varchar(120)`
- `next_at timestamp with time zone null`
- `on boolean = true`
- `recipients jsonb = '[]'::jsonb`
- `tiles jsonb`
- `updated_at timestamp with time zone = now()`
- `zone varchar(64)`

Indexes:

- `CREATE INDEX ix_client_reports_client ON public.client_reports USING btree (client)`
- `CREATE UNIQUE INDEX pk_client_reports ON public.client_reports USING btree (id)`

## public.client_secret_events (table)

- `at timestamp with time zone = now()`
- `by varchar(320)`
- `client varchar(40)`
- `id bigint = nextval('client_secret_events_id_seq'::regclass)`
- `name varchar(64)`
- `op varchar(8)`
- `secret varchar(35)`
- `why text null`

Indexes:

- `CREATE INDEX ix_client_secret_events_client_at ON public.client_secret_events USING btree (client, at)`
- `CREATE UNIQUE INDEX pk_client_secret_events ON public.client_secret_events USING btree (id)`

## public.client_secrets (table)

- `bound_from varchar(35) null`
- `client varchar(40)`
- `created_at timestamp with time zone = now()`
- `created_by varchar(320)`
- `id varchar(35)`
- `key_id varchar(12) null`
- `kid varchar(16)`
- `label varchar(64) = 'default'::character varying`
- `last4 varchar(4)`
- `name varchar(64)`
- `sealed bytea`
- `state varchar(8)`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(320)`
- `version integer = 1`
- `wrapped bytea`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_client_secrets ON public.client_secrets USING btree (id)`
- `CREATE UNIQUE INDEX uq_client_secrets_live ON public.client_secrets USING btree (client, name, label) WHERE ((state)::text = 'live'::text)`

## public.clients (table)

- `accounts jsonb = '{}'::jsonb`
- `approver varchar(8) = 'wren'::character varying`
- `buys_ok boolean = false`
- `created_at timestamp with time zone = now()`
- `database varchar(63)`
- `demo boolean = false`
- `id varchar(40)`
- `look jsonb null`
- `name text`
- `products jsonb = '{}'::jsonb`
- `sandbox boolean = false`
- `sends text[] = '{}'::text[]`
- `setup_mode varchar(8) = 'self'::character varying`

Indexes:

- `CREATE UNIQUE INDEX pk_clients ON public.clients USING btree (id)`
- `CREATE UNIQUE INDEX uq_clients_database ON public.clients USING btree (database)`

## public.comment_keyword_records (view)

- `caught integer null`
- `dm text null`
- `failed integer null`
- `id text null`
- `keyword varchar(40) null`
- `last_at timestamp with time zone null`
- `platform varchar null`
- `post varchar null`
- `reply text null`
- `sent integer null`
- `state text null`
- `updated_at timestamp with time zone null`
- `updated_by text null`

## public.comment_keywords (table)

- `active boolean = true`
- `created_at timestamp with time zone = now()`
- `dm text`
- `id integer = nextval('comment_keywords_id_seq'::regclass)`
- `keyword varchar(40)`
- `platform varchar(16) null`
- `post varchar(200) null`
- `reply text null`
- `updated_at timestamp with time zone = now()`
- `updated_by text null`

References:

- public.platform_objects (platform → platform, post → ref)

Indexes:

- `CREATE INDEX ix_comment_keywords_platform_post ON public.comment_keywords USING btree (platform, post)`
- `CREATE UNIQUE INDEX pk_comment_keywords ON public.comment_keywords USING btree (id)`
- `CREATE UNIQUE INDEX uq_comment_keywords_scope ON public.comment_keywords USING btree (keyword, COALESCE(platform, ''::character varying), COALESCE(post, ''::character varying))`

## public.comment_proofs (table)

- `checked_at timestamp with time zone null`
- `checks jsonb = '[]'::jsonb`
- `created_at timestamp with time zone = now()`
- `item varchar(80)`
- `note text null`
- `platform varchar(16)`
- `shot text null`
- `state varchar(16) = 'pending'::character varying`
- `url text null`

Indexes:

- `CREATE INDEX ix_comment_proofs_checked_at ON public.comment_proofs USING btree (checked_at)`
- `CREATE UNIQUE INDEX pk_comment_proofs ON public.comment_proofs USING btree (item)`

## public.comment_threads (table)

- `account_id uuid`
- `active_at timestamp with time zone`
- `check_at timestamp with time zone = now()`
- `count integer null`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('comment_threads_id_seq'::regclass)`
- `more integer = 0`
- `nodes jsonb = '[]'::jsonb`
- `platform varchar(16)`
- `post varchar(200)`
- `post_at timestamp with time zone null`
- `post_author varchar(120) null`
- `post_media text null`
- `post_place varchar(200) null`
- `post_text text null`
- `post_title text null`
- `post_url text null`
- `read_at timestamp with time zone null`
- `until timestamp with time zone`

References:

- public.platform_objects (platform → platform, post → ref)
- public.reach_accounts (account_id → id)

Indexes:

- `CREATE INDEX ix_comment_threads_account_id ON public.comment_threads USING btree (account_id)`
- `CREATE INDEX ix_comment_threads_until ON public.comment_threads USING btree (until)`
- `CREATE UNIQUE INDEX pk_comment_threads ON public.comment_threads USING btree (id)`
- `CREATE UNIQUE INDEX uq_comment_threads_platform_post ON public.comment_threads USING btree (platform, post)`

## public.comments (table)

- `account_id uuid null`
- `answer text null`
- `answer_ref varchar(200) null`
- `answered_at timestamp with time zone null`
- `at timestamp with time zone`
- `author varchar(120)`
- `body text`
- `channel varchar(16) = 'reach'::character varying`
- `contact_id integer null`
- `created_at timestamp with time zone = now()`
- `draft text null`
- `id integer = nextval('comments_id_seq'::regclass)`
- `kind varchar(32)`
- `parent varchar(200)`
- `place varchar(200) null`
- `platform varchar(16)`
- `post varchar(200)`
- `post_title text null`
- `raw jsonb`
- `ref varchar(200)`
- `sort varchar(16) null`
- `stars smallint null`
- `state varchar(16) = 'new'::character varying`
- `url text`
- `why text null`

References:

- public.platform_objects (platform → platform, answer_ref → ref; platform → platform, parent → ref; platform → platform, post → ref; platform → platform, ref → ref)
- public.reach_accounts (account_id → id)
- public.reach_contacts (contact_id → id)

Indexes:

- `CREATE INDEX ix_comments_account_id ON public.comments USING btree (account_id)`
- `CREATE INDEX ix_comments_contact_id ON public.comments USING btree (contact_id)`
- `CREATE INDEX ix_comments_platform_answer_ref ON public.comments USING btree (platform, answer_ref)`
- `CREATE INDEX ix_comments_platform_parent ON public.comments USING btree (platform, parent)`
- `CREATE INDEX ix_comments_platform_post ON public.comments USING btree (platform, post)`
- `CREATE INDEX ix_comments_post ON public.comments USING btree (post)`
- `CREATE INDEX ix_comments_state ON public.comments USING btree (state)`
- `CREATE UNIQUE INDEX pk_comments ON public.comments USING btree (id)`
- `CREATE UNIQUE INDEX uq_comments_platform_ref ON public.comments USING btree (platform, ref)`

## public.companies (table)

- `country varchar(2) null`
- `crawled_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `decline_reason varchar(32) null`
- `domain varchar(255) null`
- `domain_verified_at timestamp with time zone null`
- `headcount text null`
- `id integer = nextval('companies_id_seq'::regclass)`
- `import_id integer null`
- `lead_at timestamp with time zone null`
- `linkedin_url varchar(512) null`
- `name varchar null`
- `named_at timestamp with time zone null`
- `niche varchar(32) null`
- `raw jsonb null`
- `social_url varchar(512) null`
- `source_key varchar(64) null`
- `timezone varchar(64) null`

References:

- public.imports (import_id → id)

Indexes:

- `CREATE INDEX ix_companies_firm_records ON public.companies USING btree (id, niche, decline_reason, domain, created_at, name, crawled_at, named_at, lead_at) WHERE (niche IS NOT NULL)`
- `CREATE INDEX ix_companies_import_id ON public.companies USING btree (import_id)`
- `CREATE INDEX ix_companies_unassigned ON public.companies USING btree (id) WHERE (niche IS NULL)`
- `CREATE UNIQUE INDEX pk_companies ON public.companies USING btree (id)`
- `CREATE UNIQUE INDEX uq_companies_domain ON public.companies USING btree (domain)`
- `CREATE UNIQUE INDEX uq_companies_source_key ON public.companies USING btree (source_key)`

## public.company_checks (table)

- `checked_at timestamp with time zone = now()`
- `company_id integer`
- `finding_id integer null`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `state varchar(16)`
- `tried jsonb`

References:

- public.companies (company_id → id)
- public.findings (finding_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_company_checks_finding_id ON public.company_checks USING btree (finding_id)`
- `CREATE INDEX ix_company_checks_run_id ON public.company_checks USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_company_checks ON public.company_checks USING btree (company_id)`

## public.company_event_checks (table)

- `checked_at timestamp with time zone = now()`
- `company_id integer`
- `events integer = 0`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `state varchar(16)`
- `tried jsonb`

References:

- public.companies (company_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_company_event_checks_run_id ON public.company_event_checks USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_company_event_checks ON public.company_event_checks USING btree (company_id)`

## public.company_lookups (table)

- `company_id integer`
- `looked_up_at timestamp with time zone = now()`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `state varchar(16)`
- `tried jsonb`

References:

- public.companies (company_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_company_lookups_run_id ON public.company_lookups USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_company_lookups ON public.company_lookups USING btree (company_id)`

## public.compositions (table)

- `created_at timestamp with time zone = now()`
- `detail text null`
- `enrollment_id integer null`
- `id integer = nextval('compositions_id_seq'::regclass)`
- `inputs_hash varchar(32)`
- `llm jsonb null`
- `model varchar(128)`
- `person_id integer`
- `prompt_version varchar(16)`
- `run_id uuid null`
- `state varchar(16)`

References:

- public.enrollments (enrollment_id → id)
- public.people (person_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_compositions_enrollment_id ON public.compositions USING btree (enrollment_id)`
- `CREATE INDEX ix_compositions_person_id ON public.compositions USING btree (person_id)`
- `CREATE INDEX ix_compositions_run_id ON public.compositions USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_compositions ON public.compositions USING btree (id)`

## public.connector_fired (table)

- `at timestamp with time zone = now()`
- `key varchar(160)`
- `link_id integer`

References:

- public.connector_links (link_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_connector_fired ON public.connector_fired USING btree (link_id, key)`

## public.connector_grants (table)

- `app varchar(16)`
- `by varchar(320)`
- `client varchar(64)`
- `created_at timestamp with time zone = now()`
- `expires_at timestamp with time zone`
- `state varchar(64)`
- `used_at timestamp with time zone null`

Indexes:

- `CREATE INDEX ix_connector_grants_client ON public.connector_grants USING btree (client)`
- `CREATE UNIQUE INDEX pk_connector_grants ON public.connector_grants USING btree (state)`

## public.connector_links (table)

- `app varchar(16)`
- `by varchar(320)`
- `client varchar(64)`
- `connected_at timestamp with time zone = now()`
- `cursor jsonb = '{}'::jsonb`
- `external_id varchar(128)`
- `extra jsonb = '{}'::jsonb`
- `fired integer = 0`
- `id integer = nextval('connector_links_id_seq'::regclass)`
- `name text null`
- `people integer = 0`
- `scopes text`
- `state varchar(12) = 'connected'::character varying`
- `synced_at timestamp with time zone null`
- `token_ref varchar(64)`
- `why text null`

Indexes:

- `CREATE UNIQUE INDEX pk_connector_links ON public.connector_links USING btree (id)`
- `CREATE UNIQUE INDEX uq_connector_links_account ON public.connector_links USING btree (client, app, external_id)`

## public.consent_events (table)

- `by varchar(320)`
- `consent_id integer`
- `created_at timestamp with time zone = now()`
- `evidence jsonb null`
- `id integer = nextval('consent_events_id_seq'::regclass)`
- `kind varchar(16)`
- `message_id varchar(998) null`

References:

- public.consents (consent_id → id)

Indexes:

- `CREATE INDEX ix_consent_events_consent_id ON public.consent_events USING btree (consent_id, created_at)`
- `CREATE INDEX ix_consent_events_message_id ON public.consent_events USING btree (message_id)`
- `CREATE UNIQUE INDEX pk_consent_events ON public.consent_events USING btree (id)`

## public.consents (table)

- `address varchar(320)`
- `channel varchar(16)`
- `confirmed_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `frequency varchar(16) = 'as_sent'::character varying`
- `id integer = nextval('consents_id_seq'::regclass)`
- `last_sent_at timestamp with time zone null`
- `paused_until timestamp with time zone null`
- `pending_at timestamp with time zone null`
- `source varchar(32)`
- `state varchar(16)`
- `text_version varchar(64)`
- `topic_id integer`
- `withdrawn_at timestamp with time zone null`

References:

- public.topics (topic_id → id)

Indexes:

- `CREATE INDEX ix_consents_topic_id ON public.consents USING btree (topic_id)`
- `CREATE UNIQUE INDEX pk_consents ON public.consents USING btree (id)`
- `CREATE UNIQUE INDEX uq_consents_channel ON public.consents USING btree (channel, address, topic_id)`

## public.contact_candidates (table)

- `created_at timestamp with time zone = now()`
- `domain varchar(255)`
- `email varchar(320)`
- `evidence varchar(32)`
- `id integer = nextval('contact_candidates_id_seq'::regclass)`
- `lead_id integer null`
- `pattern varchar(32) null`
- `person_id integer`
- `rank integer`
- `source_ref text`
- `state varchar(32)`

References:

- public.leads (lead_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_contact_candidates_domain ON public.contact_candidates USING btree (domain)`
- `CREATE INDEX ix_contact_candidates_lead_id ON public.contact_candidates USING btree (lead_id)`
- `CREATE UNIQUE INDEX pk_contact_candidates ON public.contact_candidates USING btree (id)`
- `CREATE UNIQUE INDEX uq_contact_candidates_person_id ON public.contact_candidates USING btree (person_id, email)`

## public.contact_outcomes (view)

- `company_id integer null`
- `contact_round integer null`
- `enrolled_at timestamp with time zone null`
- `enrollment_id integer null`
- `last_touch_at timestamp with time zone null`
- `niche varchar(32) null`
- `offer varchar(64) null`
- `outcome text null`
- `sequence_name varchar(64) null`
- `to_email varchar(320) null`

## public.contact_points (table)

- `company_id integer`
- `created_at timestamp with time zone = now()`
- `document_id integer null`
- `id integer = nextval('contact_points_id_seq'::regclass)`
- `kind varchar(32)`
- `pages integer = 1`
- `person_id integer null`
- `seen_at timestamp with time zone = now()`
- `source varchar(16)`
- `source_url text`
- `value varchar(512)`

References:

- public.companies (company_id → id)
- public.documents (document_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_contact_points_document_id ON public.contact_points USING btree (document_id)`
- `CREATE INDEX ix_contact_points_kind_id ON public.contact_points USING btree (kind, id)`
- `CREATE INDEX ix_contact_points_kind_value ON public.contact_points USING btree (kind, value)`
- `CREATE INDEX ix_contact_points_person_id ON public.contact_points USING btree (person_id)`
- `CREATE UNIQUE INDEX pk_contact_points ON public.contact_points USING btree (id)`
- `CREATE UNIQUE INDEX uq_contact_points_company_kind_value ON public.contact_points USING btree (company_id, kind, value)`

## public.contact_scores (table)

- `computed_at timestamp with time zone = now()`
- `next_step varchar(16) null`
- `person_id integer`
- `reasons jsonb`
- `score integer`

References:

- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_contact_scores_score ON public.contact_scores USING btree (score)`
- `CREATE UNIQUE INDEX pk_contact_scores ON public.contact_scores USING btree (person_id)`

## public.content_digests (table)

- `created_at timestamp with time zone = now()`
- `lines jsonb`
- `platform varchar(16)`
- `week date`

Indexes:

- `CREATE UNIQUE INDEX pk_content_digests ON public.content_digests USING btree (week, platform)`

## public.content_drafts (table)

- `approved_at timestamp with time zone null`
- `check jsonb null`
- `created_at timestamp with time zone = now()`
- `edited boolean = false`
- `error text null`
- `extra jsonb = '{}'::jsonb`
- `id uuid = gen_random_uuid()`
- `idea_id uuid`
- `linked boolean null`
- `llm jsonb null`
- `media jsonb null`
- `note text null`
- `platform varchar(16)`
- `playbook_id uuid null`
- `points_to varchar(16) = 'site'::character varying`
- `prompt_version varchar(16)`
- `published_at timestamp with time zone null`
- `published_id varchar(255) null`
- `redraft_of uuid null`
- `scheduled_for timestamp with time zone null`
- `site_page uuid null`
- `stage varchar(16) = 'reach'::character varying`
- `status varchar(16) = 'draft'::character varying`
- `text text`
- `title varchar(2000) null`
- `url varchar(2048) null`
- `video_draft uuid null`

References:

- public.content_drafts (redraft_of → id; video_draft → id)
- public.content_ideas (idea_id → id)
- public.content_playbooks (playbook_id → id)
- public.platform_objects (platform → platform, published_id → ref)

Indexes:

- `CREATE INDEX ix_content_drafts_idea_id ON public.content_drafts USING btree (idea_id)`
- `CREATE INDEX ix_content_drafts_platform_created_at ON public.content_drafts USING btree (platform, created_at)`
- `CREATE INDEX ix_content_drafts_platform_published_id ON public.content_drafts USING btree (platform, published_id)`
- `CREATE INDEX ix_content_drafts_playbook_id ON public.content_drafts USING btree (playbook_id)`
- `CREATE INDEX ix_content_drafts_redraft_of ON public.content_drafts USING btree (redraft_of)`
- `CREATE INDEX ix_content_drafts_status_scheduled_for ON public.content_drafts USING btree (status, scheduled_for)`
- `CREATE INDEX ix_content_drafts_video_draft ON public.content_drafts USING btree (video_draft)`
- `CREATE UNIQUE INDEX pk_content_drafts ON public.content_drafts USING btree (id)`

## public.content_ideas (table)

- `angle varchar(16) null`
- `created_at timestamp with time zone = now()`
- `id uuid = gen_random_uuid()`
- `line varchar(64) null`
- `media jsonb null`
- `ref varchar(200) null`
- `source varchar(16)`
- `status varchar(16) = 'open'::character varying`
- `text text`

Indexes:

- `CREATE INDEX ix_content_ideas_status_created_at ON public.content_ideas USING btree (status, created_at)`
- `CREATE UNIQUE INDEX pk_content_ideas ON public.content_ideas USING btree (id)`
- `CREATE UNIQUE INDEX uq_content_ideas_ref ON public.content_ideas USING btree (ref)`

## public.content_metrics (table)

- `as_of timestamp with time zone`
- `comments integer`
- `created_at timestamp with time zone = now()`
- `draft_id uuid`
- `fetched_with varchar(16)`
- `follows integer null`
- `id uuid = gen_random_uuid()`
- `reactions integer`
- `shares integer`
- `views integer`

References:

- public.content_drafts (draft_id → id)

Indexes:

- `CREATE INDEX ix_content_metrics_draft_id_created_at ON public.content_metrics USING btree (draft_id, created_at)`
- `CREATE UNIQUE INDEX pk_content_metrics ON public.content_metrics USING btree (id)`

## public.content_playbooks (table)

- `created_at timestamp with time zone = now()`
- `id uuid = gen_random_uuid()`
- `platform varchar(16)`
- `scope jsonb null`
- `sop varchar(64)`
- `text text`

Indexes:

- `CREATE INDEX ix_content_playbooks_platform_created_at ON public.content_playbooks USING btree (platform, created_at)`
- `CREATE UNIQUE INDEX pk_content_playbooks ON public.content_playbooks USING btree (id)`

## public.crm_contacts (table)

- `added_on date null`
- `company_id integer`
- `created_at timestamp with time zone = now()`
- `crm_key varchar(128)`
- `email varchar(320) null`
- `format varchar(32)`
- `id integer = nextval('crm_contacts_id_seq'::regclass)`
- `import_id integer`
- `last_contacted_on date null`
- `last_placement_on date null`
- `owner text null`
- `person_id integer`
- `phone varchar(64) null`
- `raw jsonb`
- `row_number integer`
- `status text null`
- `updated_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_crm_contacts_company_id ON public.crm_contacts USING btree (company_id)`
- `CREATE INDEX ix_crm_contacts_import_id ON public.crm_contacts USING btree (import_id)`
- `CREATE INDEX ix_crm_contacts_person_id ON public.crm_contacts USING btree (person_id)`
- `CREATE UNIQUE INDEX pk_crm_contacts ON public.crm_contacts USING btree (id)`
- `CREATE UNIQUE INDEX uq_crm_contacts_key ON public.crm_contacts USING btree (format, crm_key)`

## public.custom_field_values (table)

- `field uuid`
- `row text`
- `updated_at timestamp with time zone = now()`
- `updated_by text`
- `value jsonb`

References:

- public.custom_fields (field → id)

Indexes:

- `CREATE UNIQUE INDEX pk_custom_field_values ON public.custom_field_values USING btree (field, "row")`

## public.custom_fields (table)

- `archived_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `id uuid = gen_random_uuid()`
- `key varchar(40)`
- `kind varchar(8)`
- `label varchar(800)`
- `options jsonb null`
- `owner varchar(40) null`
- `position integer = 0`
- `record varchar(80)`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.clients (owner → id)

Indexes:

- `CREATE UNIQUE INDEX pk_custom_fields ON public.custom_fields USING btree (id)`
- `CREATE UNIQUE INDEX uq_custom_fields_key ON public.custom_fields USING btree (owner, record, key) NULLS NOT DISTINCT`

## public.custom_values (table)

- `created_at timestamp with time zone = now()`
- `created_by text`
- `id uuid = gen_random_uuid()`
- `key varchar(40)`
- `label varchar(800)`
- `owner varchar(40) null`
- `updated_at timestamp with time zone = now()`
- `updated_by text`
- `value varchar(20000)`

References:

- public.clients (owner → id)

Indexes:

- `CREATE UNIQUE INDEX pk_custom_values ON public.custom_values USING btree (id)`
- `CREATE UNIQUE INDEX uq_custom_values_key ON public.custom_values USING btree (owner, key) NULLS NOT DISTINCT`

## public.dead_letters (table)

- `end varchar(8) null`
- `ended_at timestamp with time zone null`
- `ended_by varchar(320) null`
- `error text null`
- `id integer = nextval('dead_letters_id_seq'::regclass)`
- `invocation_id varchar(64)`
- `invoked_by varchar(200) null`
- `key text null`
- `paused_at timestamp with time zone`
- `seen_at timestamp with time zone = now()`
- `target varchar(200)`
- `told_at timestamp with time zone null`

Indexes:

- `CREATE INDEX ix_dead_letters_open ON public.dead_letters USING btree (ended_at, paused_at)`
- `CREATE UNIQUE INDEX pk_dead_letters ON public.dead_letters USING btree (id)`
- `CREATE UNIQUE INDEX uq_dead_letters_invocation ON public.dead_letters USING btree (invocation_id)`

## public.decision_calls (table)

- `agreed boolean null`
- `at timestamp with time zone = now()`
- `by varchar(320) null`
- `comment text null`
- `decision_id integer null`
- `id integer = nextval('decision_calls_id_seq'::regclass)`
- `keep boolean`
- `kind varchar(40)`
- `label varchar(40)`
- `override boolean = false`
- `ref varchar(300) null`
- `source varchar(40)`
- `subject varchar(200)`

References:

- public.decisions (decision_id → id)

Indexes:

- `CREATE INDEX ix_decision_calls_decision_id ON public.decision_calls USING btree (decision_id)`
- `CREATE INDEX ix_decision_calls_subject ON public.decision_calls USING btree (kind, subject, at)`
- `CREATE UNIQUE INDEX pk_decision_calls ON public.decision_calls USING btree (id)`
- `CREATE UNIQUE INDEX uq_decision_calls_ref ON public.decision_calls USING btree (ref)`

## public.decisions (table)

- `answers jsonb null`
- `at timestamp with time zone = now()`
- `backend varchar(20)`
- `confidence double precision null`
- `cost_usd double precision = 0`
- `error text null`
- `id integer = nextval('decisions_id_seq'::regclass)`
- `input_tokens integer null`
- `kind varchar(40)`
- `label varchar(40) null`
- `latency_ms integer null`
- `mode varchar(10)`
- `model varchar(100)`
- `output_tokens integer null`
- `p double precision null`
- `questions jsonb`
- `ref varchar(300) null`
- `state jsonb`
- `subject varchar(200)`

Indexes:

- `CREATE INDEX ix_decisions_kind_at ON public.decisions USING btree (kind, at)`
- `CREATE INDEX ix_decisions_subject ON public.decisions USING btree (kind, subject, at)`
- `CREATE UNIQUE INDEX pk_decisions ON public.decisions USING btree (id)`
- `CREATE UNIQUE INDEX uq_decisions_ref ON public.decisions USING btree (ref)`

## public.discovery_attempts (table)

- `attempted_at timestamp with time zone = now()`
- `company_id integer`
- `id integer = nextval('discovery_attempts_id_seq'::regclass)`
- `import_id integer null`
- `kind varchar(16)`
- `outcome varchar(32)`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)

Indexes:

- `CREATE INDEX ix_discovery_attempts_company_kind ON public.discovery_attempts USING btree (company_id, kind, attempted_at)`
- `CREATE INDEX ix_discovery_attempts_import_id ON public.discovery_attempts USING btree (import_id)`
- `CREATE UNIQUE INDEX pk_discovery_attempts ON public.discovery_attempts USING btree (id)`

## public.doc_counters (table)

- `client varchar(40)`
- `kind varchar(10)`
- `next integer = 1`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_doc_counters ON public.doc_counters USING btree (client, kind)`

## public.doc_events (table)

- `agent text null`
- `at timestamp with time zone = now()`
- `by text`
- `document uuid`
- `id bigint = nextval('doc_events_id_seq'::regclass)`
- `ip varchar(64) null`
- `note text null`
- `type varchar(10)`

References:

- public.docs (document → id)

Indexes:

- `CREATE INDEX ix_doc_events_document ON public.doc_events USING btree (document, at)`
- `CREATE UNIQUE INDEX pk_doc_events ON public.doc_events USING btree (id)`

## public.doc_templates (table)

- `archived_at timestamp with time zone null`
- `body text = ''::text`
- `client varchar(40)`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `deposit_pct integer null`
- `expires_days integer = 30`
- `id uuid = gen_random_uuid()`
- `kind varchar(10)`
- `lines jsonb = '[]'::jsonb`
- `name varchar(1200)`
- `starter varchar(20) null`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_doc_templates ON public.doc_templates USING btree (id)`
- `CREATE UNIQUE INDEX uq_doc_templates_starter ON public.doc_templates USING btree (client, starter)`

## public.docs (table)

- `approved_at timestamp with time zone null`
- `approved_by text null`
- `body text = ''::text`
- `channel varchar(8) = 'email'::character varying`
- `client varchar(40)`
- `consent_version varchar(16) null`
- `contact integer null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `currency varchar(3) = 'usd'::character varying`
- `declined_at timestamp with time zone null`
- `declined_why text null`
- `deposit_cents integer null`
- `email text null`
- `envelope_id varchar(40) null`
- `expires_at timestamp with time zone null`
- `expires_days integer = 30`
- `id uuid = gen_random_uuid()`
- `kind varchar(10)`
- `lines jsonb = '[]'::jsonb`
- `message integer null`
- `name text null`
- `number varchar(16)`
- `pay_link uuid null`
- `sealed jsonb null`
- `sent_at timestamp with time zone null`
- `sha256 varchar(64) null`
- `signed_agent text null`
- `signed_at timestamp with time zone null`
- `signed_ip varchar(64) null`
- `signer_email text null`
- `signer_name text null`
- `signing varchar(8) = 'own'::character varying`
- `status varchar(8) = 'draft'::character varying`
- `subtotal_cents integer = 0`
- `tax_cents integer = 0`
- `template uuid null`
- `title varchar(2000)`
- `token_hash varchar(64) null`
- `total_cents integer = 0`
- `updated_at timestamp with time zone = now()`
- `viewed_at timestamp with time zone null`
- `why text null`

References:

- public.clients (client → id)
- public.doc_templates (template → id)

Indexes:

- `CREATE INDEX ix_docs_client_created ON public.docs USING btree (client, created_at)`
- `CREATE INDEX ix_docs_status ON public.docs USING btree (status)`
- `CREATE INDEX ix_docs_template ON public.docs USING btree (template)`
- `CREATE UNIQUE INDEX pk_docs ON public.docs USING btree (id)`
- `CREATE UNIQUE INDEX uq_docs_envelope ON public.docs USING btree (envelope_id) WHERE (envelope_id IS NOT NULL)`
- `CREATE UNIQUE INDEX uq_docs_number ON public.docs USING btree (client, number)`
- `CREATE UNIQUE INDEX uq_docs_token ON public.docs USING btree (token_hash)`

## public.documents (table)

- `block_reason text null`
- `company_id integer null`
- `content_hash varchar(64)`
- `fetch_steps jsonb null`
- `fetch_tier varchar(16) = 'httpx'::character varying`
- `fetched_at timestamp with time zone = now()`
- `final_url text null`
- `html text null`
- `html_key text null`
- `id integer = nextval('documents_id_seq'::regclass)`
- `is_shell boolean = false`
- `kind varchar(32)`
- `robots_disallowed boolean = false`
- `status_code integer null`
- `tel_hrefs text[] null`
- `text text`
- `title text null`
- `url text`

References:

- public.companies (company_id → id)

Indexes:

- `CREATE INDEX ix_documents_company_fetched ON public.documents USING btree (company_id, fetched_at)`
- `CREATE UNIQUE INDEX pk_documents ON public.documents USING btree (id)`
- `CREATE UNIQUE INDEX uq_documents_url ON public.documents USING btree (url, content_hash)`

## public.done_records (view)

- `at timestamp with time zone null`
- `by varchar(200) null`
- `day text null`
- `event varchar(16) null`
- `id integer null`
- `item varchar(200) null`
- `kind varchar(16) null`
- `note text null`
- `open text null`
- `platform varchar(16) null`
- `url text null`
- `via varchar(8) null`
- `what text null`
- `words text null`

## public.draft_accounts (table)

- `account varchar(120)`
- `at timestamp with time zone = now()`
- `by varchar(255) null`
- `item varchar(120)`

Indexes:

- `CREATE UNIQUE INDEX pk_draft_accounts ON public.draft_accounts USING btree (item)`

## public.draft_activity (view)

- `at timestamp with time zone null`
- `comment text null`
- `contact text null`
- `draft text null`
- `item varchar null`
- `kind varchar null`
- `post text null`
- `seq integer null`
- `thread text null`
- `video text null`
- `what text null`

## public.draft_events (table)

- `ask text null`
- `at timestamp with time zone = now()`
- `by varchar(200) null`
- `event varchar(16)`
- `external_id varchar(255) null`
- `id integer = nextval('draft_events_id_seq'::regclass)`
- `item varchar(200)`
- `kind varchar(16)`
- `llm jsonb null`
- `meta jsonb = '{}'::jsonb`
- `note text null`
- `platform varchar(16) null`
- `reason varchar(16) null`
- `ref varchar(200) null`
- `round integer = 1`
- `run_id uuid null`
- `slot timestamp with time zone null`
- `text text null`
- `title text null`
- `url text null`
- `via varchar(8)`

References:

- public.platform_objects (platform → platform, external_id → ref)

Indexes:

- `CREATE INDEX ix_draft_events_item_id ON public.draft_events USING btree (item, id)`
- `CREATE INDEX ix_draft_events_kind_at ON public.draft_events USING btree (kind, at)`
- `CREATE INDEX ix_draft_events_platform_external_id ON public.draft_events USING btree (platform, external_id)`
- `CREATE UNIQUE INDEX pk_draft_events ON public.draft_events USING btree (id)`
- `CREATE UNIQUE INDEX uq_draft_events_ref ON public.draft_events USING btree (ref)`

## public.draft_outcomes (view)

- `comments integer null`
- `follows integer null`
- `item text null`
- `measured timestamp with time zone null`
- `reactions integer null`
- `replies jsonb null`
- `shares integer null`
- `snapshots integer null`
- `views integer null`

## public.draft_people (view)

- `item text null`
- `name varchar null`

## public.email_campaign_records (view)

- `bounces bigint null`
- `enrolled bigint null`
- `id text null`
- `interested bigint null`
- `last_sent timestamp with time zone null`
- `reached bigint null`
- `replies bigint null`
- `sent bigint null`

## public.email_clicks (table)

- `clicks integer = 1`
- `first_at timestamp with time zone`
- `id integer = nextval('email_clicks_id_seq'::regclass)`
- `last_at timestamp with time zone`
- `link_code varchar(40)`
- `message_id integer null`
- `url varchar(200)`

References:

- public.messages (message_id → id)

Indexes:

- `CREATE INDEX ix_email_clicks_message_id ON public.email_clicks USING btree (message_id)`
- `CREATE UNIQUE INDEX pk_email_clicks ON public.email_clicks USING btree (id)`
- `CREATE UNIQUE INDEX uq_email_clicks_link_code_url ON public.email_clicks USING btree (link_code, url)`

## public.email_firm_records (view)

- `added timestamp with time zone null`
- `crawled timestamp with time zone null`
- `declined text null`
- `domain text null`
- `id integer null`
- `lead timestamp with time zone null`
- `name text null`
- `named timestamp with time zone null`
- `niche text null`
- `stage text null`

## public.email_llm_calls (view)

- `applied_at timestamp with time zone null`
- `company_id integer null`
- `created_at timestamp with time zone null`
- `document_id integer null`
- `enrichment_id integer null`
- `finish_reason text null`
- `has_call_record boolean null`
- `input_tokens integer null`
- `kind text null`
- `latency_ms integer null`
- `model text null`
- `output_tokens integer null`
- `parse_failed boolean null`
- `prompt_version text null`
- `provider text null`
- `reasoning_tokens integer null`
- `rejected boolean null`
- `run_id uuid null`
- `thread_event_id integer null`
- `total_tokens integer null`

## public.email_model_records (view)

- `age text null`
- `calls bigint null`
- `currency text null`
- `id text null`
- `input_tokens bigint null`
- `kind text null`
- `model text null`
- `month date null`
- `output_tokens bigint null`
- `parse_failures bigint null`
- `provider text null`
- `rejected_calls bigint null`
- `usd double precision null`

## public.email_reply_records (view)

- `company text null`
- `detail text null`
- `domain text null`
- `draft text null`
- `email text null`
- `id integer null`
- `niche text null`
- `received timestamp with time zone null`
- `start timestamp with time zone null`
- `state text null`
- `subject text null`
- `time_zone text null`
- `who text null`
- `words text null`

## public.email_reply_thread (view)

- `at timestamp with time zone null`
- `kind text null`
- `reply_id integer null`
- `what text null`

## public.email_stage_costs (view)

- `avg_latency_ms integer null`
- `calls bigint null`
- `command varchar(64) null`
- `first_call_at timestamp with time zone null`
- `input_tokens bigint null`
- `kind text null`
- `last_call_at timestamp with time zone null`
- `max_latency_ms integer null`
- `model text null`
- `niche varchar(64) null`
- `output_tokens bigint null`
- `parse_failures bigint null`
- `provider text null`
- `reasoning_tokens bigint null`
- `rejected_calls bigint null`
- `run_id uuid null`
- `total_tokens bigint null`

## public.enrichments (table)

- `applied_at timestamp with time zone null`
- `company_id integer null`
- `created_at timestamp with time zone = now()`
- `document_id integer null`
- `id integer = nextval('enrichments_id_seq'::regclass)`
- `kind varchar(32)`
- `model varchar(64)`
- `output jsonb`
- `prompt_version varchar(16)`
- `run_id uuid null`

References:

- public.companies (company_id → id)
- public.documents (document_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_enrichments_run_id ON public.enrichments USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_enrichments ON public.enrichments USING btree (id)`
- `CREATE UNIQUE INDEX uq_enrichments_company_id ON public.enrichments USING btree (company_id, kind, model, prompt_version)`
- `CREATE UNIQUE INDEX uq_enrichments_document_id ON public.enrichments USING btree (document_id, kind, model, prompt_version)`

## public.enrollment_outcomes (view)

- `auto_replied boolean null`
- `candidate_id integer null`
- `company_id integer null`
- `complained boolean null`
- `contact_round integer null`
- `disposition varchar null`
- `enrolled_at timestamp with time zone null`
- `enrollment_id integer null`
- `enrollment_kind varchar(32) null`
- `evidence text null`
- `first_reply_at timestamp with time zone null`
- `first_sent_at timestamp with time zone null`
- `hard_bounced boolean null`
- `interested boolean null`
- `last_sent_at timestamp with time zone null`
- `last_touch_at timestamp with time zone null`
- `lead_id integer null`
- `niche varchar(32) null`
- `offer varchar(64) null`
- `opener_state varchar(32) null`
- `opener_template varchar(64) null`
- `opener_template_version varchar(12) null`
- `outcome text null`
- `person_id integer null`
- `pick_method text null`
- `replied boolean null`
- `replies bigint null`
- `sender varchar(320) null`
- `sequence_name varchar(64) null`
- `soft_bounced boolean null`
- `source_document_id integer null`
- `source_url text null`
- `state varchar(32) null`
- `steps_sent bigint null`
- `stop_reason varchar(32) null`
- `to_email varchar(320) null`
- `unsubscribed boolean null`
- `verification_result text null`

## public.enrollments (table)

- `away_until date null`
- `candidate_id integer null`
- `company_id integer`
- `contact_round integer = 1`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('enrollments_id_seq'::regclass)`
- `kind varchar(32)`
- `lead_id integer null`
- `niche varchar(32)`
- `offer varchar(64)`
- `person_id integer null`
- `run_id uuid null`
- `sender varchar(320)`
- `sequence_name varchar(64)`
- `sequence_snapshot jsonb`
- `state varchar(32)`
- `stop_reason varchar(32) null`
- `stopped_at timestamp with time zone null`
- `to_email varchar(320)`

References:

- public.companies (company_id → id)
- public.contact_candidates (candidate_id → id)
- public.leads (lead_id → id)
- public.people (person_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_enrollments_candidate_id ON public.enrollments USING btree (candidate_id)`
- `CREATE INDEX ix_enrollments_company_id ON public.enrollments USING btree (company_id)`
- `CREATE INDEX ix_enrollments_lead_id ON public.enrollments USING btree (lead_id)`
- `CREATE INDEX ix_enrollments_offer ON public.enrollments USING btree (offer)`
- `CREATE INDEX ix_enrollments_person_id ON public.enrollments USING btree (person_id)`
- `CREATE INDEX ix_enrollments_run_id ON public.enrollments USING btree (run_id)`
- `CREATE INDEX ix_enrollments_to_email ON public.enrollments USING btree (lower((to_email)::text))`
- `CREATE UNIQUE INDEX pk_enrollments ON public.enrollments USING btree (id)`
- `CREATE UNIQUE INDEX uq_enrollments_active_address ON public.enrollments USING btree (lower((to_email)::text)) WHERE ((state)::text = 'active'::text)`
- `CREATE UNIQUE INDEX uq_enrollments_active_company ON public.enrollments USING btree (company_id) WHERE ((state)::text = 'active'::text)`
- `CREATE UNIQUE INDEX uq_enrollments_active_person ON public.enrollments USING btree (person_id) WHERE ((state)::text = 'active'::text)`

## public.events (table)

- `about varchar(200) null`
- `at timestamp with time zone = now()`
- `by varchar(64)`
- `data jsonb`
- `due timestamp with time zone null`
- `error text null`
- `id uuid = gen_random_uuid()`
- `kind varchar(16)`
- `node varchar(200)`
- `port varchar(64)`
- `sent jsonb null`
- `sent_at timestamp with time zone null`
- `subject varchar(200)`
- `until varchar(16) null`
- `version integer null`
- `workflow varchar(64)`

Indexes:

- `CREATE INDEX ix_events_failed ON public.events USING btree (workflow) WHERE (error IS NOT NULL)`
- `CREATE INDEX ix_events_subject ON public.events USING btree (subject)`
- `CREATE INDEX ix_events_until ON public.events USING btree (until, about) WHERE ((due IS NOT NULL) AND (until IS NOT NULL))`
- `CREATE UNIQUE INDEX pk_events ON public.events USING btree (id)`
- `CREATE UNIQUE INDEX uq_events_entry ON public.events USING btree (workflow, node, port, subject)`

## public.executions (view)

- `due timestamp with time zone null`
- `entered timestamp with time zone null`
- `error text null`
- `firm varchar null`
- `id text null`
- `kind text null`
- `last_at timestamp with time zone null`
- `node varchar null`
- `person text null`
- `state text null`
- `steps integer null`
- `subject varchar(200) null`
- `title text null`
- `until varchar null`
- `workflow varchar(64) null`

## public.executor_events (view)

- `at timestamp with time zone null`
- `due timestamp with time zone null`
- `error text null`
- `id text null`
- `kind varchar(16) null`
- `node varchar(200) null`
- `port varchar(64) null`
- `state text null`
- `subject varchar(200) null`
- `until varchar null`
- `workflow varchar(64) null`

## public.fetch_tiers (table)

- `block text null`
- `domain text`
- `learned_at timestamp with time zone = now()`
- `tier text`

Indexes:

- `CREATE UNIQUE INDEX pk_fetch_tiers ON public.fetch_tiers USING btree (domain)`

## public.fills (table)

- `created_at timestamp with time zone = now()`
- `envelope jsonb`
- `id integer = nextval('fills_id_seq'::regclass)`
- `input text`
- `key varchar(64)`
- `kind varchar(16)`
- `model varchar(128)`
- `prompt_version varchar(12)`
- `refused text null`
- `value jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_fills ON public.fills USING btree (id)`
- `CREATE UNIQUE INDEX uq_fills_key ON public.fills USING btree (key)`

## public.findings (table)

- `by varchar(8) null`
- `company_id integer null`
- `confidence real`
- `created_at timestamp with time zone = now()`
- `document_id integer null`
- `fact_key varchar(400)`
- `id integer = nextval('findings_id_seq'::regclass)`
- `kind varchar(32)`
- `observed_at timestamp with time zone = now()`
- `person_id integer null`
- `proof jsonb null`
- `question varchar(80) null`
- `signal_at timestamp with time zone null`
- `signal_dated varchar(12) null`
- `source_url text null`
- `value jsonb`
- `via varchar(64)`

References:

- public.companies (company_id → id)
- public.documents (document_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_findings_company_id ON public.findings USING btree (company_id)`
- `CREATE INDEX ix_findings_document_id ON public.findings USING btree (document_id)`
- `CREATE INDEX ix_findings_person_id ON public.findings USING btree (person_id)`
- `CREATE INDEX ix_findings_signal_at ON public.findings USING btree (signal_at) WHERE (signal_at IS NOT NULL)`
- `CREATE UNIQUE INDEX pk_findings ON public.findings USING btree (id)`
- `CREATE UNIQUE INDEX uq_findings_fact_key ON public.findings USING btree (fact_key)`

## public.firm_facts (view)

- `aum_usd bigint null`
- `company_id integer null`
- `country varchar(2) null`
- `country_raw text null`
- `domain varchar(255) null`
- `employees integer null`
- `hnw_clients integer null`
- `ind_clients integer null`
- `last_seen_at timestamp with time zone null`
- `name varchar null`
- `pooled_clients integer null`
- `segment text null`
- `source_key varchar(64) null`

## public.flag_days (table)

- `calls integer = 0`
- `channel varchar(40)`
- `day date`
- `flag varchar(60)`
- `forms integer = 0`
- `paid integer = 0`
- `synced_at timestamp with time zone = now()`
- `variant varchar(40)`
- `visitors integer = 0`

Indexes:

- `CREATE UNIQUE INDEX pk_flag_days ON public.flag_days USING btree (flag, day, variant, channel)`

## public.flag_experiments (table)

- `best varchar(40) null`
- `created_at timestamp with time zone = now()`
- `created_by varchar(200)`
- `decided_at timestamp with time zone null`
- `ended_at timestamp with time zone null`
- `ended_by varchar(200) null`
- `flag varchar(60)`
- `goal varchar(8)`
- `p_best jsonb = '{}'::jsonb`
- `retired text[] = '{}'::text[]`
- `shares jsonb = '{}'::jsonb`
- `started_at timestamp with time zone null`
- `started_by varchar(200) null`
- `state varchar(10) = 'draft'::character varying`
- `updated_at timestamp with time zone = now()`
- `winner varchar(40) null`

References:

- public.flags (flag → key)

Indexes:

- `CREATE UNIQUE INDEX pk_flag_experiments ON public.flag_experiments USING btree (flag)`

## public.flags (table)

- `about text = ''::text`
- `created_at timestamp with time zone = now()`
- `created_by varchar(200)`
- `fallback varchar(40) = 'off'::character varying`
- `key varchar(60)`
- `killed boolean = false`
- `rules jsonb = '[]'::jsonb`
- `surface varchar(8) = 'portal'::character varying`
- `updated_at timestamp with time zone = now()`
- `variants text[] = '{off,on}'::text[]`

Indexes:

- `CREATE UNIQUE INDEX pk_flags ON public.flags USING btree (key)`

## public.funnel_latency (view)

- `company_id integer null`
- `days_enroll_to_send numeric null`
- `days_import_to_enroll numeric null`
- `days_import_to_fetch numeric null`
- `days_import_to_send numeric null`
- `days_send_to_reply numeric null`
- `domain varchar(255) null`
- `enrolled_at timestamp with time zone null`
- `first_fetch_at timestamp with time zone null`
- `first_reply_at timestamp with time zone null`
- `first_send_at timestamp with time zone null`
- `imported_at timestamp with time zone null`
- `niche varchar(32) null`

## public.grants (table)

- `apps text[] null`
- `at timestamp with time zone = now()`
- `by text`
- `channels text[] null`
- `client varchar(40)`
- `email text`
- `id integer = nextval('grants_id_seq'::regclass)`
- `reason text null`
- `record text null`
- `until timestamp with time zone null`
- `uses_left integer null`
- `verbs text[]`

Indexes:

- `CREATE INDEX ix_grants_email ON public.grants USING btree (email, client)`
- `CREATE UNIQUE INDEX pk_grants ON public.grants USING btree (id)`

## public.handoffs (table)

- `attempted_at timestamp with time zone null`
- `booked_by varchar(320) null`
- `created_at timestamp with time zone = now()`
- `enrollment_id integer`
- `forward_message_id varchar(255)`
- `forwarded_at timestamp with time zone null`
- `id integer = nextval('handoffs_id_seq'::regclass)`
- `meeting_booked_at timestamp with time zone null`
- `person_id integer null`
- `recruiter_email varchar(320)`
- `thread_event_id integer`

References:

- public.enrollments (enrollment_id → id)
- public.people (person_id → id)
- public.thread_events (thread_event_id → id)

Indexes:

- `CREATE INDEX ix_handoffs_enrollment_id ON public.handoffs USING btree (enrollment_id)`
- `CREATE INDEX ix_handoffs_person_id ON public.handoffs USING btree (person_id)`
- `CREATE UNIQUE INDEX pk_handoffs ON public.handoffs USING btree (id)`
- `CREATE UNIQUE INDEX uq_handoffs_thread_event_id ON public.handoffs USING btree (thread_event_id)`

## public.heat_days (table)

- `cell integer`
- `clicks integer`
- `day date`
- `page varchar(200)`
- `path varchar(300)`
- `rage integer`
- `synced_at timestamp with time zone = now()`
- `width varchar(8)`

Indexes:

- `CREATE UNIQUE INDEX pk_heat_days ON public.heat_days USING btree (day, page, width, path, cell)`

## public.hooks (table)

- `calls integer = 0`
- `client varchar(40) null`
- `created_at timestamp with time zone = now()`
- `fields jsonb = '{}'::jsonb`
- `id uuid = gen_random_uuid()`
- `input varchar(64)`
- `last_at timestamp with time zone null`
- `name text`
- `open boolean = true`
- `sealed text null`
- `subject varchar(200)`
- `token_hash varchar(64)`
- `workflow varchar(64)`

References:

- public.clients (client → id)

Indexes:

- `CREATE INDEX ix_hooks_client ON public.hooks USING btree (client)`
- `CREATE UNIQUE INDEX pk_hooks ON public.hooks USING btree (id)`
- `CREATE UNIQUE INDEX uq_hooks_token_hash ON public.hooks USING btree (token_hash)`

## public.import_errors (table)

- `claimant_company_id integer null`
- `company_id integer null`
- `id integer = nextval('import_errors_id_seq'::regclass)`
- `import_id integer`
- `kind varchar(32)`
- `raw jsonb null`
- `reason text`
- `row_number integer`

References:

- public.companies (claimant_company_id → id; company_id → id)
- public.imports (import_id → id)

Indexes:

- `CREATE INDEX ix_import_errors_claimant_company_id ON public.import_errors USING btree (claimant_company_id)`
- `CREATE INDEX ix_import_errors_company_id ON public.import_errors USING btree (company_id)`
- `CREATE INDEX ix_import_errors_import_id ON public.import_errors USING btree (import_id)`
- `CREATE UNIQUE INDEX pk_import_errors ON public.import_errors USING btree (id)`

## public.imports (table)

- `as_of date null`
- `content_hash varchar(64) null`
- `defaults jsonb null`
- `id integer = nextval('imports_id_seq'::regclass)`
- `imported_at timestamp with time zone = now()`
- `source_ref text`
- `source_type varchar(32)`
- `stats jsonb`
- `superseded_by integer null`

References:

- public.imports (superseded_by → id)

Indexes:

- `CREATE INDEX ix_imports_superseded_by ON public.imports USING btree (superseded_by)`
- `CREATE UNIQUE INDEX pk_imports ON public.imports USING btree (id)`

## public.inbox_notes (table)

- `at timestamp with time zone = now()`
- `body text`
- `by varchar(200)`
- `id uuid = gen_random_uuid()`
- `person_id integer null`
- `thread varchar(80)`

Indexes:

- `CREATE INDEX ix_inbox_notes_person ON public.inbox_notes USING btree (person_id)`
- `CREATE INDEX ix_inbox_notes_thread ON public.inbox_notes USING btree (thread, at)`
- `CREATE UNIQUE INDEX pk_inbox_notes ON public.inbox_notes USING btree (id)`

## public.inbox_replies (table)

- `asked_at timestamp with time zone = now()`
- `asked_by varchar(200)`
- `body text`
- `channel varchar(8)`
- `decided_at timestamp with time zone null`
- `decided_by varchar(200) null`
- `detail text null`
- `id integer = nextval('inbox_replies_id_seq'::regclass)`
- `send_at timestamp with time zone null`
- `state varchar(8) = 'waiting'::character varying`
- `target varchar(80)`
- `thread varchar(80)`
- `who text null`
- `why text null`

Indexes:

- `CREATE INDEX ix_inbox_replies_state ON public.inbox_replies USING btree (state, asked_at)`
- `CREATE INDEX ix_inbox_replies_thread ON public.inbox_replies USING btree (thread)`
- `CREATE UNIQUE INDEX pk_inbox_replies ON public.inbox_replies USING btree (id)`

## public.inbox_syncs (table)

- `cursor_ms bigint = 0`
- `sender varchar(320)`
- `stats jsonb null`
- `synced_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_inbox_syncs ON public.inbox_syncs USING btree (sender)`

## public.inbox_threads (table)

- `assignee varchar(200) null`
- `snooze_until timestamp with time zone null`
- `status varchar(8) null`
- `status_at timestamp with time zone null`
- `thread varchar(80)`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(200)`

Indexes:

- `CREATE INDEX ix_inbox_threads_assignee ON public.inbox_threads USING btree (assignee)`
- `CREATE UNIQUE INDEX pk_inbox_threads ON public.inbox_threads USING btree (thread)`

## public.issues (table)

- `app varchar(40)`
- `at timestamp with time zone = now()`
- `body text`
- `by text`
- `channel varchar(40) null`
- `client varchar(40)`
- `id integer = nextval('issues_id_seq'::regclass)`
- `record text`
- `resolved_at timestamp with time zone null`
- `resolved_by text null`
- `title text null`

Indexes:

- `CREATE INDEX ix_issues_open ON public.issues USING btree (client, resolved_at)`
- `CREATE INDEX ix_issues_record ON public.issues USING btree (client, record)`
- `CREATE UNIQUE INDEX pk_issues ON public.issues USING btree (id)`

## public.job_orders (table)

- `closed_on date null`
- `company_id integer null`
- `company_name text null`
- `created_at timestamp with time zone = now()`
- `format varchar(32)`
- `id integer = nextval('job_orders_id_seq'::regclass)`
- `open boolean`
- `opened_on date null`
- `openings integer null`
- `order_key varchar(128)`
- `owner text null`
- `raw jsonb`
- `status text null`
- `title text null`
- `updated_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)

Indexes:

- `CREATE INDEX ix_job_orders_company_id ON public.job_orders USING btree (company_id) WHERE open`
- `CREATE UNIQUE INDEX pk_job_orders ON public.job_orders USING btree (id)`
- `CREATE UNIQUE INDEX uq_job_orders_key ON public.job_orders USING btree (format, order_key)`

## public.keyword_hit_records (view)

- `at timestamp with time zone null`
- `author varchar(120) null`
- `comment text null`
- `id text null`
- `keyword varchar(40) null`
- `platform varchar(16) null`
- `post text null`
- `sent_at timestamp with time zone null`
- `state varchar(16) null`
- `url text null`
- `why text null`

## public.keyword_hits (table)

- `at timestamp with time zone = now()`
- `author varchar(120)`
- `comment_id integer`
- `id integer = nextval('keyword_hits_id_seq'::regclass)`
- `keyword_id integer`
- `platform varchar(16)`
- `ref varchar(200) null`
- `sent_at timestamp with time zone null`
- `state varchar(16) = 'queued'::character varying`
- `why text null`

References:

- public.comment_keywords (keyword_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_keyword_hits ON public.keyword_hits USING btree (id)`
- `CREATE UNIQUE INDEX uq_keyword_hits_comment_id ON public.keyword_hits USING btree (comment_id)`
- `CREATE UNIQUE INDEX uq_keyword_hits_person ON public.keyword_hits USING btree (keyword_id, platform, author)`

## public.latest_verifications (view)

- `checked_at timestamp with time zone null`
- `contact_candidate_id integer null`
- `email varchar(320) null`
- `id integer null`
- `lead_id integer null`
- `raw jsonb null`
- `result varchar(32) null`
- `verifier varchar(64) null`

## public.lead_channels (view)

- `active boolean null`
- `channel text null`
- `company_id integer null`
- `created_at timestamp with time zone null`
- `first_touch_at timestamp with time zone null`
- `id integer null`
- `person_id integer null`
- `state text null`

## public.lead_checks (table)

- `checked_at timestamp with time zone = now()`
- `evidence jsonb`
- `kind varchar(32)`
- `lead_id integer`
- `result varchar(16)`

References:

- public.leads (lead_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_lead_checks ON public.lead_checks USING btree (lead_id, kind)`

## public.lead_sheet (view)

- `checks text null`
- `company_domain varchar(255) null`
- `company_id integer null`
- `company_linkedin varchar(512) null`
- `company_location text null`
- `company_name varchar null`
- `description text null`
- `email varchar(320) null`
- `email_type text null`
- `industry text null`
- `lead_id integer null`
- `linkedin_url varchar(512) null`
- `mail_status text null`
- `niche varchar(32) null`
- `person_id integer null`
- `person_name text null`
- `phone varchar(512) null`
- `result_title text null`
- `socials text null`
- `valid_email_on date null`
- `verified text null`

## public.leads (table)

- `company_id integer null`
- `country varchar(2) null`
- `created_at timestamp with time zone = now()`
- `email varchar(320)`
- `first_name varchar null`
- `geo varchar(64) null`
- `id integer = nextval('leads_id_seq'::regclass)`
- `import_id integer`
- `last_name varchar null`
- `person_id integer null`
- `persona varchar(64) null`
- `raw jsonb`
- `social_url varchar(512) null`
- `source varchar(64) null`
- `status varchar(32)`
- `suppression_id integer null`
- `title varchar null`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)
- public.people (person_id → id)
- public.suppressions (suppression_id → id)

Indexes:

- `CREATE INDEX ix_leads_company_id ON public.leads USING btree (company_id)`
- `CREATE INDEX ix_leads_company_verified ON public.leads USING btree (company_id, created_at) WHERE (((status)::text = 'verified'::text) AND (first_name IS NOT NULL))`
- `CREATE INDEX ix_leads_import_id ON public.leads USING btree (import_id)`
- `CREATE INDEX ix_leads_person_id ON public.leads USING btree (person_id)`
- `CREATE INDEX ix_leads_suppression_id ON public.leads USING btree (suppression_id)`
- `CREATE UNIQUE INDEX pk_leads ON public.leads USING btree (id)`
- `CREATE UNIQUE INDEX uq_leads_email ON public.leads USING btree (email)`

## public.limits (table)

- `burst integer null`
- `client varchar(40) null`
- `id integer = nextval('limits_id_seq'::regclass)`
- `name varchar(64)`
- `per_day integer`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(320)`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_limits ON public.limits USING btree (id)`
- `CREATE UNIQUE INDEX uq_limits_owner ON public.limits USING btree (client, name) NULLS NOT DISTINCT`

## public.link_days (table)

- `calls_first integer`
- `calls_last integer`
- `campaign varchar(100)`
- `clicks integer`
- `content varchar(100)`
- `day date`
- `forms_first integer`
- `forms_last integer`
- `hops integer`
- `revenue_first integer`
- `revenue_last integer`
- `source varchar(40)`
- `synced_at timestamp with time zone = now()`
- `won_first integer`
- `won_last integer`

Indexes:

- `CREATE INDEX ix_link_days_content ON public.link_days USING btree (content)`
- `CREATE UNIQUE INDEX pk_link_days ON public.link_days USING btree (day, source, campaign, content)`

## public.llm_usage_by_month (view)

- `calls bigint null`
- `input_tokens bigint null`
- `kind text null`
- `model text null`
- `month date null`
- `output_tokens bigint null`
- `parse_failures bigint null`
- `provider text null`
- `rejected_calls bigint null`
- `usd double precision null`

## public.mail_bounce_reads (table)

- `last_sender_at timestamp with time zone = now()`
- `mailbox varchar(320)`
- `read_at timestamp with time zone null`
- `stats jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_mail_bounce_reads ON public.mail_bounce_reads USING btree (mailbox)`

## public.mail_bounces (table)

- `address varchar(320) null`
- `class varchar(8)`
- `consent_event_id integer null`
- `created_at timestamp with time zone = now()`
- `diagnostic text null`
- `id integer = nextval('mail_bounces_id_seq'::regclass)`
- `mailbox varchar(320)`
- `matched_by varchar(16)`
- `message_id varchar(998) null`
- `provider_id varchar(255)`
- `received_at timestamp with time zone`
- `recipient_id integer null`
- `status varchar(16) null`
- `suppression_id integer null`

References:

- public.broadcast_recipients (recipient_id → id)
- public.consent_events (consent_event_id → id)
- public.suppressions (suppression_id → id)

Indexes:

- `CREATE INDEX ix_mail_bounces_consent_event_id ON public.mail_bounces USING btree (consent_event_id)`
- `CREATE INDEX ix_mail_bounces_recipient_id ON public.mail_bounces USING btree (recipient_id)`
- `CREATE INDEX ix_mail_bounces_suppression_id ON public.mail_bounces USING btree (suppression_id)`
- `CREATE UNIQUE INDEX pk_mail_bounces ON public.mail_bounces USING btree (id)`
- `CREATE UNIQUE INDEX uq_mail_bounces_mailbox_provider ON public.mail_bounces USING btree (mailbox, provider_id)`

## public.mail_connections (table)

- `access varchar(8)`
- `account_id integer`
- `address varchar(320)`
- `by varchar(320)`
- `checked_at timestamp with time zone null`
- `connected_at timestamp with time zone = now()`
- `org varchar(255) null`
- `provider varchar(12)`
- `scopes text`
- `state varchar(12) = 'connected'::character varying`
- `token_name varchar(255)`
- `why text null`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_mail_connections ON public.mail_connections USING btree (account_id)`

## public.mail_consents (table)

- `account_id integer`
- `by varchar(320)`
- `consented_at timestamp with time zone = now()`
- `scopes text`
- `tenant varchar(64)`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_mail_consents ON public.mail_consents USING btree (account_id)`

## public.mail_grants (table)

- `account_id integer`
- `by varchar(320)`
- `created_at timestamp with time zone = now()`
- `expires_at timestamp with time zone`
- `kind varchar(8)`
- `provider varchar(12)`
- `state varchar(64)`
- `used_at timestamp with time zone null`
- `verifier varchar(128) null`
- `want varchar(8)`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE INDEX ix_mail_grants_account ON public.mail_grants USING btree (account_id)`
- `CREATE UNIQUE INDEX pk_mail_grants ON public.mail_grants USING btree (state)`

## public.marketing_ad_day_records (view)

- `adset text null`
- `age text null`
- `campaign text null`
- `clicks integer null`
- `cost_per_lead double precision null`
- `currency text null`
- `day date null`
- `id text null`
- `impressions integer null`
- `leads integer null`
- `reach integer null`
- `spend double precision null`
- `state text null`

## public.marketing_answer_records (view)

- `asked date null`
- `cited text null`
- `engine text null`
- `id text null`
- `latest text null`
- `overview text null`
- `phrase text null`
- `rank integer null`

## public.marketing_conversation (view)

- `answered integer null`
- `booked integer null`
- `comments integer null`
- `dmed integer null`
- `dms integer null`
- `dms_answered integer null`
- `id text null`
- `platform text null`
- `reply_secs double precision null`
- `since timestamp with time zone null`
- `span text null`

## public.marketing_draft_records (view)

- `account text null`
- `chars integer null`
- `created timestamp with time zone null`
- `due timestamp with time zone null`
- `error text null`
- `format text null`
- `id text null`
- `missing text null`
- `note text null`
- `platform text null`
- `scheduled timestamp with time zone null`
- `stage text null`
- `state text null`
- `text text null`
- `title text null`
- `to text null`
- `version text null`
- `written text null`

## public.marketing_funnel_records (view)

- `calls integer null`
- `channel text null`
- `forms integer null`
- `id text null`
- `paid integer null`
- `visitors integer null`
- `window text null`

## public.marketing_heat_records (view)

- `clicks integer null`
- `day date null`
- `id text null`
- `page text null`
- `rage integer null`
- `views integer null`
- `width text null`
- `window text null`

## public.marketing_keyword_records (view)

- `added timestamp with time zone null`
- `clicks integer null`
- `clicks_change integer null`
- `id integer null`
- `impressions integer null`
- `impressions_change integer null`
- `page text null`
- `phrase text null`
- `position double precision null`
- `source text null`
- `state text null`

## public.marketing_link_day_records (view)

- `age text null`
- `calls_first integer null`
- `calls_last integer null`
- `campaign text null`
- `clicks integer null`
- `content text null`
- `currency text null`
- `day date null`
- `forms_first integer null`
- `forms_last integer null`
- `hops integer null`
- `id text null`
- `post text null`
- `post_title text null`
- `revenue_first numeric null`
- `revenue_last numeric null`
- `source text null`
- `won_first integer null`
- `won_last integer null`

## public.marketing_post_records (view)

- `account text null`
- `answered integer null`
- `avg_view_pct double precision null`
- `avg_view_secs double precision null`
- `calls integer null`
- `clicks integer null`
- `comments integer null`
- `ctr double precision null`
- `currency text null`
- `engaged integer null`
- `follows double precision null`
- `format text null`
- `forms integer null`
- `hold double precision null`
- `hook double precision null`
- `id text null`
- `impressions double precision null`
- `link_clicks double precision null`
- `measured timestamp with time zone null`
- `platform text null`
- `published timestamp with time zone null`
- `reach double precision null`
- `reactions integer null`
- `recent text null`
- `revenue_first numeric null`
- `revenue_last numeric null`
- `saves double precision null`
- `score double precision null`
- `shares integer null`
- `stage text null`
- `theirs integer null`
- `title text null`
- `url text null`
- `views integer null`
- `watch_minutes double precision null`
- `won integer null`

## public.marketing_search_day_records (view)

- `clicks integer null`
- `day date null`
- `id text null`
- `impressions integer null`
- `position double precision null`

## public.marketing_search_page_records (view)

- `checked date null`
- `clicks integer null`
- `clicks_change integer null`
- `coverage text null`
- `id text null`
- `impressions integer null`
- `impressions_change integer null`
- `indexed text null`
- `position double precision null`
- `url text null`

## public.marketing_sends (table)

- `campaign varchar(120) null`
- `channel varchar(16)`
- `id integer = nextval('marketing_sends_id_seq'::regclass)`
- `person_key varchar(340)`
- `sent_at timestamp with time zone = now()`

Indexes:

- `CREATE INDEX ix_marketing_sends_person_key ON public.marketing_sends USING btree (person_key, sent_at)`
- `CREATE UNIQUE INDEX pk_marketing_sends ON public.marketing_sends USING btree (id)`

## public.marketing_site_day_records (view)

- `age text null`
- `bookings integer null`
- `calls integer null`
- `campaign text null`
- `channel text null`
- `day date null`
- `first_touches integer null`
- `forms integer null`
- `id text null`
- `paid integer null`
- `visits integer null`
- `watch_plays integer null`

## public.marketing_subscriber_activity (view)

- `at timestamp with time zone null`
- `kind varchar null`
- `subscriber text null`
- `what text null`

## public.marketing_subscriber_records (view)

- `actor varchar(320) null`
- `address varchar(320) null`
- `can_send text null`
- `channel varchar(16) null`
- `frequency text null`
- `id text null`
- `last_sent timestamp with time zone null`
- `since timestamp with time zone null`
- `source varchar null`
- `state text null`
- `topics text null`

## public.marketing_text_contact_records (view)

- `basis text null`
- `disposition text null`
- `enrolled timestamp with time zone null`
- `id integer null`
- `last_at timestamp with time zone null`
- `last_text text null`
- `name text null`
- `niche text null`
- `replied integer null`
- `replies integer null`
- `sent integer null`
- `state text null`
- `texted integer null`
- `waiting text null`

## public.marketing_topic_records (view)

- `cadence varchar(64) null`
- `channel varchar(16) null`
- `confirmed bigint null`
- `confirms bigint null`
- `id varchar(64) null`
- `last_sent timestamp with time zone null`
- `leaves bigint null`
- `net_week bigint null`
- `public_name varchar(120) null`
- `sends bigint null`
- `shown text null`
- `signups bigint null`

## public.message_settings (table)

- `cap_per_day integer null`
- `cap_per_week integer null`
- `id integer = 1`
- `postal varchar(1000) null`
- `sender varchar(320) null`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(200) null`
- `utm_links boolean = true`

Indexes:

- `CREATE UNIQUE INDEX pk_message_settings ON public.message_settings USING btree (id)`

## public.messages (table)

- `approved_at timestamp with time zone null`
- `approved_by varchar(32) null`
- `attempted_at timestamp with time zone null`
- `body text`
- `created_at timestamp with time zone = now()`
- `detail text null`
- `edited_at timestamp with time zone null`
- `enrollment_id integer`
- `gmail_id varchar(64) null`
- `held boolean = false`
- `id integer = nextval('messages_id_seq'::regclass)`
- `link_code varchar(40) null`
- `message_id varchar(255) null`
- `offered_times jsonb null`
- `open_token varchar(64) null`
- `provenance jsonb`
- `released_at timestamp with time zone null`
- `review_reason varchar(32) null`
- `run_id uuid null`
- `sent_at timestamp with time zone null`
- `sent_run_id uuid null`
- `state varchar(32)`
- `step integer`
- `subject text null`
- `template varchar(64)`
- `template_version varchar(12)`
- `thread_id varchar(64) null`
- `to_email varchar(320)`
- `transport varchar(32) null`

References:

- public.enrollments (enrollment_id → id)
- public.runs (run_id → id; sent_run_id → id)

Indexes:

- `CREATE INDEX ix_messages_run_id ON public.messages USING btree (run_id)`
- `CREATE INDEX ix_messages_sent_run_id ON public.messages USING btree (sent_run_id)`
- `CREATE UNIQUE INDEX pk_messages ON public.messages USING btree (id)`
- `CREATE UNIQUE INDEX uq_messages_enrollment_id ON public.messages USING btree (enrollment_id, step)`
- `CREATE UNIQUE INDEX uq_messages_link_code ON public.messages USING btree (link_code)`
- `CREATE UNIQUE INDEX uq_messages_open_token ON public.messages USING btree (open_token)`

## public.metric_sources (table)

- `checked_at timestamp with time zone = now()`
- `live_at timestamp with time zone null`
- `metric varchar(32)`
- `platform varchar(16)`
- `state varchar(16)`
- `why text null`

Indexes:

- `CREATE UNIQUE INDEX pk_metric_sources ON public.metric_sources USING btree (platform, metric)`

## public.mover_addresses (table)

- `candidate_id integer null`
- `domain varchar(255) null`
- `finding_id integer`
- `outcome varchar(16)`
- `person_id integer`
- `tried_at timestamp with time zone = now()`

References:

- public.contact_candidates (candidate_id → id)
- public.findings (finding_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_mover_addresses_candidate_id ON public.mover_addresses USING btree (candidate_id)`
- `CREATE INDEX ix_mover_addresses_person_id ON public.mover_addresses USING btree (person_id)`
- `CREATE UNIQUE INDEX pk_mover_addresses ON public.mover_addresses USING btree (finding_id)`

## public.note_comments (table)

- `anchor jsonb null`
- `at timestamp with time zone = now()`
- `body text`
- `by varchar(200)`
- `edited_at timestamp with time zone null`
- `id uuid = gen_random_uuid()`
- `mentions text[] = '{}'::text[]`
- `note_id uuid`
- `parent_id uuid null`
- `quote varchar(5000) = ''::character varying`
- `resolved_at timestamp with time zone null`
- `resolved_by varchar(200) null`

References:

- public.note_comments (parent_id → id)
- public.notes (note_id → id)

Indexes:

- `CREATE INDEX ix_note_comments_note ON public.note_comments USING btree (note_id, at)`
- `CREATE INDEX ix_note_comments_parent ON public.note_comments USING btree (parent_id)`
- `CREATE UNIQUE INDEX pk_note_comments ON public.note_comments USING btree (id)`

## public.note_links (table)

- `label varchar(3000) = ''::character varying`
- `note_id uuid`
- `target varchar(300)`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE INDEX ix_note_links_target ON public.note_links USING btree (target)`
- `CREATE UNIQUE INDEX pk_note_links ON public.note_links USING btree (note_id, target)`

## public.note_mentions (table)

- `at timestamp with time zone = now()`
- `by varchar(200)`
- `comment_id uuid null`
- `id uuid = gen_random_uuid()`
- `inbox_note_id uuid null`
- `mailed_at timestamp with time zone null`
- `note_id uuid null`
- `seen_at timestamp with time zone null`
- `who varchar(200)`

References:

- public.inbox_notes (inbox_note_id → id)
- public.note_comments (comment_id → id)
- public.notes (note_id → id)

Indexes:

- `CREATE INDEX ix_note_mentions_comment ON public.note_mentions USING btree (comment_id)`
- `CREATE INDEX ix_note_mentions_inbox_note ON public.note_mentions USING btree (inbox_note_id)`
- `CREATE INDEX ix_note_mentions_note ON public.note_mentions USING btree (note_id)`
- `CREATE INDEX ix_note_mentions_unmailed ON public.note_mentions USING btree (at) WHERE ((mailed_at IS NULL) AND (seen_at IS NULL))`
- `CREATE INDEX ix_note_mentions_who ON public.note_mentions USING btree (who, at)`
- `CREATE UNIQUE INDEX pk_note_mentions ON public.note_mentions USING btree (id)`

## public.note_seen (table)

- `at timestamp with time zone = now()`
- `email varchar(200)`
- `note_id uuid`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE INDEX ix_note_seen_email ON public.note_seen USING btree (email, at)`
- `CREATE UNIQUE INDEX pk_note_seen ON public.note_seen USING btree (note_id, email)`

## public.note_shares (table)

- `at timestamp with time zone = now()`
- `by varchar(200)`
- `note_id uuid`
- `role varchar(8)`
- `who varchar(200)`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE INDEX ix_note_shares_who ON public.note_shares USING btree (who)`
- `CREATE UNIQUE INDEX pk_note_shares ON public.note_shares USING btree (note_id, who)`

## public.note_stars (table)

- `at timestamp with time zone = now()`
- `email varchar(200)`
- `note_id uuid`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_stars ON public.note_stars USING btree (note_id, email)`

## public.note_updates (table)

- `at timestamp with time zone = now()`
- `by varchar(200)`
- `id integer = nextval('note_updates_id_seq'::regclass)`
- `note_id uuid`
- `update bytea`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE INDEX ix_note_updates_note ON public.note_updates USING btree (note_id, id)`
- `CREATE UNIQUE INDEX pk_note_updates ON public.note_updates USING btree (id)`

## public.note_versions (table)

- `at timestamp with time zone = now()`
- `authors text[] = '{}'::text[]`
- `body jsonb`
- `id integer = nextval('note_versions_id_seq'::regclass)`
- `kind varchar(8)`
- `name varchar(2000) null`
- `note_id uuid`
- `number integer`
- `restored_from integer null`
- `started_at timestamp with time zone = now()`
- `text text`
- `title varchar(3000) = ''::character varying`

References:

- public.notes (note_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_note_versions ON public.note_versions USING btree (id)`
- `CREATE UNIQUE INDEX uq_note_versions_number ON public.note_versions USING btree (note_id, number)`

## public.notes (table)

- `archived_at timestamp with time zone null`
- `assignee varchar(200) null`
- `board_id uuid null`
- `body jsonb = '{"type": "doc", "content": []}'::jsonb`
- `closed_at timestamp with time zone null`
- `column_id varchar(40) null`
- `created_at timestamp with time zone = now()`
- `created_by varchar(200)`
- `due date null`
- `edited_by varchar(200) null`
- `general varchar(12) = 'private'::character varying`
- `general_role varchar(8) = 'view'::character varying`
- `id uuid = gen_random_uuid()`
- `kind varchar(8) = 'note'::character varying`
- `labels text[] = '{}'::text[]`
- `owner varchar(200)`
- `parent_id uuid null`
- `position varchar(64) null`
- `search tsvector null`
- `text text = ''::text`
- `title varchar(3000) = ''::character varying`
- `train boolean = false`
- `updated_at timestamp with time zone = now()`
- `version integer = 1`
- `via varchar(8) = 'person'::character varying`
- `y_state bytea null`

References:

- public.boards (board_id → id)
- public.notes (parent_id → id)

Indexes:

- `CREATE INDEX ix_notes_assignee ON public.notes USING btree (assignee) WHERE (assignee IS NOT NULL)`
- `CREATE INDEX ix_notes_board ON public.notes USING btree (board_id, column_id)`
- `CREATE INDEX ix_notes_owner ON public.notes USING btree (owner, updated_at)`
- `CREATE INDEX ix_notes_parent ON public.notes USING btree (parent_id)`
- `CREATE INDEX ix_notes_search ON public.notes USING gin (search)`
- `CREATE INDEX ix_notes_updated ON public.notes USING btree (updated_at)`
- `CREATE UNIQUE INDEX pk_notes ON public.notes USING btree (id)`
- `CREATE UNIQUE INDEX uq_notes_dump ON public.notes USING btree (owner) WHERE ((kind)::text = 'dump'::text)`

## public.notes_settings (table)

- `id integer = 1`
- `train boolean = false`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(200) null`

Indexes:

- `CREATE UNIQUE INDEX pk_notes_settings ON public.notes_settings USING btree (id)`

## public.open_events (table)

- `id integer = nextval('open_events_id_seq'::regclass)`
- `message_id integer`
- `remote_id bigint`
- `run_id uuid null`
- `seen_at timestamp with time zone`
- `synced_at timestamp with time zone = now()`
- `user_agent text null`

References:

- public.messages (message_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_open_events_message_id ON public.open_events USING btree (message_id)`
- `CREATE INDEX ix_open_events_run_id ON public.open_events USING btree (run_id)`
- `CREATE INDEX ix_open_events_seen_at ON public.open_events USING btree (seen_at)`
- `CREATE UNIQUE INDEX pk_open_events ON public.open_events USING btree (id)`
- `CREATE UNIQUE INDEX uq_open_events_remote_id ON public.open_events USING btree (remote_id)`

## public.open_outcomes (view)

- `fetches numeric null`
- `niche varchar(32) null`
- `open_rate_human_plausible numeric null`
- `open_rate_raw numeric null`
- `opened_human_plausible bigint null`
- `opened_raw bigint null`
- `sequence_name varchar(64) null`
- `step integer null`
- `template varchar(64) null`
- `tracked_sent bigint null`

## public.open_syncs (table)

- `base_url varchar(255)`
- `cursor_id bigint = 0`
- `stats jsonb null`
- `synced_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_open_syncs ON public.open_syncs USING btree (base_url)`

## public.operators (table)

- `added_at timestamp with time zone = now()`
- `clients text[] null`
- `email text`
- `role varchar(64) = 'admin'::character varying`

References:

- public.roles (role → id)

Indexes:

- `CREATE INDEX ix_operators_role ON public.operators USING btree (role)`
- `CREATE UNIQUE INDEX pk_operators ON public.operators USING btree (email)`

## public.own_contact_points (view)

- `company_id integer null`
- `created_at timestamp with time zone null`
- `document_id integer null`
- `id integer null`
- `kind varchar(32) null`
- `pages integer null`
- `person_id integer null`
- `seen_at timestamp with time zone null`
- `source varchar(16) null`
- `source_url text null`
- `value varchar(512) null`

## public.pay_accounts (table)

- `client varchar(40)`
- `endpoint varchar(80) null`
- `how varchar(8) null`
- `live boolean null`
- `note text null`
- `secret_name text null`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_pay_accounts ON public.pay_accounts USING btree (client)`

## public.pay_events (table)

- `at timestamp with time zone = now()`
- `client varchar(40)`
- `id varchar(80)`
- `link uuid null`
- `result varchar(16)`
- `seen jsonb`
- `type varchar(80)`

References:

- public.clients (client → id)
- public.pay_links (link → id)

Indexes:

- `CREATE INDEX ix_pay_events_client_at ON public.pay_events USING btree (client, at)`
- `CREATE INDEX ix_pay_events_link ON public.pay_events USING btree (link)`
- `CREATE UNIQUE INDEX pk_pay_events ON public.pay_events USING btree (id)`

## public.pay_links (table)

- `amount_cents integer`
- `approved_at timestamp with time zone null`
- `approved_by text null`
- `channel varchar(8)`
- `checked_at timestamp with time zone null`
- `client varchar(40)`
- `contact integer null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `currency varchar(3) = 'usd'::character varying`
- `description varchar(200)`
- `dispute varchar(8) null`
- `dispute_at bigint null`
- `document uuid null`
- `email text null`
- `id uuid = gen_random_uuid()`
- `intent varchar(80) null`
- `live boolean null`
- `message bigint null`
- `name text null`
- `paid_at timestamp with time zone null`
- `paid_cents integer null`
- `quantity integer = 1`
- `refunded_at timestamp with time zone null`
- `refunded_cents integer = 0`
- `sent_at timestamp with time zone null`
- `session varchar(80) null`
- `status varchar(16) = 'waiting'::character varying`
- `stripe_link varchar(80) null`
- `told jsonb = '{}'::jsonb`
- `url text null`
- `why text null`

References:

- public.clients (client → id)

Indexes:

- `CREATE INDEX ix_pay_links_client_created ON public.pay_links USING btree (client, created_at)`
- `CREATE INDEX ix_pay_links_document ON public.pay_links USING btree (document)`
- `CREATE INDEX ix_pay_links_intent ON public.pay_links USING btree (intent)`
- `CREATE INDEX ix_pay_links_status ON public.pay_links USING btree (status)`
- `CREATE UNIQUE INDEX pk_pay_links ON public.pay_links USING btree (id)`
- `CREATE UNIQUE INDEX uq_pay_links_stripe_link ON public.pay_links USING btree (stripe_link)`

## public.people (table)

- `as_of date null`
- `company_id integer`
- `created_at timestamp with time zone = now()`
- `first_name varchar null`
- `full_name text`
- `id integer = nextval('people_id_seq'::regclass)`
- `import_id integer null`
- `is_compliance boolean`
- `is_testimonial boolean = false`
- `last_name varchar null`
- `linkedin_url varchar(512) null`
- `notes text null`
- `origin varchar(32)`
- `origin_ref text`
- `raw jsonb`
- `source_key varchar(64) null`
- `testimonial_org text null`
- `title text null`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)

Indexes:

- `CREATE INDEX ix_people_company_created ON public.people USING btree (company_id, created_at)`
- `CREATE INDEX ix_people_import_id ON public.people USING btree (import_id)`
- `CREATE UNIQUE INDEX pk_people ON public.people USING btree (id)`
- `CREATE UNIQUE INDEX uq_people_source_key ON public.people USING btree (source_key)`

## public.person_facts (view)

- `as_of date null`
- `avoid_emailing_first boolean null`
- `company_domain varchar(255) null`
- `company_id integer null`
- `company_name varchar null`
- `company_niche varchar(32) null`
- `company_source_key varchar(64) null`
- `first_name varchar null`
- `full_name text null`
- `is_compliance boolean null`
- `is_testimonial boolean null`
- `last_name varchar null`
- `linkedin_url varchar(512) null`
- `origin varchar(32) null`
- `person_id integer null`
- `role_rank integer null`
- `source_key varchar(64) null`
- `testimonial_org text null`
- `title text null`

## public.person_lookups (table)

- `looked_up_at timestamp with time zone = now()`
- `person_id integer`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `state varchar(16)`
- `tried jsonb`

References:

- public.people (person_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_person_lookups_run_id ON public.person_lookups USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_person_lookups ON public.person_lookups USING btree (person_id)`

## public.person_touch_lines (view)

- `at timestamp with time zone null`
- `context text null`
- `kind text null`
- `link text null`
- `person text null`
- `seq integer null`
- `what text null`

## public.pg_stat_statements (view)

- `calls bigint null`
- `dbid oid null`
- `jit_deform_count bigint null`
- `jit_deform_time double precision null`
- `jit_emission_count bigint null`
- `jit_emission_time double precision null`
- `jit_functions bigint null`
- `jit_generation_time double precision null`
- `jit_inlining_count bigint null`
- `jit_inlining_time double precision null`
- `jit_optimization_count bigint null`
- `jit_optimization_time double precision null`
- `local_blk_read_time double precision null`
- `local_blk_write_time double precision null`
- `local_blks_dirtied bigint null`
- `local_blks_hit bigint null`
- `local_blks_read bigint null`
- `local_blks_written bigint null`
- `max_exec_time double precision null`
- `max_plan_time double precision null`
- `mean_exec_time double precision null`
- `mean_plan_time double precision null`
- `min_exec_time double precision null`
- `min_plan_time double precision null`
- `minmax_stats_since timestamp with time zone null`
- `plans bigint null`
- `query text null`
- `queryid bigint null`
- `rows bigint null`
- `shared_blk_read_time double precision null`
- `shared_blk_write_time double precision null`
- `shared_blks_dirtied bigint null`
- `shared_blks_hit bigint null`
- `shared_blks_read bigint null`
- `shared_blks_written bigint null`
- `stats_since timestamp with time zone null`
- `stddev_exec_time double precision null`
- `stddev_plan_time double precision null`
- `temp_blk_read_time double precision null`
- `temp_blk_write_time double precision null`
- `temp_blks_read bigint null`
- `temp_blks_written bigint null`
- `toplevel boolean null`
- `total_exec_time double precision null`
- `total_plan_time double precision null`
- `userid oid null`
- `wal_bytes numeric null`
- `wal_fpi bigint null`
- `wal_records bigint null`

## public.pg_stat_statements_info (view)

- `dealloc bigint null`
- `stats_reset timestamp with time zone null`

## public.phone_consents (table)

- `ai_voice boolean = false`
- `created_at timestamp with time zone = now()`
- `e164 varchar(16)`
- `evidence jsonb = '{}'::jsonb`
- `given_at timestamp with time zone`
- `id integer = nextval('phone_consents_id_seq'::regclass)`
- `revoked_at timestamp with time zone null`
- `source varchar(16)`
- `text text`
- `text_version varchar(64)`
- `whose varchar(64) = 'wren'::character varying`

Indexes:

- `CREATE INDEX ix_phone_consents_e164 ON public.phone_consents USING btree (e164)`
- `CREATE UNIQUE INDEX pk_phone_consents ON public.phone_consents USING btree (id)`

## public.pipeline_funnel (view)

- `crawled bigint null`
- `in_play bigint null`
- `named_person bigint null`
- `niche varchar(32) null`
- `verified_named_lead bigint null`
- `with_domain bigint null`

## public.pipeline_leaks (view)

- `catch_all_leads bigint null`
- `crawled_no_person_firms bigint null`
- `niche varchar(32) null`
- `queued_firms bigint null`
- `risky_leads bigint null`

## public.placement_checks (table)

- `auth jsonb null`
- `checked_at timestamp with time zone null`
- `day date`
- `detail text null`
- `kind varchar(8)`
- `landed varchar(16) null`
- `message_id varchar(255) null`
- `seed varchar(320)`
- `sender varchar(320)`
- `sent_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_placement_checks ON public.placement_checks USING btree (sender, seed, day, kind)`

## public.platform_object_refs (table)

- `alias text`
- `created_at timestamp with time zone = now()`
- `platform varchar(16)`
- `ref varchar(255)`

References:

- public.platform_objects (platform → platform, ref → ref)

Indexes:

- `CREATE INDEX ix_platform_object_refs_platform_ref ON public.platform_object_refs USING btree (platform, ref)`
- `CREATE UNIQUE INDEX pk_platform_object_refs ON public.platform_object_refs USING btree (platform, alias)`

## public.platform_objects (table)

- `at timestamp with time zone null`
- `author varchar(200) null`
- `first_seen timestamp with time zone = now()`
- `kind varchar(16)`
- `last_seen timestamp with time zone = now()`
- `parent varchar(255) null`
- `platform varchar(16)`
- `post varchar(255) null`
- `ref varchar(255)`
- `url text null`

Indexes:

- `CREATE INDEX ix_platform_objects_platform_post ON public.platform_objects USING btree (platform, post)`
- `CREATE UNIQUE INDEX pk_platform_objects ON public.platform_objects USING btree (platform, ref)`

## public.post_metric_days (table)

- `day date`
- `draft_id uuid`
- `fetched_at timestamp with time zone = now()`
- `key varchar(200) = ''::character varying`
- `metric varchar(32)`
- `value double precision`

References:

- public.content_drafts (draft_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_post_metric_days ON public.post_metric_days USING btree (draft_id, day, metric, key)`

## public.post_variants (table)

- `asked_at timestamp with time zone = now()`
- `asked_by varchar(200) null`
- `decided_by varchar(200) null`
- `draft_id uuid`
- `ended_at timestamp with time zone null`
- `field varchar(16)`
- `id integer = nextval('post_variants_id_seq'::regclass)`
- `source varchar(16)`
- `started_at timestamp with time zone null`
- `state varchar(16)`
- `value text`
- `why text null`

References:

- public.content_drafts (draft_id → id)

Indexes:

- `CREATE INDEX ix_post_variants_draft_id_field ON public.post_variants USING btree (draft_id, field)`
- `CREATE UNIQUE INDEX pk_post_variants ON public.post_variants USING btree (id)`
- `CREATE UNIQUE INDEX uq_post_variants_live ON public.post_variants USING btree (draft_id, field) WHERE ((state)::text = 'live'::text)`

## public.postmaster_days (table)

- `day date`
- `delivery_error_rate double precision null`
- `dkim_success_ratio double precision null`
- `dmarc_success_ratio double precision null`
- `domain varchar(253)`
- `domain_reputation varchar(32) null`
- `raw jsonb`
- `run_id uuid null`
- `spam_rate double precision null`
- `spf_success_ratio double precision null`
- `synced_at timestamp with time zone = now()`
- `tls_inbound_count bigint null`
- `tls_outbound_count bigint null`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_postmaster_days_run_id ON public.postmaster_days USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_postmaster_days ON public.postmaster_days USING btree (domain, day)`

## public.profile_events (table)

- `at timestamp with time zone`
- `body text null`
- `channel varchar(24)`
- `id integer = nextval('profile_events_id_seq'::regclass)`
- `kind varchar(24)`
- `link text null`
- `profile_id integer`
- `source varchar(32)`
- `source_id varchar(64)`
- `summary text`
- `updated_at timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_profile_events_profile_id ON public.profile_events USING btree (profile_id, at)`
- `CREATE UNIQUE INDEX pk_profile_events ON public.profile_events USING btree (id)`
- `CREATE UNIQUE INDEX uq_profile_events_source ON public.profile_events USING btree (source, source_id)`

## public.profile_findings (table)

- `at timestamp with time zone = now()`
- `confidence double precision`
- `decided_at timestamp with time zone null`
- `decided_by varchar(320) null`
- `detail jsonb null`
- `id integer = nextval('profile_findings_id_seq'::regclass)`
- `kind varchar(16)`
- `lookup_id integer null`
- `platform varchar(24) null`
- `profile_id integer`
- `ref varchar(400)`
- `source varchar(24)`
- `state varchar(8) = 'found'::character varying`
- `url text null`
- `value text`

References:

- public.profile_lookups (lookup_id → id)
- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_profile_findings_lookup_id ON public.profile_findings USING btree (lookup_id)`
- `CREATE UNIQUE INDEX pk_profile_findings ON public.profile_findings USING btree (id)`
- `CREATE UNIQUE INDEX uq_profile_findings_profile_ref ON public.profile_findings USING btree (profile_id, ref)`

## public.profile_key_records (view)

- `first_seen timestamp with time zone null`
- `id integer null`
- `kind text null`
- `profile_id integer null`
- `profile_link text null`
- `source text null`
- `value text null`

## public.profile_keys (table)

- `first_seen timestamp with time zone = now()`
- `id integer = nextval('profile_keys_id_seq'::regclass)`
- `kind varchar(48)`
- `profile_id integer`
- `source varchar(32)`
- `value varchar(320)`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_profile_keys_profile_id ON public.profile_keys USING btree (profile_id, kind)`
- `CREATE INDEX ix_profile_keys_profile_text ON public.profile_keys USING btree (((profile_id)::text))`
- `CREATE UNIQUE INDEX pk_profile_keys ON public.profile_keys USING btree (id)`
- `CREATE UNIQUE INDEX uq_profile_keys_kind_value ON public.profile_keys USING btree (kind, value)`

## public.profile_list (table)

- `came_from text null`
- `channels text null`
- `consent text null`
- `emails text null`
- `first_channel text null`
- `first_seen timestamp with time zone`
- `handles text null`
- `keys integer`
- `last_channel text null`
- `last_seen timestamp with time zone`
- `last_touch_at timestamp with time zone null`
- `lead text null`
- `merged integer`
- `name text`
- `persona text`
- `persona_niche text`
- `persona_role text`
- `persona_size text`
- `phones text null`
- `profile_id integer`
- `replied_channel text null`
- `replied_last timestamp with time zone null`
- `replies integer`
- `stage text`
- `subscriptions text null`
- `traits integer`
- `warm_since timestamp with time zone null`
- `warmth text`
- `warmth_line text null`
- `why text null`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_profile_list_last_seen ON public.profile_list USING btree (((last_seen IS NULL)), last_seen DESC, ((profile_id)::text) COLLATE "C")`
- `CREATE INDEX ix_profile_list_profile_text ON public.profile_list USING btree (((profile_id)::text))`
- `CREATE UNIQUE INDEX pk_profile_list ON public.profile_list USING btree (profile_id)`

## public.profile_lookups (table)

- `by varchar(320) null`
- `created_at timestamp with time zone = now()`
- `error text null`
- `finished_at timestamp with time zone null`
- `id integer = nextval('profile_lookups_id_seq'::regclass)`
- `outcome varchar(24) null`
- `profile_id integer`
- `retry_at timestamp with time zone null`
- `started_at timestamp with time zone null`
- `state varchar(12)`
- `subject jsonb null`
- `tried jsonb null`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_profile_lookups_profile_id ON public.profile_lookups USING btree (profile_id, created_at)`
- `CREATE UNIQUE INDEX pk_profile_lookups ON public.profile_lookups USING btree (id)`

## public.profile_merge_records (view)

- `at timestamp with time zone null`
- `by text null`
- `from_id integer null`
- `from_name text null`
- `id integer null`
- `into_id integer null`
- `into_link text null`
- `keys integer null`
- `source text null`
- `traits integer null`

## public.profile_merges (table)

- `at timestamp with time zone = now()`
- `by varchar(400)`
- `from_id integer`
- `id integer = nextval('profile_merges_id_seq'::regclass)`
- `into_id integer`
- `keys integer`
- `source varchar(32)`
- `traits integer`

References:

- public.profiles (from_id → id; into_id → id)

Indexes:

- `CREATE INDEX ix_profile_merges_from_id ON public.profile_merges USING btree (from_id)`
- `CREATE INDEX ix_profile_merges_into_id ON public.profile_merges USING btree (into_id)`
- `CREATE UNIQUE INDEX pk_profile_merges ON public.profile_merges USING btree (id)`

## public.profile_records (view)

- `came_from text null`
- `channels text null`
- `consent text null`
- `emails text null`
- `first_channel text null`
- `first_seen timestamp with time zone null`
- `handles text null`
- `id integer null`
- `keys integer null`
- `last_channel text null`
- `last_seen timestamp with time zone null`
- `last_touch_at timestamp with time zone null`
- `lead text null`
- `merged integer null`
- `name text null`
- `persona text null`
- `persona_niche text null`
- `persona_role text null`
- `persona_size text null`
- `phones text null`
- `replied_channel text null`
- `replied_last timestamp with time zone null`
- `replies integer null`
- `stage text null`
- `subscriptions text null`
- `traits integer null`
- `warm_since timestamp with time zone null`
- `warmth text null`
- `warmth_line text null`
- `why text null`

## public.profile_rollups (table)

- `booked_first timestamp with time zone null`
- `booked_last timestamp with time zone null`
- `booked_n integer = 0`
- `came_from varchar(32) null`
- `clicked_first timestamp with time zone null`
- `clicked_last timestamp with time zone null`
- `clicked_n integer = 0`
- `contacted_first timestamp with time zone null`
- `contacted_last timestamp with time zone null`
- `contacted_n integer = 0`
- `engaged_first timestamp with time zone null`
- `engaged_last timestamp with time zone null`
- `engaged_n integer = 0`
- `first_channel varchar(24) null`
- `first_touch text null`
- `first_touch_at timestamp with time zone null`
- `form_first timestamp with time zone null`
- `form_last timestamp with time zone null`
- `form_n integer = 0`
- `last_channel varchar(24) null`
- `last_touch text null`
- `last_touch_at timestamp with time zone null`
- `opened_first timestamp with time zone null`
- `opened_last timestamp with time zone null`
- `opened_n integer = 0`
- `persona varchar(64)`
- `persona_niche varchar(32)`
- `persona_role varchar(16)`
- `persona_size varchar(16)`
- `profile_id integer`
- `refreshed_at timestamp with time zone = now()`
- `replied_channels text null`
- `replied_first timestamp with time zone null`
- `replied_last timestamp with time zone null`
- `replied_last_channel varchar(24) null`
- `replied_n integer = 0`
- `stage varchar(16)`
- `subscribed_first timestamp with time zone null`
- `subscribed_last timestamp with time zone null`
- `subscribed_n integer = 0`
- `subscriptions text null`
- `visited_first timestamp with time zone null`
- `visited_last timestamp with time zone null`
- `visited_n integer = 0`
- `warm_since timestamp with time zone null`
- `warmth varchar(8)`
- `warmth_line text null`
- `watched_first timestamp with time zone null`
- `watched_last timestamp with time zone null`
- `watched_n integer = 0`
- `why text = ''::text`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_profile_rollups_persona ON public.profile_rollups USING btree (persona)`
- `CREATE INDEX ix_profile_rollups_replied_last ON public.profile_rollups USING btree (replied_last)`
- `CREATE INDEX ix_profile_rollups_stage ON public.profile_rollups USING btree (stage)`
- `CREATE INDEX ix_profile_rollups_warmth ON public.profile_rollups USING btree (warmth, warm_since)`
- `CREATE UNIQUE INDEX pk_profile_rollups ON public.profile_rollups USING btree (profile_id)`

## public.profile_site_reads (table)

- `profile_id integer`
- `read_at timestamp with time zone`
- `visit_first timestamp with time zone null`
- `visit_last timestamp with time zone null`
- `visits integer`
- `watch_first timestamp with time zone null`
- `watch_last timestamp with time zone null`
- `watches integer`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_profile_site_reads_read_at ON public.profile_site_reads USING btree (read_at)`
- `CREATE UNIQUE INDEX pk_profile_site_reads ON public.profile_site_reads USING btree (profile_id)`

## public.profile_steps (view)

- `at timestamp with time zone null`
- `channel text null`
- `cost_usd double precision null`
- `profile_id integer null`
- `ref text null`
- `sends integer null`
- `source text null`
- `source_kind text null`
- `step text null`

## public.profile_timeline (view)

- `at timestamp with time zone null`
- `body text null`
- `channel text null`
- `context text null`
- `id text null`
- `kind text null`
- `link text null`
- `note text null`
- `profile_id integer null`
- `profile_link text null`
- `source text null`
- `summary text null`
- `who text null`

## public.profile_trait_activity (view)

- `at timestamp with time zone null`
- `kind text null`
- `seq integer null`
- `trait text null`
- `what text null`

## public.profile_trait_events (table)

- `at timestamp with time zone = now()`
- `id integer = nextval('profile_trait_events_id_seq'::regclass)`
- `key varchar(64)`
- `new jsonb`
- `old jsonb null`
- `profile_id integer`
- `source varchar(32)`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_profile_trait_events_profile_id ON public.profile_trait_events USING btree (profile_id, at)`
- `CREATE UNIQUE INDEX pk_profile_trait_events ON public.profile_trait_events USING btree (id)`

## public.profile_trait_records (view)

- `at timestamp with time zone null`
- `changes integer null`
- `id text null`
- `key text null`
- `profile_id integer null`
- `profile_link text null`
- `source text null`
- `value text null`

## public.profile_traits (table)

- `at timestamp with time zone = now()`
- `key varchar(64)`
- `profile_id integer`
- `source varchar(32)`
- `value jsonb`

References:

- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_profile_traits_key ON public.profile_traits USING btree (key)`
- `CREATE UNIQUE INDEX pk_profile_traits ON public.profile_traits USING btree (profile_id, key)`

## public.profiles (table)

- `created_at timestamp with time zone = now()`
- `first_seen timestamp with time zone = now()`
- `id integer = nextval('profiles_id_seq'::regclass)`
- `last_seen timestamp with time zone = now()`
- `merged_into integer null`
- `name text null`

References:

- public.profiles (merged_into → id)

Indexes:

- `CREATE INDEX ix_profiles_last_seen ON public.profiles USING btree (last_seen)`
- `CREATE INDEX ix_profiles_merged_into ON public.profiles USING btree (merged_into)`
- `CREATE UNIQUE INDEX pk_profiles ON public.profiles USING btree (id)`

## public.reach_accounts (table)

- `account varchar(120)`
- `created_at timestamp with time zone = now()`
- `handle varchar(120) null`
- `health jsonb null`
- `health_at timestamp with time zone null`
- `id uuid = gen_random_uuid()`
- `paused_reason text null`
- `platform varchar(16)`
- `retired_at timestamp with time zone null`
- `started_on date`
- `state varchar(16) = 'warming'::character varying`

Indexes:

- `CREATE UNIQUE INDEX pk_reach_accounts ON public.reach_accounts USING btree (id)`
- `CREATE UNIQUE INDEX uq_reach_accounts_platform_account ON public.reach_accounts USING btree (platform, account)`

## public.reach_contacts (table)

- `account_id uuid null`
- `company_id integer null`
- `connected_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `draft text null`
- `draft_at timestamp with time zone null`
- `draft_for integer null`
- `ended_at timestamp with time zone null`
- `enriched_at timestamp with time zone null`
- `enrolled_at timestamp with time zone null`
- `fit jsonb null`
- `found_in varchar(200)`
- `handle varchar(120)`
- `headline text null`
- `id integer = nextval('reach_contacts_id_seq'::regclass)`
- `name text null`
- `niche varchar(32) null`
- `person_id integer null`
- `platform varchar(16)`
- `profile jsonb null`
- `read_at timestamp with time zone null`
- `sequence varchar(64) null`
- `state varchar(16) = 'new'::character varying`
- `state_reason text null`
- `url text`
- `withdrawn_at timestamp with time zone null`

References:

- public.companies (company_id → id)
- public.people (person_id → id)
- public.reach_accounts (account_id → id)

Indexes:

- `CREATE INDEX ix_reach_contacts_account_id ON public.reach_contacts USING btree (account_id)`
- `CREATE INDEX ix_reach_contacts_company_id ON public.reach_contacts USING btree (company_id)`
- `CREATE INDEX ix_reach_contacts_person_id ON public.reach_contacts USING btree (person_id)`
- `CREATE INDEX ix_reach_contacts_state ON public.reach_contacts USING btree (state)`
- `CREATE UNIQUE INDEX pk_reach_contacts ON public.reach_contacts USING btree (id)`
- `CREATE UNIQUE INDEX uq_reach_contacts_platform_handle ON public.reach_contacts USING btree (platform, handle)`

## public.reach_invites (view)

- `account_id uuid null`
- `company_id integer null`
- `connected_at timestamp with time zone null`
- `contact_id integer null`
- `fit jsonb null`
- `found_in varchar(200) null`
- `handle varchar(120) null`
- `headline text null`
- `id integer null`
- `name text null`
- `niche varchar(32) null`
- `note text null`
- `person_id integer null`
- `queued_at timestamp with time zone null`
- `sent_at timestamp with time zone null`
- `state_reason text null`
- `status varchar null`
- `url text null`
- `withdrawn_at timestamp with time zone null`

## public.reach_messages (table)

- `account_id uuid null`
- `body text`
- `contact_id integer`
- `created_at timestamp with time zone = now()`
- `direction varchar(4)`
- `due_at timestamp with time zone null`
- `id integer = nextval('reach_messages_id_seq'::regclass)`
- `kind varchar(16)`
- `provenance jsonb null`
- `ref varchar(200) null`
- `run_id uuid null`
- `sent_at timestamp with time zone null`
- `state varchar(16)`
- `state_reason text null`
- `step smallint null`
- `subject text null`
- `template varchar(120) null`
- `template_version varchar(12) null`

References:

- public.reach_accounts (account_id → id)
- public.reach_contacts (contact_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_reach_messages_account_id ON public.reach_messages USING btree (account_id)`
- `CREATE INDEX ix_reach_messages_contact_id ON public.reach_messages USING btree (contact_id)`
- `CREATE INDEX ix_reach_messages_due ON public.reach_messages USING btree (state, due_at)`
- `CREATE INDEX ix_reach_messages_run_id ON public.reach_messages USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_reach_messages ON public.reach_messages USING btree (id)`
- `CREATE UNIQUE INDEX uq_reach_messages_follow_up ON public.reach_messages USING btree (contact_id, ((provenance ->> 'follow'::text))) WHERE ((kind)::text = 'follow_up'::text)`
- `CREATE UNIQUE INDEX uq_reach_messages_in_ref ON public.reach_messages USING btree (contact_id, ref) WHERE ((direction)::text = 'in'::text)`

## public.reach_passes (table)

- `by varchar(120) null`
- `created_at timestamp with time zone = now()`
- `handle varchar(200)`
- `id integer = nextval('reach_passes_id_seq'::regclass)`
- `item varchar(80) null`
- `lifted_at timestamp with time zone null`
- `name text`
- `note text null`
- `platform varchar(16)`
- `reason varchar(16)`
- `until timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_reach_passes ON public.reach_passes USING btree (id)`
- `CREATE UNIQUE INDEX uq_reach_passes_platform_handle ON public.reach_passes USING btree (platform, handle)`

## public.reach_posts (table)

- `account varchar(80)`
- `author text`
- `author_url text null`
- `comment text null`
- `commented_at timestamp with time zone null`
- `commented_by varchar(120) null`
- `comments integer = 0`
- `created_at timestamp with time zone = now()`
- `draft text null`
- `fit smallint null`
- `followed_at timestamp with time zone null`
- `found_by varchar(200)`
- `handle varchar(120) null`
- `headline text null`
- `id integer = nextval('reach_posts_id_seq'::regclass)`
- `liked_at timestamp with time zone null`
- `platform varchar(12) = 'linkedin'::character varying`
- `posted_at timestamp with time zone null`
- `queued_at timestamp with time zone null`
- `raw jsonb`
- `reactions integer = 0`
- `ref varchar(255)`
- `send_at timestamp with time zone null`
- `state varchar(12) = 'found'::character varying`
- `state_reason text null`
- `text text`
- `url text`
- `why text null`

References:

- public.platform_objects (platform → platform, ref → ref)

Indexes:

- `CREATE INDEX ix_reach_posts_state ON public.reach_posts USING btree (state)`
- `CREATE UNIQUE INDEX pk_reach_posts ON public.reach_posts USING btree (id)`
- `CREATE UNIQUE INDEX uq_reach_posts_platform_ref ON public.reach_posts USING btree (platform, ref)`

## public.reactivation_emails (view)

- `approved_by text null`
- `company varchar null`
- `domain varchar(255) null`
- `id integer null`
- `last_sent timestamp with time zone null`
- `name text null`
- `person integer null`
- `sent integer null`
- `status text null`
- `stop_reason varchar(32) null`
- `subject text null`
- `written timestamp with time zone null`

## public.reactivation_findings (view)

- `confidence real null`
- `id integer null`
- `kind varchar(32) null`
- `observed timestamp with time zone null`
- `person integer null`
- `subject text null`
- `title text null`
- `url text null`
- `via varchar(64) null`

## public.reactivation_keep (view)

- `champion text null`
- `champion_id integer null`
- `company varchar null`
- `domain varchar(255) null`
- `id integer null`
- `last_contact timestamp with time zone null`
- `last_placement timestamp with time zone null`
- `open_orders integer null`
- `placements integer null`
- `risk integer null`
- `signal text null`
- `since integer null`
- `usual_gap integer null`
- `visited timestamp with time zone null`
- `why text null`

## public.reactivation_people (view)

- `brief text null`
- `company varchar null`
- `domain varchar(255) null`
- `email varchar(32) null`
- `id integer null`
- `last_contact timestamp with time zone null`
- `last_placement timestamp with time zone null`
- `name text null`
- `next_step varchar(16) null`
- `now text null`
- `owner text null`
- `profile text null`
- `reason text null`
- `score integer null`
- `title text null`

## public.reactivation_person_activity (view)

- `at timestamp with time zone null`
- `kind varchar null`
- `person integer null`
- `what text null`

## public.reactivation_replies (view)

- `booked timestamp with time zone null`
- `company varchar null`
- `disposition varchar(32) null`
- `domain varchar(255) null`
- `handed_to varchar(320) null`
- `id integer null`
- `name text null`
- `person integer null`
- `received timestamp with time zone null`
- `status text null`
- `subject text null`

## public.recruiting_facts (view)

- `company_id integer null`
- `country varchar(2) null`
- `domain varchar(255) null`
- `employees integer null`
- `founded_year integer null`
- `name varchar null`
- `opener text null`
- `payroll_yearly_usd bigint null`
- `source_key varchar(64) null`
- `video_url text null`

## public.reddit_people (table)

- `created_at timestamp with time zone = now()`
- `facts jsonb`
- `fit smallint null`
- `handle varchar(64)`
- `name varchar(64)`
- `raw jsonb`
- `read jsonb null`
- `read_at timestamp with time zone`
- `site varchar(253) null`

Indexes:

- `CREATE INDEX ix_reddit_people_read_at ON public.reddit_people USING btree (read_at)`
- `CREATE UNIQUE INDEX pk_reddit_people ON public.reddit_people USING btree (handle)`

## public.reddit_places (table)

- `account_id uuid null`
- `created_at timestamp with time zone = now()`
- `fit smallint null`
- `found_by text`
- `joined_at timestamp with time zone null`
- `judged jsonb null`
- `name varchar(64)`
- `purpose varchar(16) = 'reach'::character varying`
- `raw jsonb null`
- `read_at timestamp with time zone null`
- `state varchar(16) = 'found'::character varying`
- `subreddit varchar(64)`
- `subscribers integer null`
- `threads_at timestamp with time zone null`

References:

- public.reach_accounts (account_id → id)

Indexes:

- `CREATE INDEX ix_reddit_places_account_id ON public.reddit_places USING btree (account_id)`
- `CREATE INDEX ix_reddit_places_state ON public.reddit_places USING btree (state)`
- `CREATE UNIQUE INDEX pk_reddit_places ON public.reddit_places USING btree (subreddit)`

## public.reddit_requirements (table)

- `cleared_at timestamp with time zone null`
- `evidence text null`
- `hold boolean = false`
- `item varchar(80) null`
- `learned_at timestamp with time zone = now()`
- `min_age_days integer null`
- `min_comment_karma integer null`
- `min_karma integer null`
- `other text null`
- `source varchar(16)`
- `subreddit varchar(64)`

References:

- public.reddit_places (subreddit → subreddit)

Indexes:

- `CREATE UNIQUE INDEX pk_reddit_requirements ON public.reddit_requirements USING btree (subreddit, source)`

## public.reddit_threads (table)

- `account_id uuid null`
- `angle text null`
- `answer text null`
- `answer_ref varchar(20) null`
- `answered_at timestamp with time zone null`
- `author varchar(64)`
- `body text`
- `comments integer`
- `created_at timestamp with time zone = now()`
- `draft text null`
- `dropped text null`
- `fit smallint null`
- `id varchar(20)`
- `kind varchar(16) null`
- `platform varchar(16) = 'reddit'::character varying`
- `posted_at timestamp with time zone`
- `raw jsonb`
- `score integer null`
- `scored_at timestamp with time zone null`
- `send_at timestamp with time zone null`
- `sources jsonb null`
- `state varchar(16) = 'new'::character varying`
- `subreddit varchar(64)`
- `target varchar(20) null`
- `target_text text null`
- `title text`
- `url text`

References:

- public.platform_objects (platform → platform, answer_ref → ref; platform → platform, id → ref; platform → platform, target → ref)
- public.reach_accounts (account_id → id)
- public.reddit_places (subreddit → subreddit)

Indexes:

- `CREATE INDEX ix_reddit_threads_account_id ON public.reddit_threads USING btree (account_id)`
- `CREATE INDEX ix_reddit_threads_platform_answer_ref ON public.reddit_threads USING btree (platform, answer_ref)`
- `CREATE INDEX ix_reddit_threads_platform_target ON public.reddit_threads USING btree (platform, target)`
- `CREATE INDEX ix_reddit_threads_state ON public.reddit_threads USING btree (state)`
- `CREATE INDEX ix_reddit_threads_subreddit ON public.reddit_threads USING btree (subreddit)`
- `CREATE UNIQUE INDEX pk_reddit_threads ON public.reddit_threads USING btree (id)`

## public.rejections_by_reason (view)

- `niche varchar(32) null`
- `reason varchar null`
- `rejected bigint null`
- `template varchar(64) null`
- `template_version varchar(12) null`

## public.reply_by_arm_step (view)

- `arm varchar null`
- `hard_bounces bigint null`
- `interested bigint null`
- `niche varchar(32) null`
- `replies bigint null`
- `reply_rate_pct numeric null`
- `sent bigint null`
- `step integer null`
- `template varchar(64) null`
- `template_version varchar(12) null`

## public.reply_by_evidence (view)

- `bounce_rate_pct numeric null`
- `enrolled bigint null`
- `enrollment_kind varchar(32) null`
- `evidence text null`
- `hard_bounced bigint null`
- `interested bigint null`
- `niche varchar(32) null`
- `opened bigint null`
- `pick_method text null`
- `replied bigint null`
- `reply_rate_pct numeric null`
- `unsubscribed bigint null`
- `verification_result text null`

## public.reply_outcomes (view)

- `bounce_class varchar(32) null`
- `company_id integer null`
- `disposition varchar(32) null`
- `disposition_source varchar(32) null`
- `enrollment_id integer null`
- `enrollment_kind varchar(32) null`
- `event_id integer null`
- `kind varchar(32) null`
- `niche varchar(32) null`
- `received_at timestamp with time zone null`
- `replied_to_step integer null`
- `replied_to_template varchar(64) null`
- `replied_to_template_version varchar(12) null`
- `sender varchar(320) null`
- `sequence_name varchar(64) null`
- `to_email varchar(320) null`

## public.reports (table)

- `body text`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('reports_id_seq'::regclass)`
- `kind varchar(32)`
- `period_end timestamp with time zone`
- `period_start timestamp with time zone`
- `run_id uuid null`
- `sent_to varchar(320) null`
- `stats jsonb`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_reports_kind_period_end ON public.reports USING btree (kind, period_end)`
- `CREATE INDEX ix_reports_run_id ON public.reports USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_reports ON public.reports USING btree (id)`

## public.research_signals (view)

- `age text null`
- `at timestamp with time zone null`
- `company_id integer null`
- `confidence real null`
- `dated varchar(12) null`
- `document_id integer null`
- `first_seen timestamp with time zone null`
- `id integer null`
- `kind varchar(32) null`
- `person_id integer null`
- `seen timestamp with time zone null`
- `subject text null`
- `title text null`
- `topic text null`
- `url text null`
- `via varchar(64) null`

## public.review_asks (table)

- `ask varchar(16)`
- `ask_at timestamp with time zone`
- `ask_detail text null`
- `clicked_at timestamp with time zone null`
- `clicks integer = 0`
- `contact_id integer null`
- `created_at timestamp with time zone = now()`
- `e164 varchar(16) null`
- `email text null`
- `feedback text null`
- `feedback_at timestamp with time zone null`
- `id integer = nextval('review_asks_id_seq'::regclass)`
- `name text null`
- `phone varchar(64) null`
- `place_id varchar(200) null`
- `reminder varchar(16) null`
- `reminder_at timestamp with time zone null`
- `reminder_detail text null`
- `sent_at timestamp with time zone null`
- `source varchar(8)`
- `subject varchar(200)`
- `token varchar(32)`
- `via varchar(8) = 'text'::character varying`

References:

- public.sms_contacts (contact_id → id)

Indexes:

- `CREATE INDEX ix_review_asks_ask_at ON public.review_asks USING btree (ask_at)`
- `CREATE INDEX ix_review_asks_contact_id ON public.review_asks USING btree (contact_id)`
- `CREATE INDEX ix_review_asks_e164 ON public.review_asks USING btree (e164)`
- `CREATE INDEX ix_review_asks_email ON public.review_asks USING btree (email)`
- `CREATE UNIQUE INDEX pk_review_asks ON public.review_asks USING btree (id)`
- `CREATE UNIQUE INDEX uq_review_asks_subject ON public.review_asks USING btree (subject)`
- `CREATE UNIQUE INDEX uq_review_asks_token ON public.review_asks USING btree (token)`

## public.review_outcomes (view)

- `approved bigint null`
- `auto_approved bigint null`
- `awaiting bigint null`
- `drafted bigint null`
- `edit_rate_pct numeric null`
- `edited bigint null`
- `niche varchar(32) null`
- `reject_rate_pct numeric null`
- `rejected bigint null`
- `reviewed bigint null`
- `sent bigint null`
- `template varchar(64) null`
- `template_version varchar(12) null`

## public.role_grants (table)

- `apps text[] null`
- `channels text[] null`
- `id integer = nextval('role_grants_id_seq'::regclass)`
- `record text null`
- `role varchar(64)`
- `verbs text[]`

References:

- public.roles (role → id)

Indexes:

- `CREATE INDEX ix_role_grants_role ON public.role_grants USING btree (role)`
- `CREATE UNIQUE INDEX pk_role_grants ON public.role_grants USING btree (id)`

## public.roles (table)

- `about text null`
- `client varchar(40) null`
- `created_at timestamp with time zone = now()`
- `created_by text null`
- `id varchar(64)`
- `name text`

Indexes:

- `CREATE INDEX ix_roles_client ON public.roles USING btree (client)`
- `CREATE UNIQUE INDEX pk_roles ON public.roles USING btree (id)`

## public.run_events (table)

- `at timestamp with time zone = now()`
- `count integer null`
- `detail text null`
- `kind varchar(16)`
- `line text`
- `run_id uuid`
- `seq integer = nextval('run_events_seq_seq'::regclass)`
- `source jsonb null`
- `step varchar(64)`
- `subject text null`
- `trace_id varchar(32) null`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_run_events_run_id_seq ON public.run_events USING btree (run_id, seq)`
- `CREATE UNIQUE INDEX pk_run_events ON public.run_events USING btree (seq)`

## public.runs (table)

- `argv jsonb`
- `command varchar(64)`
- `finished_at timestamp with time zone null`
- `id uuid`
- `model varchar(64) null`
- `niche varchar(64) null`
- `started_at timestamp with time zone = now()`
- `stats jsonb null`

Indexes:

- `CREATE UNIQUE INDEX pk_runs ON public.runs USING btree (id)`

## public.saved_views (table)

- `created_at timestamp with time zone = now()`
- `id integer = nextval('saved_views_id_seq'::regclass)`
- `name varchar(60)`
- `params text`
- `position integer = 0`
- `record varchar(64)`
- `shared boolean = false`
- `updated_at timestamp with time zone = now()`
- `viewer varchar(200)`
- `workspace varchar(64)`

Indexes:

- `CREATE INDEX ix_saved_views_workspace_record ON public.saved_views USING btree (workspace, record, "position")`
- `CREATE UNIQUE INDEX pk_saved_views ON public.saved_views USING btree (id)`

## public.scroll_days (table)

- `band integer`
- `day date`
- `page varchar(200)`
- `synced_at timestamp with time zone = now()`
- `views integer`
- `width varchar(8)`

Indexes:

- `CREATE UNIQUE INDEX pk_scroll_days ON public.scroll_days USING btree (day, page, width, band)`

## public.search_answers (table)

- `asked_on date`
- `cited boolean`
- `engine varchar(16)`
- `keyword_id integer`
- `overview boolean null`
- `questions jsonb`
- `rank integer null`
- `run_id uuid null`
- `sources jsonb`

References:

- public.runs (run_id → id)
- public.search_keywords (keyword_id → id)

Indexes:

- `CREATE INDEX ix_search_answers_keyword_id ON public.search_answers USING btree (keyword_id)`
- `CREATE INDEX ix_search_answers_run_id ON public.search_answers USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_search_answers ON public.search_answers USING btree (engine, keyword_id, asked_on)`

## public.search_days (table)

- `clicks integer`
- `day date`
- `impressions integer`
- `page text`
- `position double precision`
- `query text`
- `run_id uuid null`
- `synced_at timestamp with time zone = now()`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_search_days_query ON public.search_days USING btree (query)`
- `CREATE INDEX ix_search_days_run_id ON public.search_days USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_search_days ON public.search_days USING btree (day, query, page)`

## public.search_keywords (table)

- `added_at timestamp with time zone = now()`
- `id integer = nextval('search_keywords_id_seq'::regclass)`
- `page text null`
- `parent_id integer null`
- `phrase text`
- `retired_at timestamp with time zone null`
- `run_id uuid null`
- `source varchar(16)`

References:

- public.runs (run_id → id)
- public.search_keywords (parent_id → id)

Indexes:

- `CREATE INDEX ix_search_keywords_parent_id ON public.search_keywords USING btree (parent_id)`
- `CREATE INDEX ix_search_keywords_run_id ON public.search_keywords USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_search_keywords ON public.search_keywords USING btree (id)`
- `CREATE UNIQUE INDEX uq_search_keywords_phrase ON public.search_keywords USING btree (phrase)`

## public.search_pages (table)

- `checked_on date`
- `coverage text null`
- `google_canonical text null`
- `last_crawl timestamp with time zone null`
- `raw jsonb`
- `run_id uuid null`
- `url text`
- `verdict varchar(32)`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_search_pages_run_id ON public.search_pages USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_search_pages ON public.search_pages USING btree (url, checked_on)`

## public.search_proposals (table)

- `current text`
- `id integer = nextval('search_proposals_id_seq'::regclass)`
- `keywords jsonb`
- `kind varchar(16)`
- `llm jsonb null`
- `made_on date`
- `page text`
- `pr text null`
- `proposed text`
- `run_id uuid null`
- `state varchar(16) = 'open'::character varying`
- `why text`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_search_proposals_run_id ON public.search_proposals USING btree (run_id)`
- `CREATE INDEX ix_search_proposals_state ON public.search_proposals USING btree (state)`
- `CREATE UNIQUE INDEX pk_search_proposals ON public.search_proposals USING btree (id)`

## public.segment_member_events (table)

- `at timestamp with time zone = now()`
- `change varchar(8)`
- `id integer = nextval('segment_member_events_id_seq'::regclass)`
- `profile_id integer`
- `segment_id integer`

References:

- public.profiles (profile_id → id)
- public.segments (segment_id → id)

Indexes:

- `CREATE INDEX ix_segment_member_events_profile_id ON public.segment_member_events USING btree (profile_id, at)`
- `CREATE INDEX ix_segment_member_events_segment_id ON public.segment_member_events USING btree (segment_id, at)`
- `CREATE UNIQUE INDEX pk_segment_member_events ON public.segment_member_events USING btree (id)`

## public.segment_member_records (view)

- `emails text null`
- `id text null`
- `name text null`
- `phones text null`
- `profile_id integer null`
- `profile_link text null`
- `segment text null`
- `segment_id integer null`
- `segment_kind text null`
- `since timestamp with time zone null`

## public.segment_members (table)

- `profile_id integer`
- `segment_id integer`
- `since timestamp with time zone = now()`

References:

- public.profiles (profile_id → id)
- public.segments (segment_id → id)

Indexes:

- `CREATE INDEX ix_segment_members_profile_id ON public.segment_members USING btree (profile_id)`
- `CREATE UNIQUE INDEX pk_segment_members ON public.segment_members USING btree (segment_id, profile_id)`

## public.segment_records (view)

- `archived_at timestamp with time zone null`
- `by text null`
- `computed_at timestamp with time zone null`
- `created_at timestamp with time zone null`
- `id integer null`
- `kind text null`
- `members text null`
- `name text null`
- `size integer null`
- `state text null`
- `used_at timestamp with time zone null`
- `used_by text null`
- `uses integer null`
- `words text null`

## public.segment_versions (table)

- `at timestamp with time zone = now()`
- `by varchar(320)`
- `kind varchar(16)`
- `name varchar(120)`
- `rule jsonb null`
- `segment_id integer`
- `version integer`
- `words text null`

References:

- public.segments (segment_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_segment_versions ON public.segment_versions USING btree (segment_id, version)`

## public.segments (table)

- `archived_at timestamp with time zone null`
- `by varchar(320)`
- `computed_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('segments_id_seq'::regclass)`
- `kind varchar(16)`
- `name varchar(120)`
- `rule jsonb null`
- `size integer = 0`
- `state varchar(16) = 'active'::character varying`
- `updated_at timestamp with time zone = now()`
- `used_at timestamp with time zone = now()`
- `uses jsonb = '[]'::jsonb`
- `version integer = 1`
- `words text null`

Indexes:

- `CREATE INDEX ix_segments_state ON public.segments USING btree (state, kind)`
- `CREATE UNIQUE INDEX pk_segments ON public.segments USING btree (id)`
- `CREATE UNIQUE INDEX uq_segments_name ON public.segments USING btree (name)`

## public.send_attempts (table)

- `account varchar(80) null`
- `invocation varchar(120) null`
- `item varchar(80)`
- `platform varchar(16)`
- `ref varchar(200) null`
- `send_key varchar(200) null`
- `sent_at timestamp with time zone null`
- `settled_by varchar(120) null`
- `started_at timestamp with time zone`
- `state varchar(12)`
- `target varchar(200)`
- `tries smallint = 0`
- `updated_at timestamp with time zone`
- `url text null`
- `why text null`
- `words text`

Indexes:

- `CREATE INDEX ix_send_attempts_state ON public.send_attempts USING btree (state)`
- `CREATE UNIQUE INDEX pk_send_attempts ON public.send_attempts USING btree (item)`

## public.send_health (view)

- `auto_replies bigint null`
- `bounce_rate numeric null`
- `complaints bigint null`
- `day date null`
- `domain text null`
- `hard_bounces bigint null`
- `replies bigint null`
- `sender varchar(320) null`
- `sent bigint null`
- `soft_bounces bigint null`
- `unsubscribes bigint null`

## public.send_journal (table)

- `account varchar(120) null`
- `key varchar(200)`
- `method varchar(8)`
- `path text`
- `site varchar(40)`
- `started_at timestamp with time zone`
- `updated_at timestamp with time zone`
- `verdict jsonb null`

Indexes:

- `CREATE INDEX ix_send_journal_started ON public.send_journal USING btree (started_at)`
- `CREATE UNIQUE INDEX pk_send_journal ON public.send_journal USING btree (key)`

## public.sender_pauses (table)

- `detail jsonb null`
- `domain varchar(255)`
- `id integer = nextval('sender_pauses_id_seq'::regclass)`
- `lifted_at timestamp with time zone null`
- `lifted_by varchar(64) null`
- `paused_at timestamp with time zone = now()`
- `reason text`
- `sender varchar(320)`
- `source varchar(32)`

Indexes:

- `CREATE INDEX ix_sender_pauses_sender ON public.sender_pauses USING btree (sender)`
- `CREATE UNIQUE INDEX pk_sender_pauses ON public.sender_pauses USING btree (id)`
- `CREATE UNIQUE INDEX uq_sender_pauses_active ON public.sender_pauses USING btree (sender) WHERE (lifted_at IS NULL)`

## public.sent_activity (view)

- `at timestamp with time zone null`
- `kind text null`
- `message text null`
- `seq integer null`
- `what text null`

## public.sent_records (view)

- `at timestamp with time zone null`
- `broadcast integer null`
- `campaign text null`
- `channel text null`
- `channel_state varchar null`
- `id text null`
- `key_kind text null`
- `key_value text null`
- `kind text null`
- `state text null`
- `subject text null`
- `to_address varchar null`

## public.setup_alerts (table)

- `account_id integer`
- `at timestamp with time zone = now()`
- `body text null`
- `cleared_at timestamp with time zone null`
- `client varchar(40) null`
- `digest_at timestamp with time zone null`
- `fact varchar(80) null`
- `for varchar(8)`
- `id integer = nextval('setup_alerts_id_seq'::regclass)`
- `key varchar(200)`
- `kind varchar(8)`
- `level varchar(8)`
- `part varchar(64) null`
- `setup varchar(64) null`
- `step varchar(40) null`
- `title text`
- `told_at timestamp with time zone null`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE INDEX ix_setup_alerts_account ON public.setup_alerts USING btree (account_id, at)`
- `CREATE INDEX ix_setup_alerts_open ON public.setup_alerts USING btree (client, cleared_at)`
- `CREATE UNIQUE INDEX pk_setup_alerts ON public.setup_alerts USING btree (id)`
- `CREATE UNIQUE INDEX uq_setup_alerts_key ON public.setup_alerts USING btree (key)`

## public.setup_runs (table)

- `account_id integer`
- `by varchar(320)`
- `done_at timestamp with time zone null`
- `gen integer = 1`
- `id integer = nextval('setup_runs_id_seq'::regclass)`
- `mode varchar(8)`
- `next_check_at timestamp with time zone null`
- `rounds integer = 0`
- `setup varchar(64)`
- `started_at timestamp with time zone = now()`
- `state varchar(16)`
- `step varchar(40) null`
- `step_since timestamp with time zone = now()`
- `why text null`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE INDEX ix_setup_runs_due ON public.setup_runs USING btree (state, next_check_at)`
- `CREATE UNIQUE INDEX pk_setup_runs ON public.setup_runs USING btree (id)`
- `CREATE UNIQUE INDEX uq_setup_runs_account ON public.setup_runs USING btree (account_id, setup)`

## public.sightings (table)

- `company_id integer null`
- `id integer = nextval('sightings_id_seq'::regclass)`
- `import_id integer`
- `lead_id integer null`
- `person_id integer null`
- `raw jsonb`
- `row_number integer`
- `seen_at timestamp with time zone = now()`

References:

- public.companies (company_id → id)
- public.imports (import_id → id)
- public.leads (lead_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_sightings_company_id ON public.sightings USING btree (company_id)`
- `CREATE INDEX ix_sightings_import_id ON public.sightings USING btree (import_id)`
- `CREATE INDEX ix_sightings_lead_id ON public.sightings USING btree (lead_id)`
- `CREATE INDEX ix_sightings_person_id ON public.sightings USING btree (person_id)`
- `CREATE UNIQUE INDEX pk_sightings ON public.sightings USING btree (id)`

## public.signal_checks (table)

- `answer jsonb null`
- `checked_at timestamp with time zone = now()`
- `collector varchar(32)`
- `found integer = 0`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `state varchar(16)`
- `subject varchar(160)`
- `tried jsonb`

References:

- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_signal_checks_checked_at ON public.signal_checks USING btree (checked_at)`
- `CREATE INDEX ix_signal_checks_run_id ON public.signal_checks USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_signal_checks ON public.signal_checks USING btree (collector, subject)`

## public.site_days (table)

- `bookings integer`
- `calls integer = 0`
- `campaign varchar(100)`
- `channel varchar(16)`
- `day date`
- `first_touches integer`
- `forms integer`
- `paid integer = 0`
- `synced_at timestamp with time zone = now()`
- `visits integer`
- `watch_plays integer`

Indexes:

- `CREATE UNIQUE INDEX pk_site_days ON public.site_days USING btree (day, channel, campaign)`

## public.site_entry_records (view)

- `answers text null`
- `at timestamp with time zone null`
- `campaign text null`
- `channel text null`
- `consent_text text null`
- `consent_version text null`
- `consented text null`
- `email text null`
- `entered text null`
- `form text null`
- `form_name text null`
- `human text null`
- `id text null`
- `owner text null`
- `owner_name text null`
- `page text null`
- `page_title text null`
- `phone text null`
- `source text null`
- `visitor text null`
- `who text null`
- `why text null`

## public.site_events (table)

- `arm varchar(1) null`
- `at timestamp with time zone = now()`
- `campaign varchar(120) null`
- `channel varchar(10)`
- `content varchar(120) null`
- `form uuid null`
- `form_split uuid null`
- `id bigint = nextval('site_events_id_seq'::regclass)`
- `medium varchar(120) null`
- `name varchar(8)`
- `page uuid null`
- `ref varchar(200) null`
- `source varchar(120) null`
- `split uuid null`
- `step smallint null`
- `view varchar(36)`
- `width integer null`

References:

- public.site_form_defs (form → id)
- public.site_form_splits (form_split → id)
- public.site_pages (page → id)
- public.site_splits (split → id)

Indexes:

- `CREATE INDEX ix_site_events_form_at ON public.site_events USING btree (form, at)`
- `CREATE INDEX ix_site_events_form_split ON public.site_events USING btree (form_split) WHERE (form_split IS NOT NULL)`
- `CREATE INDEX ix_site_events_page_at ON public.site_events USING btree (page, at)`
- `CREATE INDEX ix_site_events_split ON public.site_events USING btree (split) WHERE (split IS NOT NULL)`
- `CREATE UNIQUE INDEX pk_site_events ON public.site_events USING btree (id)`

## public.site_form_defs (table)

- `client varchar(40) null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `hook uuid null`
- `id uuid = gen_random_uuid()`
- `name varchar(2000)`
- `slug varchar(80)`
- `spec jsonb`
- `status varchar(8) = 'draft'::character varying`
- `updated_at timestamp with time zone = now()`
- `updated_by text`

References:

- public.clients (client → id)
- public.hooks (hook → id)

Indexes:

- `CREATE INDEX ix_site_form_defs_client ON public.site_form_defs USING btree (client)`
- `CREATE INDEX ix_site_form_defs_hook ON public.site_form_defs USING btree (hook)`
- `CREATE UNIQUE INDEX pk_site_form_defs ON public.site_form_defs USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_form_defs_slug ON public.site_form_defs USING btree (COALESCE(client, ''::character varying), slug)`

## public.site_form_records (view)

- `address text null`
- `changed timestamp with time zone null`
- `changed_by text null`
- `conversion double precision null`
- `fields integer null`
- `id text null`
- `last timestamp with time zone null`
- `name text null`
- `owner text null`
- `owner_name text null`
- `slug text null`
- `starts integer null`
- `status text null`
- `submits integer null`
- `url text null`
- `views integer null`

## public.site_form_splits (table)

- `b jsonb`
- `client varchar(40) null`
- `ended_at timestamp with time zone null`
- `ended_by text null`
- `form uuid`
- `id uuid = gen_random_uuid()`
- `started_at timestamp with time zone = now()`
- `started_by text`
- `state varchar(8) = 'running'::character varying`
- `updated_at timestamp with time zone = now()`
- `updated_by text`
- `weight integer = 50`
- `winner varchar(1) null`

References:

- public.clients (client → id)
- public.site_form_defs (form → id)

Indexes:

- `CREATE INDEX ix_site_form_splits_client ON public.site_form_splits USING btree (client)`
- `CREATE INDEX ix_site_form_splits_form ON public.site_form_splits USING btree (form)`
- `CREATE UNIQUE INDEX pk_site_form_splits ON public.site_form_splits USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_form_splits_running ON public.site_form_splits USING btree (form) WHERE ((state)::text = 'running'::text)`

## public.site_forms (table)

- `arm varchar(1) null`
- `at timestamp with time zone = now()`
- `channel varchar(10)`
- `consent jsonb null`
- `entered boolean = false`
- `fields jsonb`
- `form uuid null`
- `form_split uuid null`
- `human varchar(4) null`
- `id uuid = gen_random_uuid()`
- `page uuid null`
- `pages jsonb null`
- `split uuid null`
- `touch jsonb`
- `visitor varchar(64) null`
- `why text null`

References:

- public.site_form_defs (form → id)
- public.site_form_splits (form_split → id)
- public.site_pages (page → id)
- public.site_splits (split → id)

Indexes:

- `CREATE INDEX ix_site_forms_form_at ON public.site_forms USING btree (form, at)`
- `CREATE INDEX ix_site_forms_form_split ON public.site_forms USING btree (form_split) WHERE (form_split IS NOT NULL)`
- `CREATE INDEX ix_site_forms_page_at ON public.site_forms USING btree (page, at)`
- `CREATE INDEX ix_site_forms_split ON public.site_forms USING btree (split) WHERE (split IS NOT NULL)`
- `CREATE UNIQUE INDEX pk_site_forms ON public.site_forms USING btree (id)`

## public.site_funnel_records (view)

- `books integer null`
- `channel text null`
- `cost_per_form double precision null`
- `ctas integer null`
- `currency text null`
- `form_rate double precision null`
- `forms integer null`
- `id text null`
- `last timestamp with time zone null`
- `offer text null`
- `page text null`
- `spend double precision null`
- `status text null`
- `title text null`
- `views integer null`

## public.site_hops (table)

- `at timestamp with time zone = now()`
- `campaign varchar(120) null`
- `channel varchar(10)`
- `client varchar(40) null`
- `content varchar(120) null`
- `id bigint = nextval('site_hops_id_seq'::regclass)`
- `link varchar(80)`
- `medium varchar(120) null`
- `page uuid null`
- `ref varchar(200) null`
- `source varchar(120) null`
- `to varchar(200)`

References:

- public.clients (client → id)
- public.site_pages (page → id)

Indexes:

- `CREATE INDEX ix_site_hops_client_at ON public.site_hops USING btree (client, at)`
- `CREATE INDEX ix_site_hops_page_at ON public.site_hops USING btree (page, at)`
- `CREATE UNIQUE INDEX pk_site_hops ON public.site_hops USING btree (id)`

## public.site_link_records (view)

- `books integer null`
- `campaign text null`
- `channel text null`
- `clicks integer null`
- `content text null`
- `created timestamp with time zone null`
- `created_by text null`
- `forms integer null`
- `host text null`
- `id text null`
- `last timestamp with time zone null`
- `link text null`
- `medium text null`
- `name text null`
- `owner text null`
- `owner_name text null`
- `page text null`
- `page_title text null`
- `slug text null`
- `source text null`
- `url text null`
- `visits integer null`

## public.site_links (table)

- `campaign varchar(80)`
- `channel varchar(10)`
- `client varchar(40) null`
- `content varchar(80) null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `id uuid = gen_random_uuid()`
- `link varchar(80)`
- `medium varchar(120)`
- `name varchar(2000) null`
- `page uuid`
- `source varchar(120)`

References:

- public.clients (client → id)
- public.site_pages (page → id)

Indexes:

- `CREATE INDEX ix_site_links_client ON public.site_links USING btree (client)`
- `CREATE INDEX ix_site_links_page ON public.site_links USING btree (page)`
- `CREATE UNIQUE INDEX pk_site_links ON public.site_links USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_links_utm ON public.site_links USING btree (COALESCE(client, ''::character varying), page, link, campaign, COALESCE(content, ''::character varying))`

## public.site_page_records (view)

- `address text null`
- `ads integer null`
- `angle text null`
- `asked text null`
- `audience text null`
- `books integer null`
- `changed timestamp with time zone null`
- `changed_by text null`
- `cost_per_form double precision null`
- `ctas integer null`
- `currency text null`
- `form_rate double precision null`
- `forms integer null`
- `id text null`
- `kind text null`
- `offer text null`
- `owner text null`
- `owner_name text null`
- `repo_path text null`
- `source text null`
- `spend double precision null`
- `split text null`
- `stage text null`
- `status text null`
- `template text null`
- `title text null`
- `url text null`
- `variant_of text null`
- `views integer null`
- `waiting integer null`

## public.site_page_versions (table)

- `at timestamp with time zone = now()`
- `by text`
- `content jsonb`
- `number integer`
- `origin varchar(8)`
- `page uuid`
- `why text null`

References:

- public.site_pages (page → id)

Indexes:

- `CREATE UNIQUE INDEX pk_site_page_versions ON public.site_page_versions USING btree (page, number)`

## public.site_pages (table)

- `angle varchar(1200) null`
- `audience varchar(120) null`
- `client varchar(40) null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `draft_version integer null`
- `hook uuid null`
- `id uuid = gen_random_uuid()`
- `kind varchar(12)`
- `live_version integer null`
- `notes text null`
- `offer varchar(64) null`
- `preview_token varchar(43)`
- `repo_path text null`
- `retire_at timestamp with time zone null`
- `retire_by text null`
- `slug varchar(80)`
- `source varchar(8)`
- `stage varchar(8) = 'convert'::character varying`
- `status varchar(8) = 'draft'::character varying`
- `template varchar(16) null`
- `title varchar(2000)`
- `updated_at timestamp with time zone = now()`
- `updated_by text`
- `url text null`
- `variant_of uuid null`
- `waiting_at timestamp with time zone null`
- `waiting_by text null`
- `waiting_version integer null`

References:

- public.clients (client → id)
- public.hooks (hook → id)
- public.site_pages (variant_of → id)

Indexes:

- `CREATE INDEX ix_site_pages_client ON public.site_pages USING btree (client)`
- `CREATE INDEX ix_site_pages_hook ON public.site_pages USING btree (hook)`
- `CREATE INDEX ix_site_pages_offer ON public.site_pages USING btree (offer)`
- `CREATE INDEX ix_site_pages_variant_of ON public.site_pages USING btree (variant_of)`
- `CREATE UNIQUE INDEX pk_site_pages ON public.site_pages USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_pages_slug ON public.site_pages USING btree (COALESCE(client, ''::character varying), slug)`
- `CREATE UNIQUE INDEX uq_site_pages_url ON public.site_pages USING btree (url) WHERE (url IS NOT NULL)`

## public.site_split_arms (table)

- `label varchar(2)`
- `page uuid`
- `split uuid`
- `weight integer`

References:

- public.site_pages (page → id)
- public.site_splits (split → id)

Indexes:

- `CREATE INDEX ix_site_split_arms_page ON public.site_split_arms USING btree (page)`
- `CREATE UNIQUE INDEX pk_site_split_arms ON public.site_split_arms USING btree (split, label)`
- `CREATE UNIQUE INDEX uq_site_split_arms_page ON public.site_split_arms USING btree (split, page)`

## public.site_splits (table)

- `client varchar(40) null`
- `ended_at timestamp with time zone null`
- `ended_by text null`
- `goal varchar(8) = 'forms'::character varying`
- `id uuid = gen_random_uuid()`
- `page uuid`
- `ship_version integer null`
- `started_at timestamp with time zone = now()`
- `started_by text`
- `state varchar(10) = 'running'::character varying`
- `updated_at timestamp with time zone = now()`
- `winner varchar(2) null`

References:

- public.clients (client → id)
- public.site_pages (page → id)

Indexes:

- `CREATE INDEX ix_site_splits_client ON public.site_splits USING btree (client)`
- `CREATE UNIQUE INDEX pk_site_splits ON public.site_splits USING btree (id)`
- `CREATE UNIQUE INDEX uq_site_splits_live ON public.site_splits USING btree (page) WHERE ((state)::text = ANY ((ARRAY['running'::character varying, 'shipping'::character varying])::text[]))`

## public.sms_calls (table)

- `answered_at timestamp with time zone null`
- `booked_at timestamp with time zone null`
- `bridged_at timestamp with time zone null`
- `call_id varchar(128)`
- `cause varchar(32) null`
- `contact_id integer null`
- `created_at timestamp with time zone = now()`
- `ended_at timestamp with time zone null`
- `from_e164 varchar(32)`
- `id integer = nextval('sms_calls_id_seq'::regclass)`
- `known boolean null`
- `number_id uuid null`
- `replied_at timestamp with time zone null`
- `result varchar(16) null`
- `started_at timestamp with time zone`
- `text_back varchar(16) null`
- `text_back_at timestamp with time zone null`
- `text_back_detail text null`
- `to_e164 varchar(32)`

References:

- public.sms_contacts (contact_id → id)
- public.sms_numbers (number_id → id)

Indexes:

- `CREATE INDEX ix_sms_calls_contact_id ON public.sms_calls USING btree (contact_id)`
- `CREATE INDEX ix_sms_calls_from_text_back ON public.sms_calls USING btree (from_e164, text_back_at)`
- `CREATE INDEX ix_sms_calls_number_id ON public.sms_calls USING btree (number_id)`
- `CREATE INDEX ix_sms_calls_started_at ON public.sms_calls USING btree (started_at)`
- `CREATE UNIQUE INDEX pk_sms_calls ON public.sms_calls USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_calls_call_id ON public.sms_calls USING btree (call_id)`

## public.sms_contacts (table)

- `basis varchar(16)`
- `basis_detail text null`
- `booking_link text null`
- `carrier varchar(128) null`
- `company_id integer null`
- `created_at timestamp with time zone = now()`
- `e164 varchar(16)`
- `email text null`
- `ended_at timestamp with time zone null`
- `enrolled_at timestamp with time zone null`
- `id integer = nextval('sms_contacts_id_seq'::regclass)`
- `imessage boolean null`
- `line_type varchar(16) = 'unknown'::character varying`
- `looked_up_at timestamp with time zone null`
- `lookup jsonb null`
- `name text null`
- `niche varchar(32) null`
- `number_id uuid null`
- `paid_at timestamp with time zone null`
- `paid_cents integer null`
- `person_id integer null`
- `read_at timestamp with time zone null`
- `sequence varchar(64) null`
- `source_document_id integer null`
- `source_kind varchar(16)`
- `source_ref varchar(64) null`
- `source_url text null`
- `state varchar(16) = 'new'::character varying`
- `state_reason text null`
- `zone varchar(64) null`

References:

- public.companies (company_id → id)
- public.documents (source_document_id → id)
- public.people (person_id → id)
- public.sms_numbers (number_id → id)

Indexes:

- `CREATE INDEX ix_sms_contacts_company_id ON public.sms_contacts USING btree (company_id)`
- `CREATE INDEX ix_sms_contacts_number_id ON public.sms_contacts USING btree (number_id)`
- `CREATE INDEX ix_sms_contacts_person_id ON public.sms_contacts USING btree (person_id)`
- `CREATE INDEX ix_sms_contacts_source_document_id ON public.sms_contacts USING btree (source_document_id)`
- `CREATE INDEX ix_sms_contacts_state ON public.sms_contacts USING btree (state)`
- `CREATE UNIQUE INDEX pk_sms_contacts ON public.sms_contacts USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_contacts_e164_company ON public.sms_contacts USING btree (e164, company_id)`
- `CREATE UNIQUE INDEX uq_sms_contacts_enrolled_e164 ON public.sms_contacts USING btree (e164) WHERE ((state)::text = 'enrolled'::text)`
- `CREATE UNIQUE INDEX uq_sms_contacts_source_ref ON public.sms_contacts USING btree (source_kind, source_ref)`

## public.sms_events (table)

- `id integer = nextval('sms_events_id_seq'::regclass)`
- `outcome text null`
- `payload jsonb`
- `provider varchar(16)`
- `provider_event_id varchar(64)`
- `received_at timestamp with time zone = now()`
- `type varchar(64)`

Indexes:

- `CREATE UNIQUE INDEX pk_sms_events ON public.sms_events USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_events_provider_event ON public.sms_events USING btree (provider, provider_event_id)`

## public.sms_messages (table)

- `attempted_at timestamp with time zone null`
- `body text`
- `classification jsonb null`
- `contact_id integer`
- `cost_usd double precision null`
- `created_at timestamp with time zone = now()`
- `delivered_at timestamp with time zone null`
- `detail text null`
- `direction varchar(4)`
- `disposition varchar(16) null`
- `disposition_source varchar(16) null`
- `due_at timestamp with time zone null`
- `error_code varchar(32) null`
- `from_e164 varchar(16) null`
- `id integer = nextval('sms_messages_id_seq'::regclass)`
- `kind varchar(16)`
- `number_id uuid null`
- `parts smallint null`
- `provenance jsonb null`
- `provider_id varchar(64) null`
- `received_at timestamp with time zone null`
- `ref varchar(64) null`
- `run_id uuid null`
- `sent_at timestamp with time zone null`
- `service varchar(8) null`
- `state varchar(16)`
- `step smallint null`
- `template varchar(64) null`
- `template_version varchar(12) null`
- `to_e164 varchar(16)`

References:

- public.runs (run_id → id)
- public.sms_contacts (contact_id → id)
- public.sms_numbers (number_id → id)

Indexes:

- `CREATE INDEX ix_sms_messages_contact_id ON public.sms_messages USING btree (contact_id)`
- `CREATE INDEX ix_sms_messages_in ON public.sms_messages USING btree (contact_id, received_at DESC NULLS LAST) WHERE ((direction)::text = 'in'::text)`
- `CREATE INDEX ix_sms_messages_number_attempted ON public.sms_messages USING btree (number_id, attempted_at)`
- `CREATE INDEX ix_sms_messages_run_id ON public.sms_messages USING btree (run_id)`
- `CREATE INDEX ix_sms_messages_state_due ON public.sms_messages USING btree (state, due_at)`
- `CREATE UNIQUE INDEX pk_sms_messages ON public.sms_messages USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_messages_answer_ref ON public.sms_messages USING btree (contact_id, ref) WHERE ((kind)::text = ANY (ARRAY['text_back'::text, 'review'::text]))`
- `CREATE UNIQUE INDEX uq_sms_messages_broadcast_ref ON public.sms_messages USING btree (contact_id, ref) WHERE ((kind)::text = 'broadcast'::text)`
- `CREATE UNIQUE INDEX uq_sms_messages_contact_step ON public.sms_messages USING btree (contact_id, step) WHERE ((kind)::text = 'sequence'::text)`
- `CREATE UNIQUE INDEX uq_sms_messages_follow_up_ref ON public.sms_messages USING btree (contact_id, ref) WHERE ((kind)::text = 'follow_up'::text)`
- `CREATE UNIQUE INDEX uq_sms_messages_provider_id ON public.sms_messages USING btree (provider_id)`
- `CREATE UNIQUE INDEX uq_sms_messages_reminder_ref ON public.sms_messages USING btree (template, ref) WHERE ((kind)::text = 'reminder'::text)`

## public.sms_numbers (table)

- `country varchar(2) = 'US'::character varying`
- `created_at timestamp with time zone = now()`
- `e164 varchar(16)`
- `id uuid = gen_random_uuid()`
- `paused_at timestamp with time zone null`
- `paused_reason text null`
- `provider varchar(16)`
- `provider_id varchar(64) null`
- `ramp_started_on date`
- `registered_at timestamp with time zone null`
- `retired_at timestamp with time zone null`
- `state varchar(16) = 'active'::character varying`

Indexes:

- `CREATE UNIQUE INDEX pk_sms_numbers ON public.sms_numbers USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_numbers_e164 ON public.sms_numbers USING btree (e164)`

## public.sms_push_subscriptions (table)

- `auth text`
- `created_at timestamp with time zone = now()`
- `endpoint text`
- `id uuid = gen_random_uuid()`
- `last_pushed_at timestamp with time zone null`
- `operator varchar(200)`
- `p256dh text`

References:

- public.operators (operator → email)

Indexes:

- `CREATE INDEX ix_sms_push_subscriptions_operator ON public.sms_push_subscriptions USING btree (operator)`
- `CREATE UNIQUE INDEX pk_sms_push_subscriptions ON public.sms_push_subscriptions USING btree (id)`
- `CREATE UNIQUE INDEX uq_sms_push_subscriptions_endpoint ON public.sms_push_subscriptions USING btree (endpoint)`

## public.snippets (table)

- `body text`
- `channel varchar(16) null`
- `created_at timestamp with time zone = now()`
- `created_by varchar(200)`
- `id integer = nextval('snippets_id_seq'::regclass)`
- `tags text[] = '{}'::text[]`
- `title varchar(500)`
- `updated_at timestamp with time zone = now()`
- `workspace varchar(64)`

Indexes:

- `CREATE INDEX ix_snippets_workspace ON public.snippets USING btree (workspace, title)`
- `CREATE UNIQUE INDEX pk_snippets ON public.snippets USING btree (id)`

## public.social_activity (table)

- `actor text null`
- `actor_url text null`
- `at timestamp with time zone`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('social_activity_id_seq'::regclass)`
- `kind varchar(16)`
- `platform varchar(16)`
- `raw jsonb`
- `ref varchar(200)`
- `state varchar(8) = 'new'::character varying`
- `text text`
- `url text null`

Indexes:

- `CREATE INDEX ix_social_activity_platform_at ON public.social_activity USING btree (platform, at)`
- `CREATE INDEX ix_social_activity_state ON public.social_activity USING btree (state)`
- `CREATE UNIQUE INDEX pk_social_activity ON public.social_activity USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_activity_platform_ref ON public.social_activity USING btree (platform, ref)`

## public.social_connections (table)

- `account_id integer`
- `by varchar(320)`
- `checked_at timestamp with time zone null`
- `client varchar(64)`
- `connected_at timestamp with time zone = now()`
- `expires_at timestamp with time zone null`
- `external_id varchar(128)`
- `extra jsonb = '{}'::jsonb`
- `handle varchar(120) null`
- `id integer = nextval('social_connections_id_seq'::regclass)`
- `name text null`
- `platform varchar(16)`
- `scopes text`
- `state varchar(12) = 'connected'::character varying`
- `token_ref varchar(64)`
- `why text null`

References:

- public.client_accounts (account_id → id)

Indexes:

- `CREATE INDEX ix_social_connections_account ON public.social_connections USING btree (account_id)`
- `CREATE UNIQUE INDEX pk_social_connections ON public.social_connections USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_connections_account ON public.social_connections USING btree (client, platform, external_id)`

## public.social_days (table)

- `created_at timestamp with time zone = now()`
- `day date`
- `followers integer`
- `platform varchar(16)`
- `raw jsonb`

Indexes:

- `CREATE UNIQUE INDEX pk_social_days ON public.social_days USING btree (platform, day)`

## public.social_grants (table)

- `by varchar(320)`
- `client varchar(64)`
- `created_at timestamp with time zone = now()`
- `expires_at timestamp with time zone`
- `platform varchar(16)`
- `state varchar(64)`
- `used_at timestamp with time zone null`
- `verifier varchar(128) null`

Indexes:

- `CREATE INDEX ix_social_grants_client ON public.social_grants USING btree (client)`
- `CREATE UNIQUE INDEX pk_social_grants ON public.social_grants USING btree (state)`

## public.social_groups (table)

- `about jsonb null`
- `created_at timestamp with time zone = now()`
- `error text null`
- `hit jsonb`
- `id integer = nextval('social_groups_id_seq'::regclass)`
- `keyword text`
- `name text null`
- `network varchar(16)`
- `niche varchar(32)`
- `read_at timestamp with time zone null`
- `ref varchar(100)`
- `url text`

References:

- public.platform_objects (network → platform, ref → ref)

Indexes:

- `CREATE INDEX ix_social_groups_niche_read ON public.social_groups USING btree (niche, read_at)`
- `CREATE UNIQUE INDEX pk_social_groups ON public.social_groups USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_groups_ref ON public.social_groups USING btree (network, ref)`

## public.social_handles (table)

- `created_at timestamp with time zone = now()`
- `handle varchar(200)`
- `id integer = nextval('social_handles_id_seq'::regclass)`
- `lead_id integer null`
- `linked_at timestamp with time zone null`
- `linked_by varchar(16) null`
- `name text null`
- `person_id integer null`
- `platform varchar(16)`
- `url text null`

References:

- public.leads (lead_id → id)
- public.people (person_id → id)

Indexes:

- `CREATE INDEX ix_social_handles_lead_id ON public.social_handles USING btree (lead_id)`
- `CREATE INDEX ix_social_handles_person_id ON public.social_handles USING btree (person_id)`
- `CREATE UNIQUE INDEX pk_social_handles ON public.social_handles USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_handles_platform_handle ON public.social_handles USING btree (platform, handle)`

## public.social_posts (table)

- `author text null`
- `company_id integer null`
- `created_at timestamp with time zone = now()`
- `error text null`
- `group_id integer`
- `id integer = nextval('social_posts_id_seq'::regclass)`
- `mapped_by varchar(16) null`
- `network varchar(16)`
- `person_id integer null`
- `posted text null`
- `raw jsonb`
- `read_at timestamp with time zone null`
- `ref varchar(32)`
- `text text null`
- `url text`

References:

- public.companies (company_id → id)
- public.people (person_id → id)
- public.platform_objects (network → platform, ref → ref)
- public.social_groups (group_id → id)

Indexes:

- `CREATE INDEX ix_social_posts_company_id ON public.social_posts USING btree (company_id)`
- `CREATE INDEX ix_social_posts_group_id ON public.social_posts USING btree (group_id)`
- `CREATE INDEX ix_social_posts_person_id ON public.social_posts USING btree (person_id)`
- `CREATE INDEX ix_social_posts_read_at ON public.social_posts USING btree (read_at)`
- `CREATE UNIQUE INDEX pk_social_posts ON public.social_posts USING btree (id)`
- `CREATE UNIQUE INDEX uq_social_posts_ref ON public.social_posts USING btree (network, ref)`

## public.social_searches (table)

- `answer jsonb`
- `groups integer`
- `id integer = nextval('social_searches_id_seq'::regclass)`
- `keyword text`
- `n integer`
- `network varchar(16)`
- `niche varchar(32)`
- `searched_at timestamp with time zone = now()`

Indexes:

- `CREATE INDEX ix_social_searches_keyword ON public.social_searches USING btree (network, niche, keyword, searched_at)`
- `CREATE UNIQUE INDEX pk_social_searches ON public.social_searches USING btree (id)`

## public.speed_runs (table)

- `booked_at timestamp with time zone null`
- `call varchar(16) null`
- `call_at timestamp with time zone null`
- `call_detail text null`
- `call_done_at timestamp with time zone null`
- `call_done_by text null`
- `call_outcome varchar(16) null`
- `consent boolean`
- `consent_detail text null`
- `created_at timestamp with time zone = now()`
- `e164 varchar(16) null`
- `email text null`
- `email_at timestamp with time zone null`
- `email_detail text null`
- `first_due_at timestamp with time zone null`
- `first_touch varchar(16)`
- `first_touch_at timestamp with time zone null`
- `first_touch_detail text null`
- `id integer = nextval('speed_runs_id_seq'::regclass)`
- `lead_at timestamp with time zone`
- `name text null`
- `notice_at timestamp with time zone null`
- `phone varchar(64) null`
- `sms_contact_id integer null`
- `source text null`
- `subject varchar(200)`
- `workflow varchar(64)`
- `zone varchar(64) null`

References:

- public.sms_contacts (sms_contact_id → id)

Indexes:

- `CREATE INDEX ix_speed_runs_lead_at ON public.speed_runs USING btree (lead_at)`
- `CREATE INDEX ix_speed_runs_sms_contact_id ON public.speed_runs USING btree (sms_contact_id)`
- `CREATE UNIQUE INDEX pk_speed_runs ON public.speed_runs USING btree (id)`
- `CREATE UNIQUE INDEX uq_speed_runs_workflow_subject ON public.speed_runs USING btree (workflow, subject)`

## public.studies (table)

- `angles jsonb`
- `created_at timestamp with time zone = now()`
- `drafts jsonb`
- `id integer = nextval('studies_id_seq'::regclass)`
- `niche varchar(64) null`
- `question text`
- `slug varchar(80)`

Indexes:

- `CREATE UNIQUE INDEX pk_studies ON public.studies USING btree (id)`
- `CREATE UNIQUE INDEX uq_studies_slug ON public.studies USING btree (slug)`

## public.study_steps (table)

- `created_at timestamp with time zone = now()`
- `detail jsonb`
- `document_id integer null`
- `id integer = nextval('study_steps_id_seq'::regclass)`
- `key text`
- `outcome varchar(16)`
- `run_id uuid null`
- `step varchar(16)`
- `study_id integer`

References:

- public.documents (document_id → id)
- public.runs (run_id → id)
- public.studies (study_id → id)

Indexes:

- `CREATE INDEX ix_study_steps_document_id ON public.study_steps USING btree (document_id)`
- `CREATE INDEX ix_study_steps_run_id ON public.study_steps USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_study_steps ON public.study_steps USING btree (id)`
- `CREATE UNIQUE INDEX uq_study_steps_unit ON public.study_steps USING btree (study_id, step, key)`

## public.suppression_events (table)

- `created_at timestamp with time zone = now()`
- `evidence jsonb null`
- `id integer = nextval('suppression_events_id_seq'::regclass)`
- `reason varchar(32)`
- `suppression_id integer`

References:

- public.suppressions (suppression_id → id)

Indexes:

- `CREATE INDEX ix_suppression_events_suppression_id ON public.suppression_events USING btree (suppression_id)`
- `CREATE UNIQUE INDEX pk_suppression_events ON public.suppression_events USING btree (id)`

## public.suppressions (table)

- `created_at timestamp with time zone = now()`
- `id integer = nextval('suppressions_id_seq'::regclass)`
- `kind varchar(32)`
- `reason varchar(32)`
- `revoked_at timestamp with time zone null`
- `value varchar(320)`

Indexes:

- `CREATE UNIQUE INDEX pk_suppressions ON public.suppressions USING btree (id)`
- `CREATE UNIQUE INDEX uq_suppressions_kind ON public.suppressions USING btree (kind, value)`

## public.survey_answers (table)

- `at timestamp with time zone = now()`
- `client varchar(40)`
- `id integer = nextval('survey_answers_id_seq'::regclass)`
- `person varchar(200)`
- `survey varchar(60)`
- `value text`

References:

- public.clients (client → id)
- public.surveys (survey → key)

Indexes:

- `CREATE INDEX ix_survey_answers_client ON public.survey_answers USING btree (client)`
- `CREATE UNIQUE INDEX pk_survey_answers ON public.survey_answers USING btree (id)`
- `CREATE UNIQUE INDEX uq_survey_answers_survey_client_person ON public.survey_answers USING btree (survey, client, person)`

## public.survey_days (table)

- `answers integer = 0`
- `channel varchar(40)`
- `day date`
- `survey varchar(60)`
- `synced_at timestamp with time zone = now()`
- `value varchar(80)`

References:

- public.surveys (survey → key)

Indexes:

- `CREATE UNIQUE INDEX pk_survey_days ON public.survey_days USING btree (survey, day, value, channel)`

## public.surveys (table)

- `audience jsonb = '{}'::jsonb`
- `choices text[] = '{}'::text[]`
- `created_at timestamp with time zone = now()`
- `created_by varchar(200)`
- `key varchar(60)`
- `kind varchar(8)`
- `question text`
- `started_at timestamp with time zone null`
- `started_by varchar(200) null`
- `state varchar(8) = 'draft'::character varying`
- `surface varchar(8) = 'site'::character varying`
- `trigger jsonb = '{"on": "view"}'::jsonb`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_surveys ON public.surveys USING btree (key)`

## public.task_blocks (table)

- `at timestamp with time zone = now()`
- `blocked_by uuid`
- `by varchar(200)`
- `task_id uuid`

References:

- public.notes (blocked_by → id; task_id → id)

Indexes:

- `CREATE INDEX ix_task_blocks_blocked_by ON public.task_blocks USING btree (blocked_by)`
- `CREATE UNIQUE INDEX pk_task_blocks ON public.task_blocks USING btree (task_id, blocked_by)`

## public.task_moves (table)

- `assignee varchar(200) null`
- `at timestamp with time zone = now()`
- `by varchar(200)`
- `from_column varchar(40) null`
- `id bigint = nextval('task_moves_id_seq'::regclass)`
- `kind varchar(8)`
- `task_id uuid`
- `to_column varchar(40) null`
- `why varchar(3000) null`

References:

- public.notes (task_id → id)

Indexes:

- `CREATE INDEX ix_task_moves_task_at ON public.task_moves USING btree (task_id, at)`
- `CREATE UNIQUE INDEX pk_task_moves ON public.task_moves USING btree (id)`

## public.team_searches (table)

- `company_id integer`
- `kept integer = 0`
- `profiles jsonb`
- `query text`
- `retry_at timestamp with time zone null`
- `run_id uuid null`
- `searched_at timestamp with time zone = now()`
- `state varchar(16)`

References:

- public.companies (company_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_team_searches_run_id ON public.team_searches USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_team_searches ON public.team_searches USING btree (company_id)`

## public.template_stats (view)

- `booked bigint null`
- `kind text null`
- `last_sent timestamp with time zone null`
- `picks jsonb null`
- `replies bigint null`
- `sends bigint null`
- `system text null`
- `template text null`
- `template_id integer null`
- `version text null`

## public.template_versions (table)

- `created_at timestamp with time zone = now()`
- `created_by varchar(200) null`
- `default_hash varchar(64) null`
- `id integer = nextval('template_versions_id_seq'::regclass)`
- `niche varchar(32)`
- `number integer`
- `opened_from integer null`
- `origin varchar(16) = 'edit'::character varying`
- `published_at timestamp with time zone null`
- `published_by varchar(200) null`
- `source text`
- `template varchar(64)`
- `template_id integer`
- `version varchar(12)`
- `why text null`

References:

- public.template_versions (opened_from → id)
- public.templates (template_id → id)

Indexes:

- `CREATE INDEX ix_template_versions_niche ON public.template_versions USING btree (niche, template, version)`
- `CREATE INDEX ix_template_versions_opened_from ON public.template_versions USING btree (opened_from) WHERE (opened_from IS NOT NULL)`
- `CREATE UNIQUE INDEX pk_template_versions ON public.template_versions USING btree (id)`
- `CREATE UNIQUE INDEX uq_template_versions_template_id_number ON public.template_versions USING btree (template_id, number)`

## public.templates (table)

- `created_at timestamp with time zone = now()`
- `draft_version_id integer null`
- `folder text = ''::text`
- `follows_default boolean = false`
- `id integer = nextval('templates_id_seq'::regclass)`
- `kind varchar(16)`
- `live_version_id integer null`
- `name varchar(64)`
- `system varchar(32)`
- `updated_at timestamp with time zone = now()`
- `waiting_by varchar(200) null`
- `waiting_version_id integer null`
- `why text null`

References:

- public.template_versions (draft_version_id → id; live_version_id → id; waiting_version_id → id)

Indexes:

- `CREATE INDEX ix_templates_draft_version_id ON public.templates USING btree (draft_version_id)`
- `CREATE INDEX ix_templates_live_version_id ON public.templates USING btree (live_version_id)`
- `CREATE INDEX ix_templates_waiting_version_id ON public.templates USING btree (waiting_version_id)`
- `CREATE UNIQUE INDEX pk_templates ON public.templates USING btree (id)`
- `CREATE UNIQUE INDEX uq_templates_kind_system_name ON public.templates USING btree (kind, system, name)`

## public.thread_events (table)

- `body_text text null`
- `bounce_class varchar(32) null`
- `classification jsonb null`
- `classified_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `detail text null`
- `disposition varchar(32) null`
- `disposition_source varchar(32) null`
- `enrollment_id integer`
- `from_address varchar(320) null`
- `gmail_id varchar(64) null`
- `gmail_thread_id varchar(64) null`
- `headers jsonb null`
- `id integer = nextval('thread_events_id_seq'::regclass)`
- `in_reply_to_message_id integer null`
- `kind varchar(32)`
- `received_at timestamp with time zone`
- `run_id uuid null`
- `snippet text null`
- `subject text null`

References:

- public.enrollments (enrollment_id → id)
- public.messages (in_reply_to_message_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_thread_events_enrollment_id ON public.thread_events USING btree (enrollment_id)`
- `CREATE INDEX ix_thread_events_in_reply_to_message_id ON public.thread_events USING btree (in_reply_to_message_id)`
- `CREATE INDEX ix_thread_events_run_id ON public.thread_events USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_thread_events ON public.thread_events USING btree (id)`
- `CREATE UNIQUE INDEX uq_thread_events_gmail_id ON public.thread_events USING btree (gmail_id) WHERE (gmail_id IS NOT NULL)`

## public.topics (table)

- `cadence varchar(64)`
- `channel varchar(16)`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('topics_id_seq'::regclass)`
- `keyword varchar(32) null`
- `line text`
- `name varchar(64)`
- `public boolean = false`
- `public_name varchar(120)`

Indexes:

- `CREATE UNIQUE INDEX pk_topics ON public.topics USING btree (id)`
- `CREATE UNIQUE INDEX uq_topics_keyword ON public.topics USING btree (keyword)`
- `CREATE UNIQUE INDEX uq_topics_name ON public.topics USING btree (name)`

## public.touches (table)

- `account varchar(120) null`
- `answers integer null`
- `at timestamp with time zone`
- `created_at timestamp with time zone = now()`
- `direction varchar(8)`
- `external_id varchar(200) null`
- `handle_id integer`
- `id integer = nextval('touches_id_seq'::regclass)`
- `kind varchar(16)`
- `link text null`
- `ref varchar(200)`
- `response varchar(16) null`
- `response_at timestamp with time zone null`
- `source varchar(32)`
- `text text null`
- `url text null`

References:

- public.social_handles (handle_id → id)
- public.touches (answers → id)

Indexes:

- `CREATE INDEX ix_touches_answers ON public.touches USING btree (answers)`
- `CREATE INDEX ix_touches_external_id ON public.touches USING btree (external_id) WHERE (external_id IS NOT NULL)`
- `CREATE INDEX ix_touches_handle_id_at ON public.touches USING btree (handle_id, at)`
- `CREATE UNIQUE INDEX pk_touches ON public.touches USING btree (id)`
- `CREATE UNIQUE INDEX uq_touches_ref ON public.touches USING btree (ref)`

## public.unit_holds (table)

- `held_at timestamp with time zone = now()`
- `id integer = nextval('unit_holds_id_seq'::regclass)`
- `reason text`
- `released_at timestamp with time zone null`
- `released_by varchar(320) null`
- `stage varchar(64)`
- `subject varchar(200)`
- `tries integer = 1`
- `until timestamp with time zone`

Indexes:

- `CREATE UNIQUE INDEX pk_unit_holds ON public.unit_holds USING btree (id)`
- `CREATE UNIQUE INDEX uq_unit_holds_stage_subject ON public.unit_holds USING btree (stage, subject)`

## public.unit_holds_now (view)

- `held_at timestamp with time zone null`
- `id integer null`
- `reason text null`
- `released_at timestamp with time zone null`
- `released_by varchar(320) null`
- `stage varchar(64) null`
- `state text null`
- `subject varchar(200) null`
- `title text null`
- `tries integer null`
- `until timestamp with time zone null`

## public.vault_keys (table)

- `account varchar(64)`
- `address varchar(160)`
- `key_id varchar(12)`
- `last_used_at timestamp with time zone null`
- `made_at timestamp with time zone`
- `owner varchar(80)`
- `purposes text[] = '{}'::text[]`
- `read_at timestamp with time zone`
- `revoked_at timestamp with time zone null`
- `site varchar(64)`
- `spent_until timestamp with time zone null`
- `status varchar(8)`
- `uses integer = 0`
- `vendor_id varchar(160) null`
- `via varchar(160) null`

Indexes:

- `CREATE INDEX ix_vault_keys_key_id ON public.vault_keys USING btree (key_id)`
- `CREATE UNIQUE INDEX pk_vault_keys ON public.vault_keys USING btree (address)`

## public.vendor_modes (table)

- `cap_cents integer = 0`
- `client varchar(40) null`
- `id integer = nextval('vendor_modes_id_seq'::regclass)`
- `key_name varchar(200) null`
- `mode varchar(8)`
- `per_day integer = 0`
- `purpose varchar(32) = 'default'::character varying`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(320)`
- `vendor varchar(32)`

References:

- public.clients (client → id)

Indexes:

- `CREATE UNIQUE INDEX pk_vendor_modes ON public.vendor_modes USING btree (id)`
- `CREATE UNIQUE INDEX uq_vendor_modes_owner ON public.vendor_modes USING btree (client, vendor, purpose) NULLS NOT DISTINCT`

## public.vendor_usage (table)

- `at timestamp with time zone = now()`
- `bucket varchar(80)`
- `client varchar(40) null`
- `id bigint = nextval('vendor_usage_id_seq'::regclass)`
- `key_id varchar(12) null`
- `micros bigint`
- `mode varchar(8)`
- `part varchar(64) null`
- `run_id uuid null`
- `units integer`
- `vendor varchar(32)`

Indexes:

- `CREATE INDEX ix_vendor_usage_bucket ON public.vendor_usage USING btree (bucket, at)`
- `CREATE INDEX ix_vendor_usage_key ON public.vendor_usage USING btree (key_id, at)`
- `CREATE INDEX ix_vendor_usage_owner ON public.vendor_usage USING btree (client, vendor, at)`
- `CREATE UNIQUE INDEX pk_vendor_usage ON public.vendor_usage USING btree (id)`

## public.verification_yield (view)

- `candidates bigint null`
- `catch_all bigint null`
- `evidence varchar(32) null`
- `invalid bigint null`
- `niche varchar(32) null`
- `risky bigint null`
- `valid bigint null`
- `valid_rate_pct numeric null`
- `verified bigint null`

## public.verifications (table)

- `checked_at timestamp with time zone = now()`
- `contact_candidate_id integer null`
- `email varchar(320)`
- `id integer = nextval('verifications_id_seq'::regclass)`
- `lead_id integer null`
- `raw jsonb`
- `result varchar(32)`
- `verifier varchar(64)`

References:

- public.contact_candidates (contact_candidate_id → id)
- public.leads (lead_id → id)

Indexes:

- `CREATE INDEX ix_verifications_contact_candidate_id ON public.verifications USING btree (contact_candidate_id)`
- `CREATE INDEX ix_verifications_email_checked_at_id ON public.verifications USING btree (email, checked_at DESC NULLS LAST, id DESC NULLS LAST)`
- `CREATE INDEX ix_verifications_email_domain ON public.verifications USING btree (split_part((email)::text, '@'::text, 2))`
- `CREATE INDEX ix_verifications_lead_id ON public.verifications USING btree (lead_id)`
- `CREATE UNIQUE INDEX pk_verifications ON public.verifications USING btree (id)`

## public.video_edits (table)

- `captions jsonb = '{"on": true, "style": "word"}'::jsonb`
- `chapters jsonb = '[]'::jsonb`
- `created_at timestamp with time zone = now()`
- `crops jsonb = '{}'::jsonb`
- `cuts jsonb = '[]'::jsonb`
- `description text = ''::text`
- `dir text`
- `files jsonb = '{}'::jsonb`
- `formats jsonb = '["long"]'::jsonb`
- `id integer = nextval('video_edits_id_seq'::regclass)`
- `keys jsonb = '{}'::jsonb`
- `layout jsonb = '[]'::jsonb`
- `locked jsonb = '[]'::jsonb`
- `looks jsonb = '{}'::jsonb`
- `music jsonb null`
- `overlays jsonb = '[]'::jsonb`
- `render jsonb null`
- `script jsonb null`
- `short_cuts jsonb = '[]'::jsonb`
- `shorts jsonb = '[]'::jsonb`
- `sounds jsonb = '[]'::jsonb`
- `state varchar(16) = 'added'::character varying`
- `stress jsonb = '[]'::jsonb`
- `tags jsonb = '[]'::jsonb`
- `thumbnail jsonb null`
- `title text = ''::text`
- `tracks jsonb`
- `updated_at timestamp with time zone = now()`
- `words jsonb = '[]'::jsonb`

Indexes:

- `CREATE UNIQUE INDEX pk_video_edits ON public.video_edits USING btree (id)`

## public.viewer_prefs (table)

- `key varchar(100)`
- `updated_at timestamp with time zone = now()`
- `value jsonb`
- `viewer varchar(200)`
- `workspace varchar(64)`

Indexes:

- `CREATE UNIQUE INDEX pk_viewer_prefs ON public.viewer_prefs USING btree (workspace, viewer, key)`

## public.voice_call_records (view)

- `by text null`
- `direction text null`
- `heard integer null`
- `id integer null`
- `message text null`
- `number text null`
- `outcome text null`
- `pipeline text null`
- `seconds integer null`
- `started timestamp with time zone null`
- `turns integer null`
- `who text null`
- `whose text null`

## public.voice_calls (table)

- `booking_id integer null`
- `by varchar(320) null`
- `created_at timestamp with time zone = now()`
- `direction varchar(16)`
- `ended_at timestamp with time zone`
- `from_number varchar(32) = ''::character varying`
- `id integer = nextval('voice_calls_id_seq'::regclass)`
- `lead_name text null`
- `message text null`
- `outcome varchar(16)`
- `pipeline varchar(200)`
- `recording_key text null`
- `ref varchar(200)`
- `sms_contact_id integer null`
- `started_at timestamp with time zone`
- `to_number varchar(32) = ''::character varying`
- `transcript jsonb = '[]'::jsonb`
- `whose varchar(64) = 'wren'::character varying`

References:

- public.sms_contacts (sms_contact_id → id)

Indexes:

- `CREATE INDEX ix_voice_calls_booking_id ON public.voice_calls USING btree (booking_id)`
- `CREATE INDEX ix_voice_calls_sms_contact_id ON public.voice_calls USING btree (sms_contact_id)`
- `CREATE INDEX ix_voice_calls_started_at ON public.voice_calls USING btree (started_at)`
- `CREATE UNIQUE INDEX pk_voice_calls ON public.voice_calls USING btree (id)`

## public.voice_latency (view)

- `id text null`
- `last timestamp with time zone null`
- `p50 integer null`
- `p95 integer null`
- `pipeline text null`
- `rank integer null`
- `stage text null`
- `turns integer null`

## public.voice_turns (table)

- `agent text = ''::text`
- `at timestamp with time zone = now()`
- `audio_ms integer null`
- `barged boolean = false`
- `call_id integer`
- `caller text = ''::text`
- `end_ms integer null`
- `final_ms integer null`
- `heard_ms integer null`
- `id integer = nextval('voice_turns_id_seq'::regclass)`
- `n integer`
- `pipeline varchar(200)`
- `speculative boolean = false`
- `token_ms integer null`
- `tools jsonb = '[]'::jsonb`

References:

- public.voice_calls (call_id → id)

Indexes:

- `CREATE INDEX ix_voice_turns_at ON public.voice_turns USING btree (at)`
- `CREATE UNIQUE INDEX pk_voice_turns ON public.voice_turns USING btree (id)`
- `CREATE UNIQUE INDEX uq_voice_turns_call_id_n ON public.voice_turns USING btree (call_id, n)`

## public.webhook_attempts (table)

- `at timestamp with time zone = now()`
- `delivery uuid`
- `error text null`
- `id integer = nextval('webhook_attempts_id_seq'::regclass)`
- `latency_ms integer`
- `n integer`
- `response text null`
- `status integer null`

References:

- public.webhook_deliveries (delivery → id)

Indexes:

- `CREATE INDEX ix_webhook_attempts_delivery ON public.webhook_attempts USING btree (delivery, n)`
- `CREATE UNIQUE INDEX pk_webhook_attempts ON public.webhook_attempts USING btree (id)`

## public.webhook_deliveries (table)

- `at timestamp with time zone = now()`
- `attempts integer = 0`
- `error text null`
- `event varchar(40)`
- `event_id varchar(80)`
- `id uuid = gen_random_uuid()`
- `last_at timestamp with time zone null`
- `latency_ms integer null`
- `next_at timestamp with time zone null`
- `payload jsonb`
- `response text null`
- `state varchar(12) = 'pending'::character varying`
- `status integer null`
- `subscription uuid`

References:

- public.webhook_subscriptions (subscription → id)

Indexes:

- `CREATE INDEX ix_webhook_deliveries_subscription_at ON public.webhook_deliveries USING btree (subscription, at)`
- `CREATE UNIQUE INDEX pk_webhook_deliveries ON public.webhook_deliveries USING btree (id)`
- `CREATE UNIQUE INDEX uq_webhook_deliveries_event ON public.webhook_deliveries USING btree (subscription, event_id)`

## public.webhook_subscriptions (table)

- `active boolean = true`
- `at timestamp with time zone = now()`
- `by text`
- `client varchar(40) null`
- `disabled_at timestamp with time zone null`
- `disabled_why text null`
- `events text[]`
- `failing_since timestamp with time zone null`
- `id uuid = gen_random_uuid()`
- `name text`
- `prev_secret text null`
- `prev_until timestamp with time zone null`
- `rotated_at timestamp with time zone null`
- `secret text`
- `url text`

References:

- public.clients (client → id)

Indexes:

- `CREATE INDEX ix_webhook_subscriptions_client ON public.webhook_subscriptions USING btree (client)`
- `CREATE UNIQUE INDEX pk_webhook_subscriptions ON public.webhook_subscriptions USING btree (id)`

## public.workflow_installs (table)

- `applied jsonb`
- `approved_at timestamp with time zone null`
- `approved_by text null`
- `asked_at timestamp with time zone null`
- `asked_by text null`
- `at timestamp with time zone = now()`
- `by text`
- `client varchar(40)`
- `hook uuid null`
- `id integer = nextval('workflow_installs_id_seq'::regclass)`
- `removed_at timestamp with time zone null`
- `removed_by text null`
- `state varchar(16) = 'draft'::character varying`
- `template varchar(64)`
- `version varchar(16)`
- `workflow varchar(64)`

References:

- public.clients (client → id)
- public.hooks (hook → id)

Indexes:

- `CREATE INDEX ix_workflow_installs_hook ON public.workflow_installs USING btree (hook)`
- `CREATE UNIQUE INDEX pk_workflow_installs ON public.workflow_installs USING btree (id)`
- `CREATE UNIQUE INDEX uq_workflow_installs_client_template ON public.workflow_installs USING btree (client, template)`

## public.workflow_saves (table)

- `at timestamp with time zone = now()`
- `by text`
- `client varchar(40) null`
- `edits jsonb null`
- `id integer = nextval('workflow_saves_id_seq'::regclass)`
- `live boolean = true`
- `workflow varchar(64)`

References:

- public.clients (client → id)

Indexes:

- `CREATE INDEX ix_workflow_saves_client_workflow ON public.workflow_saves USING btree (client, workflow, id)`
- `CREATE UNIQUE INDEX pk_workflow_saves ON public.workflow_saves USING btree (id)`

## public.workflow_templates (table)

- `at timestamp with time zone = now()`
- `blurb text = ''::text`
- `by text`
- `edits jsonb null`
- `from_client varchar(40) null`
- `id varchar(64)`
- `name varchar(1200)`
- `workflow varchar(64)`

References:

- public.clients (from_client → id)

Indexes:

- `CREATE INDEX ix_workflow_templates_from_client ON public.workflow_templates USING btree (from_client)`
- `CREATE UNIQUE INDEX pk_workflow_templates ON public.workflow_templates USING btree (id)`

## public.wren_settings (table)

- `component varchar(64)`
- `settings jsonb = '{}'::jsonb`
- `updated_at timestamp with time zone = now()`
- `updated_by varchar(320) null`

Indexes:

- `CREATE UNIQUE INDEX pk_wren_settings ON public.wren_settings USING btree (component)`
