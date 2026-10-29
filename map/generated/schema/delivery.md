# delivery: schema

Tables and views: 25.

## delivery.access_requests (table)

- `answered_at timestamp with time zone null`
- `answered_by text null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `engagement_id integer`
- `id integer = nextval('delivery.access_requests_id_seq'::regclass)`
- `note text null`
- `revoke text`
- `scope text`
- `status varchar(16) = 'open'::character varying`
- `system text`
- `why text`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE INDEX ix_access_requests_engagement ON delivery.access_requests USING btree (engagement_id)`
- `CREATE UNIQUE INDEX pk_access_requests ON delivery.access_requests USING btree (id)`

## delivery.agreements (table)

- `body text`
- `engagement_id integer`
- `id integer = nextval('delivery.agreements_id_seq'::regclass)`
- `issued_at timestamp with time zone = now()`
- `issued_by text`
- `mailed_at timestamp with time zone null`
- `sha256 varchar(64)`
- `signed_agent text null`
- `signed_at timestamp with time zone null`
- `signed_ip text null`
- `signer_email text null`
- `signer_name text null`
- `signer_title text null`
- `terms jsonb`
- `terms_version integer null`
- `version varchar(16)`

References:

- delivery.engagements (engagement_id → id)
- pipeline.terms_versions (terms_version → id)

Indexes:

- `CREATE INDEX ix_agreements_terms_version ON delivery.agreements USING btree (terms_version)`
- `CREATE UNIQUE INDEX pk_agreements ON delivery.agreements USING btree (id)`
- `CREATE UNIQUE INDEX uq_agreements_engagement ON delivery.agreements USING btree (engagement_id)`

## delivery.asks (table)

- `answer text null`
- `answered_at timestamp with time zone null`
- `answered_by text null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `due_on date null`
- `engagement_id integer`
- `file_key text null`
- `id integer = nextval('delivery.asks_id_seq'::regclass)`
- `milestone_id integer null`
- `text text`

References:

- delivery.engagements (engagement_id → id)
- delivery.milestones (milestone_id → id)

Indexes:

- `CREATE INDEX ix_asks_engagement ON delivery.asks USING btree (engagement_id)`
- `CREATE INDEX ix_asks_milestone ON delivery.asks USING btree (milestone_id)`
- `CREATE UNIQUE INDEX pk_asks ON delivery.asks USING btree (id)`

## delivery.comments (table)

- `author text`
- `body text`
- `created_at timestamp with time zone = now()`
- `deliverable_id integer null`
- `engagement_id integer`
- `from_wren boolean`
- `id integer = nextval('delivery.comments_id_seq'::regclass)`
- `update_id integer null`

References:

- delivery.deliverables (deliverable_id → id)
- delivery.engagements (engagement_id → id)
- delivery.updates (update_id → id)

Indexes:

- `CREATE INDEX ix_comments_deliverable ON delivery.comments USING btree (deliverable_id)`
- `CREATE INDEX ix_comments_engagement ON delivery.comments USING btree (engagement_id, created_at)`
- `CREATE INDEX ix_comments_update ON delivery.comments USING btree (update_id)`
- `CREATE UNIQUE INDEX pk_comments ON delivery.comments USING btree (id)`

## delivery.console_flags (view)

- `addressed timestamp with time zone null`
- `addressed_by text null`
- `cleared timestamp with time zone null`
- `cleared_by text null`
- `client text null`
- `id integer null`
- `name text null`
- `note text null`
- `owner text null`
- `raised timestamp with time zone null`
- `raised_by text null`
- `side text null`
- `source text null`
- `state text null`
- `urgent text null`
- `what text null`

## delivery.console_health (view)

- `band text null`
- `engagement integer null`
- `engagement_why text null`
- `hand text null`
- `id text null`
- `model integer null`
- `money integer null`
- `money_why text null`
- `name text null`
- `opportunities integer null`
- `override integer null`
- `override_by text null`
- `rated timestamp with time zone null`
- `rating integer null`
- `reason text null`
- `results integer null`
- `results_why text null`
- `risks integer null`
- `score integer null`
- `sentiment integer null`
- `sentiment_why text null`
- `stale integer null`
- `stale_parts text null`
- `updated timestamp with time zone null`
- `weakest text null`
- `weights text null`

## delivery.console_health_days (view)

- `band text null`
- `client text null`
- `day date null`
- `engagement integer null`
- `id text null`
- `model integer null`
- `money integer null`
- `name text null`
- `override integer null`
- `results integer null`
- `score integer null`
- `sentiment integer null`
- `stale_parts text null`
- `visited text null`

## delivery.console_health_inputs (view)

- `age text null`
- `at timestamp with time zone null`
- `client text null`
- `id text null`
- `name text null`
- `part text null`
- `rows text null`
- `value text null`
- `what text null`

## delivery.deliverables (table)

- `created_at timestamp with time zone = now()`
- `created_by text`
- `decided_at timestamp with time zone null`
- `decided_by text null`
- `decision_note text null`
- `engagement_id integer`
- `file_key text null`
- `id integer = nextval('delivery.deliverables_id_seq'::regclass)`
- `kind varchar(8)`
- `milestone_id integer null`
- `previous_id integer null`
- `status varchar(8) = 'waiting'::character varying`
- `title text`
- `url text null`
- `version integer = 1`

References:

- delivery.deliverables (previous_id → id)
- delivery.engagements (engagement_id → id)
- delivery.milestones (milestone_id → id)

Indexes:

- `CREATE INDEX ix_deliverables_engagement ON delivery.deliverables USING btree (engagement_id)`
- `CREATE INDEX ix_deliverables_milestone ON delivery.deliverables USING btree (milestone_id)`
- `CREATE INDEX ix_deliverables_previous ON delivery.deliverables USING btree (previous_id)`
- `CREATE UNIQUE INDEX pk_deliverables ON delivery.deliverables USING btree (id)`

## delivery.engagements (table)

- `client_id varchar(40)`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `ended_on date null`
- `id integer = nextval('delivery.engagements_id_seq'::regclass)`
- `offer_id varchar(64)`
- `source_campaign varchar(120) null`
- `source_channel varchar(16) null`
- `starts_on date`
- `status varchar(16) = 'active'::character varying`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE INDEX ix_engagements_client ON delivery.engagements USING btree (client_id)`
- `CREATE UNIQUE INDEX pk_engagements ON delivery.engagements USING btree (id)`

## delivery.flag_digests (table)

- `at timestamp with time zone = now()`
- `day date`
- `flags integer`

Indexes:

- `CREATE UNIQUE INDEX pk_flag_digests ON delivery.flag_digests USING btree (day)`

## delivery.flags (table)

- `addressed_at timestamp with time zone null`
- `addressed_by text null`
- `cause varchar(80)`
- `clear_fired_at timestamp with time zone null`
- `cleared_at timestamp with time zone null`
- `cleared_by text null`
- `client_id varchar(40)`
- `engagement_id integer null`
- `how text null`
- `id integer = nextval('delivery.flags_id_seq'::regclass)`
- `note text null`
- `once boolean = false`
- `owner text null`
- `raise_fired_at timestamp with time zone null`
- `raised_at timestamp with time zone = now()`
- `raised_by text`
- `remind_days smallint = 7`
- `side varchar(12)`
- `source varchar(12)`
- `told_at timestamp with time zone null`
- `urgent boolean = false`
- `what text`

References:

- delivery.engagements (engagement_id → id)
- public.clients (client_id → id)

Indexes:

- `CREATE INDEX ix_flags_client ON delivery.flags USING btree (client_id, raised_at)`
- `CREATE INDEX ix_flags_engagement ON delivery.flags USING btree (engagement_id)`
- `CREATE INDEX ix_flags_raised ON delivery.flags USING btree (raised_at)`
- `CREATE UNIQUE INDEX pk_flags ON delivery.flags USING btree (id)`
- `CREATE UNIQUE INDEX uq_flags_open ON delivery.flags USING btree (client_id, COALESCE(engagement_id, 0), cause) WHERE (cleared_at IS NULL)`

## delivery.health_days (table)

- `ages jsonb = '{}'::jsonb`
- `at timestamp with time zone = now()`
- `band varchar(8)`
- `client_id varchar(40)`
- `day date`
- `engagement smallint null`
- `inputs jsonb = '[]'::jsonb`
- `money smallint null`
- `override smallint null`
- `results smallint null`
- `score smallint null`
- `sentiment smallint null`
- `stale jsonb = '[]'::jsonb`
- `visited boolean = false`
- `weights jsonb`
- `why jsonb = '{}'::jsonb`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_health_days ON delivery.health_days USING btree (client_id, day)`

## delivery.health_overrides (table)

- `at timestamp with time zone = now()`
- `by text`
- `cleared_at timestamp with time zone null`
- `cleared_by text null`
- `client_id varchar(40)`
- `id integer = nextval('delivery.health_overrides_id_seq'::regclass)`
- `reason text`
- `score smallint`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_health_overrides ON delivery.health_overrides USING btree (id)`
- `CREATE UNIQUE INDEX uq_health_overrides_open ON delivery.health_overrides USING btree (client_id) WHERE (cleared_at IS NULL)`

## delivery.health_ratings (table)

- `at timestamp with time zone = now()`
- `by text`
- `client_id varchar(40)`
- `id integer = nextval('delivery.health_ratings_id_seq'::regclass)`
- `note text null`
- `score smallint`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE INDEX ix_health_ratings_client ON delivery.health_ratings USING btree (client_id, at)`
- `CREATE UNIQUE INDEX pk_health_ratings ON delivery.health_ratings USING btree (id)`

## delivery.interests (table)

- `at timestamp with time zone = now()`
- `email text`
- `engagement_id integer`
- `id integer = nextval('delivery.interests_id_seq'::regclass)`
- `offer_id varchar(64)`
- `told_at timestamp with time zone null`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_interests ON delivery.interests USING btree (id)`
- `CREATE UNIQUE INDEX uq_interests_offer ON delivery.interests USING btree (engagement_id, offer_id, email)`

## delivery.invoices (table)

- `cents integer`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `currency varchar(3) = 'USD'::character varying`
- `description text`
- `dispute varchar(8) null`
- `due_on date`
- `engagement_id integer`
- `id integer = nextval('delivery.invoices_id_seq'::regclass)`
- `issued_on date`
- `lines jsonb = '[]'::jsonb`
- `mailed_at timestamp with time zone null`
- `number varchar(64) = ('WREN-'::text || nextval('delivery.invoice_number'::regclass))`
- `paid_on date null`
- `period varchar(7) null`
- `received_cents integer = 0`
- `refunded_cents integer = 0`
- `reminded_at timestamp with time zone null`
- `setup boolean = false`
- `status varchar(16) = 'open'::character varying`
- `told jsonb = '{}'::jsonb`
- `units integer null`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE INDEX ix_invoices_engagement ON delivery.invoices USING btree (engagement_id)`
- `CREATE UNIQUE INDEX pk_invoices ON delivery.invoices USING btree (id)`
- `CREATE UNIQUE INDEX uq_invoices_number ON delivery.invoices USING btree (number)`

## delivery.member_mail (table)

- `client_id varchar(40)`
- `digest_on date null`
- `email text`
- `level varchar(8) = 'all'::character varying`
- `told_through timestamp with time zone null`

References:

- public.client_members (client_id → client_id, email → email)

Indexes:

- `CREATE UNIQUE INDEX pk_member_mail ON delivery.member_mail USING btree (client_id, email)`

## delivery.milestones (table)

- `done_on date null`
- `due_on date null`
- `engagement_id integer`
- `id integer = nextval('delivery.milestones_id_seq'::regclass)`
- `key varchar(64)`
- `name text`
- `planned_from date`
- `planned_to date null`
- `position integer`
- `promised jsonb = '[]'::jsonb`
- `slip_reason text null`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_milestones ON delivery.milestones USING btree (id)`
- `CREATE UNIQUE INDEX uq_milestones_key ON delivery.milestones USING btree (engagement_id, key)`

## delivery.moments (table)

- `engagement_id integer`
- `mailed_at timestamp with time zone null`
- `moment varchar(80)`
- `reached_on date`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_moments ON delivery.moments USING btree (engagement_id, moment)`

## delivery.pulses (table)

- `at timestamp with time zone = now()`
- `email text`
- `engagement_id integer`
- `id integer = nextval('delivery.pulses_id_seq'::regclass)`
- `note text null`
- `score smallint`
- `week date`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_pulses ON delivery.pulses USING btree (id)`
- `CREATE UNIQUE INDEX uq_pulses_week ON delivery.pulses USING btree (engagement_id, email, week)`

## delivery.results (table)

- `engagement_id integer`
- `key varchar(64)`
- `note text null`
- `updated_at timestamp with time zone = now()`
- `updated_by text`
- `value numeric`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_results ON delivery.results USING btree (engagement_id, key)`

## delivery.reviews (table)

- `at timestamp with time zone = now()`
- `email text`
- `engagement_id integer`
- `id integer = nextval('delivery.reviews_id_seq'::regclass)`
- `may_quote varchar(16) = 'private'::character varying`
- `moment varchar(80)`
- `score smallint null`
- `told_at timestamp with time zone null`
- `words text null`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_reviews ON delivery.reviews USING btree (id)`
- `CREATE UNIQUE INDEX uq_reviews_moment ON delivery.reviews USING btree (engagement_id, moment, email)`

## delivery.updates (table)

- `author text`
- `body text`
- `created_at timestamp with time zone = now()`
- `engagement_id integer`
- `hidden_at timestamp with time zone null`
- `id integer = nextval('delivery.updates_id_seq'::regclass)`
- `internal boolean = false`
- `milestone_id integer null`

References:

- delivery.engagements (engagement_id → id)
- delivery.milestones (milestone_id → id)

Indexes:

- `CREATE INDEX ix_updates_engagement ON delivery.updates USING btree (engagement_id, created_at)`
- `CREATE INDEX ix_updates_milestone ON delivery.updates USING btree (milestone_id)`
- `CREATE UNIQUE INDEX pk_updates ON delivery.updates USING btree (id)`

## delivery.wise_credits (table)

- `at timestamp with time zone`
- `balance_id varchar(32)`
- `cents integer`
- `created_at timestamp with time zone = now()`
- `currency varchar(3)`
- `decided_at timestamp with time zone null`
- `decided_by text null`
- `description text null`
- `fee_cents integer = 0`
- `id integer = nextval('delivery.wise_credits_id_seq'::regclass)`
- `invoice_id integer null`
- `kind varchar(40)`
- `memo text null`
- `payer text null`
- `raw jsonb`
- `status varchar(16)`
- `why text null`
- `wise_id varchar(128)`

References:

- delivery.invoices (invoice_id → id)

Indexes:

- `CREATE INDEX ix_wise_credits_invoice ON delivery.wise_credits USING btree (invoice_id)`
- `CREATE INDEX ix_wise_credits_status ON delivery.wise_credits USING btree (status, at)`
- `CREATE UNIQUE INDEX pk_wise_credits ON delivery.wise_credits USING btree (id)`
- `CREATE UNIQUE INDEX uq_wise_credits_wise_id ON delivery.wise_credits USING btree (wise_id)`
