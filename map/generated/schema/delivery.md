# delivery: schema

Tables and views: 25.

## delivery.asks (table)

- `id integer = nextval('delivery.asks_id_seq'::regclass)`
- `engagement_id integer`
- `milestone_id integer null`
- `text text`
- `due_on date null`
- `answer text null`
- `file_key text null`
- `answered_by text null`
- `answered_at timestamp with time zone null`
- `created_by text`
- `created_at timestamp with time zone = now()`

References:

- delivery.engagements (engagement_id → id)
- delivery.milestones (milestone_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_asks ON delivery.asks USING btree (id)`
- `CREATE INDEX ix_asks_engagement ON delivery.asks USING btree (engagement_id)`
- `CREATE INDEX ix_asks_milestone ON delivery.asks USING btree (milestone_id)`

## delivery.deliverables (table)

- `id integer = nextval('delivery.deliverables_id_seq'::regclass)`
- `engagement_id integer`
- `milestone_id integer null`
- `title text`
- `kind varchar(8)`
- `url text null`
- `file_key text null`
- `version integer = 1`
- `previous_id integer null`
- `status varchar(8) = 'waiting'::character varying`
- `decided_by text null`
- `decided_at timestamp with time zone null`
- `decision_note text null`
- `created_by text`
- `created_at timestamp with time zone = now()`

References:

- delivery.deliverables (previous_id → id)
- delivery.engagements (engagement_id → id)
- delivery.milestones (milestone_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_deliverables ON delivery.deliverables USING btree (id)`
- `CREATE INDEX ix_deliverables_engagement ON delivery.deliverables USING btree (engagement_id)`
- `CREATE INDEX ix_deliverables_milestone ON delivery.deliverables USING btree (milestone_id)`
- `CREATE INDEX ix_deliverables_previous ON delivery.deliverables USING btree (previous_id)`

## delivery.engagements (table)

- `id integer = nextval('delivery.engagements_id_seq'::regclass)`
- `client_id varchar(40)`
- `offer_id varchar(64)`
- `starts_on date`
- `status varchar(16) = 'active'::character varying`
- `created_by text`
- `created_at timestamp with time zone = now()`
- `ended_on date null`
- `source_channel varchar(16) null`
- `source_campaign varchar(120) null`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_engagements ON delivery.engagements USING btree (id)`
- `CREATE INDEX ix_engagements_client ON delivery.engagements USING btree (client_id)`

## delivery.milestones (table)

- `id integer = nextval('delivery.milestones_id_seq'::regclass)`
- `engagement_id integer`
- `key varchar(64)`
- `name text`
- `position integer`
- `planned_from date`
- `planned_to date null`
- `due_on date null`
- `done_on date null`
- `slip_reason text null`
- `promised jsonb = '[]'::jsonb`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_milestones ON delivery.milestones USING btree (id)`
- `CREATE UNIQUE INDEX uq_milestones_key ON delivery.milestones USING btree (engagement_id, key)`

## delivery.results (table)

- `engagement_id integer`
- `key varchar(64)`
- `value numeric`
- `note text null`
- `updated_by text`
- `updated_at timestamp with time zone = now()`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_results ON delivery.results USING btree (engagement_id, key)`

## delivery.updates (table)

- `id integer = nextval('delivery.updates_id_seq'::regclass)`
- `engagement_id integer`
- `milestone_id integer null`
- `author text`
- `body text`
- `internal boolean = false`
- `hidden_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`

References:

- delivery.engagements (engagement_id → id)
- delivery.milestones (milestone_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_updates ON delivery.updates USING btree (id)`
- `CREATE INDEX ix_updates_engagement ON delivery.updates USING btree (engagement_id, created_at)`
- `CREATE INDEX ix_updates_milestone ON delivery.updates USING btree (milestone_id)`

## delivery.member_mail (table)

- `client_id varchar(40)`
- `email text`
- `level varchar(8) = 'all'::character varying`
- `told_through timestamp with time zone null`
- `digest_on date null`

References:

- public.client_members (client_id → client_id, email → email)

Indexes:

- `CREATE UNIQUE INDEX pk_member_mail ON delivery.member_mail USING btree (client_id, email)`

## delivery.pulses (table)

- `id integer = nextval('delivery.pulses_id_seq'::regclass)`
- `engagement_id integer`
- `email text`
- `week date`
- `score smallint`
- `note text null`
- `at timestamp with time zone = now()`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_pulses ON delivery.pulses USING btree (id)`
- `CREATE UNIQUE INDEX uq_pulses_week ON delivery.pulses USING btree (engagement_id, email, week)`

## delivery.comments (table)

- `id integer = nextval('delivery.comments_id_seq'::regclass)`
- `engagement_id integer`
- `update_id integer null`
- `deliverable_id integer null`
- `author text`
- `from_wren boolean`
- `body text`
- `created_at timestamp with time zone = now()`

References:

- delivery.deliverables (deliverable_id → id)
- delivery.engagements (engagement_id → id)
- delivery.updates (update_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_comments ON delivery.comments USING btree (id)`
- `CREATE INDEX ix_comments_update ON delivery.comments USING btree (update_id)`
- `CREATE INDEX ix_comments_deliverable ON delivery.comments USING btree (deliverable_id)`
- `CREATE INDEX ix_comments_engagement ON delivery.comments USING btree (engagement_id, created_at)`

## delivery.invoices (table)

- `id integer = nextval('delivery.invoices_id_seq'::regclass)`
- `engagement_id integer`
- `number varchar(64) = ('WREN-'::text || nextval('delivery.invoice_number'::regclass))`
- `description text`
- `cents integer`
- `currency varchar(3) = 'USD'::character varying`
- `issued_on date`
- `due_on date`
- `status varchar(16) = 'open'::character varying`
- `paid_on date null`
- `created_by text`
- `created_at timestamp with time zone = now()`
- `setup boolean = false`
- `reminded_at timestamp with time zone null`
- `period varchar(7) null`
- `units integer null`
- `lines jsonb = '[]'::jsonb`
- `refunded_cents integer = 0`
- `dispute varchar(8) null`
- `received_cents integer = 0`
- `mailed_at timestamp with time zone null`
- `told jsonb = '{}'::jsonb`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_invoices ON delivery.invoices USING btree (id)`
- `CREATE UNIQUE INDEX uq_invoices_number ON delivery.invoices USING btree (number)`
- `CREATE INDEX ix_invoices_engagement ON delivery.invoices USING btree (engagement_id)`

## delivery.access_requests (table)

- `id integer = nextval('delivery.access_requests_id_seq'::regclass)`
- `engagement_id integer`
- `system text`
- `scope text`
- `why text`
- `revoke text`
- `status varchar(16) = 'open'::character varying`
- `note text null`
- `answered_by text null`
- `answered_at timestamp with time zone null`
- `created_by text`
- `created_at timestamp with time zone = now()`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_access_requests ON delivery.access_requests USING btree (id)`
- `CREATE INDEX ix_access_requests_engagement ON delivery.access_requests USING btree (engagement_id)`

## delivery.agreements (table)

- `id integer = nextval('delivery.agreements_id_seq'::regclass)`
- `engagement_id integer`
- `version varchar(16)`
- `terms jsonb`
- `body text`
- `sha256 varchar(64)`
- `issued_by text`
- `issued_at timestamp with time zone = now()`
- `signer_name text null`
- `signer_title text null`
- `signer_email text null`
- `signed_at timestamp with time zone null`
- `signed_ip text null`
- `signed_agent text null`
- `mailed_at timestamp with time zone null`
- `terms_version integer null`

References:

- delivery.engagements (engagement_id → id)
- pipeline.terms_versions (terms_version → id)

Indexes:

- `CREATE UNIQUE INDEX pk_agreements ON delivery.agreements USING btree (id)`
- `CREATE UNIQUE INDEX uq_agreements_engagement ON delivery.agreements USING btree (engagement_id)`
- `CREATE INDEX ix_agreements_terms_version ON delivery.agreements USING btree (terms_version)`

## delivery.interests (table)

- `id integer = nextval('delivery.interests_id_seq'::regclass)`
- `engagement_id integer`
- `offer_id varchar(64)`
- `email text`
- `at timestamp with time zone = now()`
- `told_at timestamp with time zone null`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_interests ON delivery.interests USING btree (id)`
- `CREATE UNIQUE INDEX uq_interests_offer ON delivery.interests USING btree (engagement_id, offer_id, email)`

## delivery.moments (table)

- `engagement_id integer`
- `moment varchar(80)`
- `reached_on date`
- `mailed_at timestamp with time zone null`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_moments ON delivery.moments USING btree (engagement_id, moment)`

## delivery.reviews (table)

- `id integer = nextval('delivery.reviews_id_seq'::regclass)`
- `engagement_id integer`
- `moment varchar(80)`
- `email text`
- `score smallint null`
- `words text null`
- `may_quote varchar(16) = 'private'::character varying`
- `at timestamp with time zone = now()`
- `told_at timestamp with time zone null`

References:

- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_reviews ON delivery.reviews USING btree (id)`
- `CREATE UNIQUE INDEX uq_reviews_moment ON delivery.reviews USING btree (engagement_id, moment, email)`

## delivery.flags (table)

- `id integer = nextval('delivery.flags_id_seq'::regclass)`
- `client_id varchar(40)`
- `engagement_id integer null`
- `side varchar(12)`
- `source varchar(12)`
- `cause varchar(80)`
- `what text`
- `how text null`
- `once boolean = false`
- `urgent boolean = false`
- `remind_days smallint = 7`
- `owner text null`
- `raised_at timestamp with time zone = now()`
- `raised_by text`
- `addressed_at timestamp with time zone null`
- `addressed_by text null`
- `note text null`
- `cleared_at timestamp with time zone null`
- `cleared_by text null`
- `told_at timestamp with time zone null`
- `raise_fired_at timestamp with time zone null`
- `clear_fired_at timestamp with time zone null`

References:

- public.clients (client_id → id)
- delivery.engagements (engagement_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_flags ON delivery.flags USING btree (id)`
- `CREATE UNIQUE INDEX uq_flags_open ON delivery.flags USING btree (client_id, COALESCE(engagement_id, 0), cause) WHERE (cleared_at IS NULL)`
- `CREATE INDEX ix_flags_raised ON delivery.flags USING btree (raised_at)`
- `CREATE INDEX ix_flags_client ON delivery.flags USING btree (client_id, raised_at)`
- `CREATE INDEX ix_flags_engagement ON delivery.flags USING btree (engagement_id)`

## delivery.flag_digests (table)

- `day date`
- `flags integer`
- `at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_flag_digests ON delivery.flag_digests USING btree (day)`

## delivery.health_days (table)

- `client_id varchar(40)`
- `day date`
- `score smallint null`
- `band varchar(8)`
- `results smallint null`
- `engagement smallint null`
- `sentiment smallint null`
- `money smallint null`
- `weights jsonb`
- `why jsonb = '{}'::jsonb`
- `ages jsonb = '{}'::jsonb`
- `stale jsonb = '[]'::jsonb`
- `visited boolean = false`
- `override smallint null`
- `inputs jsonb = '[]'::jsonb`
- `at timestamp with time zone = now()`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_health_days ON delivery.health_days USING btree (client_id, day)`

## delivery.health_overrides (table)

- `id integer = nextval('delivery.health_overrides_id_seq'::regclass)`
- `client_id varchar(40)`
- `score smallint`
- `reason text`
- `by text`
- `at timestamp with time zone = now()`
- `cleared_at timestamp with time zone null`
- `cleared_by text null`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_health_overrides ON delivery.health_overrides USING btree (id)`
- `CREATE UNIQUE INDEX uq_health_overrides_open ON delivery.health_overrides USING btree (client_id) WHERE (cleared_at IS NULL)`

## delivery.health_ratings (table)

- `id integer = nextval('delivery.health_ratings_id_seq'::regclass)`
- `client_id varchar(40)`
- `score smallint`
- `note text null`
- `by text`
- `at timestamp with time zone = now()`

References:

- public.clients (client_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_health_ratings ON delivery.health_ratings USING btree (id)`
- `CREATE INDEX ix_health_ratings_client ON delivery.health_ratings USING btree (client_id, at)`

## delivery.console_flags (view)

- `id integer null`
- `client text null`
- `name text null`
- `side text null`
- `source text null`
- `what text null`
- `state text null`
- `urgent text null`
- `owner text null`
- `raised timestamp with time zone null`
- `raised_by text null`
- `addressed timestamp with time zone null`
- `addressed_by text null`
- `note text null`
- `cleared timestamp with time zone null`
- `cleared_by text null`

## delivery.console_health (view)

- `id text null`
- `name text null`
- `score integer null`
- `model integer null`
- `override integer null`
- `reason text null`
- `override_by text null`
- `hand text null`
- `band text null`
- `results integer null`
- `engagement integer null`
- `sentiment integer null`
- `money integer null`
- `results_why text null`
- `engagement_why text null`
- `sentiment_why text null`
- `money_why text null`
- `weights text null`
- `weakest text null`
- `stale integer null`
- `stale_parts text null`
- `risks integer null`
- `opportunities integer null`
- `rating integer null`
- `rated timestamp with time zone null`
- `updated timestamp with time zone null`

## delivery.console_health_days (view)

- `id text null`
- `client text null`
- `name text null`
- `day date null`
- `score integer null`
- `model integer null`
- `override integer null`
- `band text null`
- `results integer null`
- `engagement integer null`
- `sentiment integer null`
- `money integer null`
- `visited text null`
- `stale_parts text null`

## delivery.console_health_inputs (view)

- `id text null`
- `client text null`
- `name text null`
- `part text null`
- `what text null`
- `value text null`
- `at timestamp with time zone null`
- `age text null`
- `rows text null`

## delivery.wise_credits (table)

- `id integer = nextval('delivery.wise_credits_id_seq'::regclass)`
- `wise_id varchar(128)`
- `balance_id varchar(32)`
- `currency varchar(3)`
- `cents integer`
- `fee_cents integer = 0`
- `at timestamp with time zone`
- `kind varchar(40)`
- `payer text null`
- `memo text null`
- `description text null`
- `status varchar(16)`
- `invoice_id integer null`
- `why text null`
- `decided_by text null`
- `decided_at timestamp with time zone null`
- `raw jsonb`
- `created_at timestamp with time zone = now()`

References:

- delivery.invoices (invoice_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_wise_credits ON delivery.wise_credits USING btree (id)`
- `CREATE UNIQUE INDEX uq_wise_credits_wise_id ON delivery.wise_credits USING btree (wise_id)`
- `CREATE INDEX ix_wise_credits_status ON delivery.wise_credits USING btree (status, at)`
- `CREATE INDEX ix_wise_credits_invoice ON delivery.wise_credits USING btree (invoice_id)`
