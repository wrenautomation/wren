# pipeline: schema

Tables and views: 18.

## pipeline.deals (table)

- `collected_cents bigint = 0`
- `currency varchar(3) = 'USD'::character varying`
- `ends_at timestamp with time zone null`
- `engagement_id integer null`
- `id uuid = gen_random_uuid()`
- `journey uuid`
- `node varchar(40) null`
- `offer varchar(64)`
- `offer_version integer`
- `profile_id integer`
- `signed_at timestamp with time zone = now()`
- `status varchar(5) = 'open'::character varying`
- `terms_version integer null`

References:

- pipeline.instances (journey → id)
- pipeline.terms_versions (terms_version → id)
- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_deals_profile_id ON pipeline.deals USING btree (profile_id)`
- `CREATE INDEX ix_deals_terms_version ON pipeline.deals USING btree (terms_version)`
- `CREATE UNIQUE INDEX pk_deals ON pipeline.deals USING btree (id)`
- `CREATE UNIQUE INDEX uq_deals_journey_node ON pipeline.deals USING btree (journey, node)`

## pipeline.edge_flow (view)

- `crossings integer null`
- `day date null`
- `edge text null`
- `from_node text null`
- `to_node text null`
- `version integer null`

## pipeline.entry_numbers (view)

- `collected_cents bigint null`
- `cost double precision null`
- `day date null`
- `deals integer null`
- `entry varchar null`
- `funnel varchar(40) null`
- `opened integer null`

## pipeline.funnel_versions (table)

- `body jsonb`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `funnel varchar(40)`
- `id integer = nextval('pipeline.funnel_versions_id_seq'::regclass)`
- `number integer`
- `why text`

References:

- pipeline.funnels (funnel → id)

Indexes:

- `CREATE UNIQUE INDEX pk_funnel_versions ON pipeline.funnel_versions USING btree (id)`
- `CREATE UNIQUE INDEX uq_funnel_versions_number ON pipeline.funnel_versions USING btree (funnel, number)`

## pipeline.funnels (table)

- `created_at timestamp with time zone = now()`
- `id varchar(40)`
- `name text`
- `status varchar(4) = 'live'::character varying`

Indexes:

- `CREATE UNIQUE INDEX pk_funnels ON pipeline.funnels USING btree (id)`

## pipeline.instances (table)

- `closed_at timestamp with time zone null`
- `document_id integer null`
- `drop_reason text null`
- `entry varchar(40)`
- `entry_ref jsonb null`
- `id uuid = gen_random_uuid()`
- `legacy_deal uuid null`
- `moved_at timestamp with time zone = now()`
- `node varchar(40)`
- `opened_at timestamp with time zone = now()`
- `owner text null`
- `profile_id integer null`
- `status varchar(7) = 'open'::character varying`
- `subject_kind varchar(8) = 'person'::character varying`
- `trail jsonb = '[]'::jsonb`
- `version integer`

References:

- pipeline.shape_versions (version → number)
- public.documents (document_id → id)
- public.profiles (profile_id → id)

Indexes:

- `CREATE INDEX ix_instances_profile_status ON pipeline.instances USING btree (profile_id, status)`
- `CREATE INDEX ix_instances_shape_version ON pipeline.instances USING btree (version)`
- `CREATE UNIQUE INDEX pk_instances ON pipeline.instances USING btree (id)`
- `CREATE UNIQUE INDEX uq_instances_legacy_deal ON pipeline.instances USING btree (legacy_deal) WHERE (legacy_deal IS NOT NULL)`
- `CREATE UNIQUE INDEX uq_instances_open_document ON pipeline.instances USING btree (document_id, entry) WHERE (((status)::text = 'open'::text) AND ((subject_kind)::text = 'document'::text))`
- `CREATE UNIQUE INDEX uq_instances_open_person ON pipeline.instances USING btree (profile_id) WHERE (((status)::text = 'open'::text) AND ((subject_kind)::text = 'person'::text))`

## pipeline.journey_research (table)

- `icp jsonb null`
- `journey uuid`
- `level varchar(5)`
- `lookup_id integer null`
- `note text null`
- `profile_id integer`
- `requested_at timestamp with time zone = now()`
- `result jsonb null`
- `stage varchar(40)`
- `state varchar(7) = 'queued'::character varying`

References:

- pipeline.instances (journey → id)

Indexes:

- `CREATE INDEX ix_journey_research_profile_id ON pipeline.journey_research USING btree (profile_id)`
- `CREATE UNIQUE INDEX pk_journey_research ON pipeline.journey_research USING btree (journey, stage)`

## pipeline.move_flow (view)

- `day date null`
- `from_node text null`
- `loops integer null`
- `moves integer null`
- `skips integer null`
- `to_node text null`
- `version integer null`

## pipeline.node_counts (view)

- `arrived integer null`
- `day date null`
- `left integer null`
- `node text null`
- `skipped integer null`
- `version integer null`

## pipeline.offer_versions (table)

- `body jsonb`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `hash varchar(64)`
- `id integer = nextval('pipeline.offer_versions_id_seq'::regclass)`
- `number integer`
- `offer varchar(64)`
- `why text`

Indexes:

- `CREATE UNIQUE INDEX pk_offer_versions ON pipeline.offer_versions USING btree (id)`
- `CREATE UNIQUE INDEX uq_offer_versions_number ON pipeline.offer_versions USING btree (offer, number)`

## pipeline.shape_drafts (table)

- `applied_version integer null`
- `base integer`
- `body jsonb`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `decided_at timestamp with time zone null`
- `decided_by text null`
- `drop_reason text null`
- `id varchar(40)`
- `moves jsonb = '{}'::jsonb`
- `name text`
- `note text = ''::text`
- `state varchar(8) = 'draft'::character varying`
- `updated_at timestamp with time zone = now()`

References:

- pipeline.shape_versions (applied_version → number; base → number)

Indexes:

- `CREATE INDEX ix_shape_drafts_applied_version ON pipeline.shape_drafts USING btree (applied_version)`
- `CREATE INDEX ix_shape_drafts_base ON pipeline.shape_drafts USING btree (base)`
- `CREATE UNIQUE INDEX pk_shape_drafts ON pipeline.shape_drafts USING btree (id)`

## pipeline.shape_mirrors (table)

- `at timestamp with time zone = now()`
- `path text`
- `repo text`
- `sha text`
- `version integer`

References:

- pipeline.shape_versions (version → number)

Indexes:

- `CREATE UNIQUE INDEX pk_shape_mirrors ON pipeline.shape_mirrors USING btree (version)`

## pipeline.shape_tags (table)

- `created_at timestamp with time zone = now()`
- `created_by text`
- `name text`
- `note text null`
- `version integer`

References:

- pipeline.shape_versions (version → number)

Indexes:

- `CREATE INDEX ix_shape_tags_version ON pipeline.shape_tags USING btree (version)`
- `CREATE UNIQUE INDEX pk_shape_tags ON pipeline.shape_tags USING btree (name)`

## pipeline.shape_versions (table)

- `body jsonb`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `depths jsonb`
- `draft varchar(40) null`
- `note text`
- `number integer`
- `parent integer null`
- `run jsonb`

References:

- pipeline.shape_drafts (draft → id)
- pipeline.shape_versions (parent → number)

Indexes:

- `CREATE INDEX ix_shape_versions_draft ON pipeline.shape_versions USING btree (draft)`
- `CREATE INDEX ix_shape_versions_parent ON pipeline.shape_versions USING btree (parent)`
- `CREATE UNIQUE INDEX pk_shape_versions ON pipeline.shape_versions USING btree (number)`

## pipeline.source_numbers (view)

- `booked integer null`
- `collected_cents bigint null`
- `cost double precision null`
- `day date null`
- `deals integer null`
- `opened integer null`
- `replied integer null`
- `source varchar null`

## pipeline.stage_counts (view)

- `day date null`
- `entered integer null`
- `funnel varchar(40) null`
- `skipped integer null`
- `stage text null`
- `version integer null`

## pipeline.stage_flow (view)

- `advanced integer null`
- `conversion double precision null`
- `funnel varchar(40) null`
- `median_seconds double precision null`
- `next_stage text null`
- `reached integer null`
- `stage text null`

## pipeline.terms_versions (table)

- `body jsonb`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `effective_from date`
- `id integer = nextval('pipeline.terms_versions_id_seq'::regclass)`
- `number integer`
- `offer varchar(64)`
- `plan varchar(40)`
- `why text`

Indexes:

- `CREATE UNIQUE INDEX pk_terms_versions ON pipeline.terms_versions USING btree (id)`
- `CREATE UNIQUE INDEX uq_terms_versions_number ON pipeline.terms_versions USING btree (offer, plan, number)`
