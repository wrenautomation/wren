# pipeline: schema

Tables and views: 18.

## pipeline.funnel_versions (table)

- `id integer = nextval('pipeline.funnel_versions_id_seq'::regclass)`
- `funnel varchar(40)`
- `number integer`
- `body jsonb`
- `why text`
- `created_at timestamp with time zone = now()`
- `created_by text`

References:

- pipeline.funnels (funnel → id)

Indexes:

- `CREATE UNIQUE INDEX pk_funnel_versions ON pipeline.funnel_versions USING btree (id)`
- `CREATE UNIQUE INDEX uq_funnel_versions_number ON pipeline.funnel_versions USING btree (funnel, number)`

## pipeline.funnels (table)

- `id varchar(40)`
- `name text`
- `status varchar(4) = 'live'::character varying`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_funnels ON pipeline.funnels USING btree (id)`

## pipeline.instances (table)

- `id uuid = gen_random_uuid()`
- `profile_id integer null`
- `status varchar(7) = 'open'::character varying`
- `drop_reason text null`
- `entry varchar(40)`
- `entry_ref jsonb null`
- `opened_at timestamp with time zone = now()`
- `moved_at timestamp with time zone = now()`
- `closed_at timestamp with time zone null`
- `legacy_deal uuid null`
- `version integer`
- `node varchar(40)`
- `trail jsonb = '[]'::jsonb`
- `owner text null`
- `subject_kind varchar(8) = 'person'::character varying`
- `document_id integer null`

References:

- public.documents (document_id → id)
- public.profiles (profile_id → id)
- pipeline.shape_versions (version → number)

Indexes:

- `CREATE UNIQUE INDEX pk_instances ON pipeline.instances USING btree (id)`
- `CREATE UNIQUE INDEX uq_instances_legacy_deal ON pipeline.instances USING btree (legacy_deal) WHERE (legacy_deal IS NOT NULL)`
- `CREATE INDEX ix_instances_profile_status ON pipeline.instances USING btree (profile_id, status)`
- `CREATE INDEX ix_instances_shape_version ON pipeline.instances USING btree (version)`
- `CREATE UNIQUE INDEX uq_instances_open_person ON pipeline.instances USING btree (profile_id) WHERE (((status)::text = 'open'::text) AND ((subject_kind)::text = 'person'::text))`
- `CREATE UNIQUE INDEX uq_instances_open_document ON pipeline.instances USING btree (document_id, entry) WHERE (((status)::text = 'open'::text) AND ((subject_kind)::text = 'document'::text))`

## pipeline.offer_versions (table)

- `id integer = nextval('pipeline.offer_versions_id_seq'::regclass)`
- `offer varchar(64)`
- `number integer`
- `hash varchar(64)`
- `body jsonb`
- `why text`
- `created_at timestamp with time zone = now()`
- `created_by text`

Indexes:

- `CREATE UNIQUE INDEX pk_offer_versions ON pipeline.offer_versions USING btree (id)`
- `CREATE UNIQUE INDEX uq_offer_versions_number ON pipeline.offer_versions USING btree (offer, number)`

## pipeline.deals (table)

- `id uuid = gen_random_uuid()`
- `journey uuid`
- `profile_id integer`
- `offer varchar(64)`
- `offer_version integer`
- `terms_version integer null`
- `signed_at timestamp with time zone = now()`
- `ends_at timestamp with time zone null`
- `status varchar(5) = 'open'::character varying`
- `collected_cents bigint = 0`
- `currency varchar(3) = 'USD'::character varying`
- `engagement_id integer null`
- `node varchar(40) null`

References:

- public.profiles (profile_id → id)
- pipeline.instances (journey → id)
- pipeline.terms_versions (terms_version → id)

Indexes:

- `CREATE UNIQUE INDEX pk_deals ON pipeline.deals USING btree (id)`
- `CREATE INDEX ix_deals_profile_id ON pipeline.deals USING btree (profile_id)`
- `CREATE INDEX ix_deals_terms_version ON pipeline.deals USING btree (terms_version)`
- `CREATE UNIQUE INDEX uq_deals_journey_node ON pipeline.deals USING btree (journey, node)`

## pipeline.terms_versions (table)

- `id integer = nextval('pipeline.terms_versions_id_seq'::regclass)`
- `offer varchar(64)`
- `plan varchar(40)`
- `number integer`
- `effective_from date`
- `body jsonb`
- `why text`
- `created_at timestamp with time zone = now()`
- `created_by text`

Indexes:

- `CREATE UNIQUE INDEX pk_terms_versions ON pipeline.terms_versions USING btree (id)`
- `CREATE UNIQUE INDEX uq_terms_versions_number ON pipeline.terms_versions USING btree (offer, plan, number)`

## pipeline.journey_research (table)

- `journey uuid`
- `stage varchar(40)`
- `profile_id integer`
- `level varchar(5)`
- `state varchar(7) = 'queued'::character varying`
- `icp jsonb null`
- `lookup_id integer null`
- `result jsonb null`
- `note text null`
- `requested_at timestamp with time zone = now()`

References:

- pipeline.instances (journey → id)

Indexes:

- `CREATE UNIQUE INDEX pk_journey_research ON pipeline.journey_research USING btree (journey, stage)`
- `CREATE INDEX ix_journey_research_profile_id ON pipeline.journey_research USING btree (profile_id)`

## pipeline.shape_versions (table)

- `number integer`
- `body jsonb`
- `depths jsonb`
- `note text`
- `parent integer null`
- `created_at timestamp with time zone = now()`
- `created_by text`
- `draft varchar(40) null`
- `run jsonb`

References:

- pipeline.shape_versions (parent → number)
- pipeline.shape_drafts (draft → id)

Indexes:

- `CREATE UNIQUE INDEX pk_shape_versions ON pipeline.shape_versions USING btree (number)`
- `CREATE INDEX ix_shape_versions_parent ON pipeline.shape_versions USING btree (parent)`
- `CREATE INDEX ix_shape_versions_draft ON pipeline.shape_versions USING btree (draft)`

## pipeline.node_counts (view)

- `version integer null`
- `node text null`
- `day date null`
- `arrived integer null`
- `skipped integer null`
- `left integer null`

## pipeline.stage_counts (view)

- `funnel varchar(40) null`
- `version integer null`
- `stage text null`
- `day date null`
- `entered integer null`
- `skipped integer null`

## pipeline.shape_drafts (table)

- `id varchar(40)`
- `name text`
- `body jsonb`
- `moves jsonb = '{}'::jsonb`
- `base integer`
- `note text = ''::text`
- `state varchar(8) = 'draft'::character varying`
- `created_by text`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`
- `applied_version integer null`
- `decided_by text null`
- `decided_at timestamp with time zone null`
- `drop_reason text null`

References:

- pipeline.shape_versions (applied_version → number; base → number)

Indexes:

- `CREATE UNIQUE INDEX pk_shape_drafts ON pipeline.shape_drafts USING btree (id)`
- `CREATE INDEX ix_shape_drafts_base ON pipeline.shape_drafts USING btree (base)`
- `CREATE INDEX ix_shape_drafts_applied_version ON pipeline.shape_drafts USING btree (applied_version)`

## pipeline.shape_mirrors (table)

- `version integer`
- `repo text`
- `path text`
- `sha text`
- `at timestamp with time zone = now()`

References:

- pipeline.shape_versions (version → number)

Indexes:

- `CREATE UNIQUE INDEX pk_shape_mirrors ON pipeline.shape_mirrors USING btree (version)`

## pipeline.shape_tags (table)

- `name text`
- `version integer`
- `note text null`
- `created_by text`
- `created_at timestamp with time zone = now()`

References:

- pipeline.shape_versions (version → number)

Indexes:

- `CREATE UNIQUE INDEX pk_shape_tags ON pipeline.shape_tags USING btree (name)`
- `CREATE INDEX ix_shape_tags_version ON pipeline.shape_tags USING btree (version)`

## pipeline.edge_flow (view)

- `version integer null`
- `edge text null`
- `from_node text null`
- `to_node text null`
- `day date null`
- `crossings integer null`

## pipeline.source_numbers (view)

- `source varchar null`
- `day date null`
- `opened integer null`
- `deals integer null`
- `collected_cents bigint null`
- `cost double precision null`
- `replied integer null`
- `booked integer null`

## pipeline.entry_numbers (view)

- `funnel varchar(40) null`
- `entry varchar null`
- `day date null`
- `opened integer null`
- `deals integer null`
- `collected_cents bigint null`
- `cost double precision null`

## pipeline.stage_flow (view)

- `funnel varchar(40) null`
- `stage text null`
- `next_stage text null`
- `reached integer null`
- `advanced integer null`
- `conversion double precision null`
- `median_seconds double precision null`

## pipeline.move_flow (view)

- `version integer null`
- `from_node text null`
- `to_node text null`
- `day date null`
- `moves integer null`
- `skips integer null`
- `loops integer null`
