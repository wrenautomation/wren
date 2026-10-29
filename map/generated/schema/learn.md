# learn: schema

Tables and views: 19.

## learn.alert_picks (table)

- `at timestamp with time zone = now()`
- `client varchar(40)`
- `email varchar(320)`
- `pick varchar(8)`
- `source_id integer`

References:

- learn.sources (source_id → id)

Indexes:

- `CREATE INDEX ix_learn_alert_picks_source ON learn.alert_picks USING btree (source_id)`
- `CREATE UNIQUE INDEX pk_alert_picks ON learn.alert_picks USING btree (client, email, source_id)`

## learn.alerts (table)

- `at timestamp with time zone = now()`
- `client varchar(40)`
- `email varchar(320)`
- `id integer = nextval('learn.alerts_id_seq'::regclass)`
- `item_id integer`
- `seen_at timestamp with time zone null`
- `state varchar(8)`
- `why varchar(8)`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE INDEX ix_learn_alerts_item ON learn.alerts USING btree (item_id)`
- `CREATE INDEX ix_learn_alerts_person_at ON learn.alerts USING btree (client, email, at)`
- `CREATE UNIQUE INDEX pk_alerts ON learn.alerts USING btree (id)`
- `CREATE UNIQUE INDEX uq_learn_alerts_person_item ON learn.alerts USING btree (client, email, item_id)`

## learn.breakdown_records (view)

- `at timestamp with time zone null`
- `beats text null`
- `called boolean null`
- `calls integer null`
- `check text null`
- `check_why text null`
- `comments integer null`
- `creator text null`
- `cta text null`
- `cta_kind text null`
- `followed text null`
- `format text null`
- `hook text null`
- `hook_style text null`
- `hook_why text null`
- `id integer null`
- `kind text null`
- `likes integer null`
- `open text null`
- `reach integer null`
- `score integer null`
- `source text null`
- `source_id integer null`
- `stats_at timestamp with time zone null`
- `title text null`
- `topic text null`
- `type text null`
- `views integer null`

## learn.breakdowns (table)

- `beats jsonb = '[]'::jsonb`
- `by varchar(8) = 'model'::character varying`
- `created_at timestamp with time zone = now()`
- `cta text null`
- `cta_kind varchar(12)`
- `facts jsonb = '{}'::jsonb`
- `hook text`
- `hook_style varchar(16)`
- `hook_why text`
- `item_id integer`
- `kind varchar(8)`
- `topic text`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE INDEX ix_learn_breakdowns_hook_style ON learn.breakdowns USING btree (hook_style)`
- `CREATE INDEX ix_learn_breakdowns_kind ON learn.breakdowns USING btree (kind)`
- `CREATE UNIQUE INDEX pk_breakdowns ON learn.breakdowns USING btree (item_id)`

## learn.checks (table)

- `all_median real`
- `all_n integer`
- `at timestamp with time zone = now()`
- `item_id integer`
- `kind varchar(8)`
- `label text`
- `measure varchar(12)`
- `path text`
- `sop text`
- `value text`
- `with_median real`
- `with_n integer`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE INDEX ix_learn_checks_sop ON learn.checks USING btree (sop)`
- `CREATE UNIQUE INDEX pk_checks ON learn.checks USING btree (item_id, sop, path, value)`

## learn.collections (table)

- `by varchar(320) null`
- `client varchar(40)`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('learn.collections_id_seq'::regclass)`
- `name varchar(80)`
- `parent_id integer null`

References:

- learn.collections (parent_id → id)

Indexes:

- `CREATE INDEX ix_learn_collections_client ON learn.collections USING btree (client)`
- `CREATE INDEX ix_learn_collections_parent ON learn.collections USING btree (parent_id)`
- `CREATE UNIQUE INDEX pk_collections ON learn.collections USING btree (id)`

## learn.digests (table)

- `at timestamp with time zone = now()`
- `day date`
- `items integer`

Indexes:

- `CREATE UNIQUE INDEX pk_digests ON learn.digests USING btree (day)`

## learn.hook_records (view)

- `creators integer null`
- `id text null`
- `last_at timestamp with time zone null`
- `median_reach integer null`
- `reels integer null`
- `style text null`
- `top text null`
- `top_creator text null`
- `top_reach integer null`

## learn.item_records (view)

- `at timestamp with time zone null`
- `changes text null`
- `chars integer null`
- `collection varchar(80) null`
- `created_at timestamp with time zone null`
- `creator text null`
- `duration integer null`
- `failure text null`
- `id integer null`
- `kind text null`
- `later boolean null`
- `open text null`
- `saved_at timestamp with time zone null`
- `saved_via text null`
- `score integer null`
- `sops text null`
- `source text null`
- `source_id integer null`
- `source_kind text null`
- `starred boolean null`
- `state text null`
- `status text null`
- `summary text null`
- `tags text null`
- `title text null`
- `type text null`
- `verdict text null`
- `why text null`

## learn.item_tags (table)

- `at timestamp with time zone = now()`
- `item_id integer`
- `tag varchar(40)`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE INDEX ix_learn_item_tags_tag ON learn.item_tags USING btree (tag)`
- `CREATE UNIQUE INDEX pk_item_tags ON learn.item_tags USING btree (item_id, tag)`

## learn.items (table)

- `archived_at timestamp with time zone null`
- `changes jsonb = '[]'::jsonb`
- `client varchar(40)`
- `collection_id integer null`
- `created_at timestamp with time zone = now()`
- `creator text null`
- `document_id integer`
- `draft_id uuid null`
- `duration integer null`
- `embedding real[] null`
- `file text null`
- `id integer = nextval('learn.items_id_seq'::regclass)`
- `kind varchar(8) = 'article'::character varying`
- `later_at timestamp with time zone null`
- `media_url text null`
- `moments jsonb = '[]'::jsonb`
- `needs_mac timestamp with time zone null`
- `opened_at timestamp with time zone null`
- `pinned_at timestamp with time zone null`
- `played_at timestamp with time zone null`
- `position integer null`
- `published_at timestamp with time zone null`
- `read_at timestamp with time zone null`
- `read_failure text null`
- `saved_at timestamp with time zone null`
- `saved_by varchar(320) null`
- `saved_via varchar(8) null`
- `score smallint null`
- `scored_at timestamp with time zone null`
- `search tsvector null`
- `source_id integer null`
- `starred_at timestamp with time zone null`
- `stats jsonb null`
- `stats_at timestamp with time zone null`
- `summary text null`
- `text text = ''::text`
- `thumbnail_url text null`
- `title text`
- `told_at timestamp with time zone null`
- `transcript text null`
- `tries smallint = 0`
- `type varchar(12) = 'link'::character varying`
- `url text`
- `verdict varchar(8) null`
- `why text null`

References:

- learn.collections (collection_id → id)
- learn.sources (source_id → id)
- public.documents (document_id → id)

Indexes:

- `CREATE INDEX ix_learn_items_collection ON learn.items USING btree (collection_id)`
- `CREATE INDEX ix_learn_items_created ON learn.items USING btree (created_at)`
- `CREATE INDEX ix_learn_items_document_id ON learn.items USING btree (document_id)`
- `CREATE INDEX ix_learn_items_saved ON learn.items USING btree (saved_at)`
- `CREATE INDEX ix_learn_items_search ON learn.items USING gin (search)`
- `CREATE INDEX ix_learn_items_source ON learn.items USING btree (source_id)`
- `CREATE INDEX ix_learn_items_type ON learn.items USING btree (type)`
- `CREATE UNIQUE INDEX pk_items ON learn.items USING btree (id)`
- `CREATE UNIQUE INDEX uq_learn_items_client_url ON learn.items USING btree (client, url)`
- `CREATE UNIQUE INDEX uq_learn_items_draft_id ON learn.items USING btree (draft_id)`

## learn.readers (table)

- `client varchar(40)`
- `email varchar(320)`
- `mailed_on date null`
- `saved varchar(8) = 'top'::character varying`

Indexes:

- `CREATE UNIQUE INDEX pk_readers ON learn.readers USING btree (client, email)`

## learn.saved_records (view)

- `at timestamp with time zone null`
- `changes text null`
- `chars integer null`
- `collection varchar(80) null`
- `created_at timestamp with time zone null`
- `creator text null`
- `duration integer null`
- `failure text null`
- `id integer null`
- `kind text null`
- `later boolean null`
- `open text null`
- `saved_at timestamp with time zone null`
- `saved_via text null`
- `score integer null`
- `sops text null`
- `source text null`
- `source_id integer null`
- `source_kind text null`
- `starred boolean null`
- `state text null`
- `status text null`
- `summary text null`
- `tags text null`
- `title text null`
- `type text null`
- `verdict text null`
- `why text null`

## learn.seen (table)

- `at timestamp with time zone = now()`
- `client varchar(40)`
- `email varchar(320)`

Indexes:

- `CREATE UNIQUE INDEX pk_seen ON learn.seen USING btree (client, email)`

## learn.settings (table)

- `at timestamp with time zone = now()`
- `by varchar(320) null`
- `client varchar(40)`
- `digest_mail boolean = false`

Indexes:

- `CREATE UNIQUE INDEX pk_settings ON learn.settings USING btree (client)`

## learn.sop_sources (table)

- `asked_at timestamp with time zone = now()`
- `by varchar(320) null`
- `client varchar(40) null`
- `done_at timestamp with time zone null`
- `error text null`
- `file text null`
- `id integer = nextval('learn.sop_sources_id_seq'::regclass)`
- `item_id integer null`
- `note_id uuid null`
- `points timestamp with time zone null`
- `sop varchar(64)`
- `state varchar(8) = 'asked'::character varying`
- `text text null`
- `title text null`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE INDEX ix_learn_sop_sources_sop ON learn.sop_sources USING btree (sop)`
- `CREATE UNIQUE INDEX pk_sop_sources ON learn.sop_sources USING btree (id)`
- `CREATE UNIQUE INDEX uq_learn_sop_sources_item_sop ON learn.sop_sources USING btree (item_id, sop)`

## learn.source_records (view)

- `avatar_url text null`
- `by text null`
- `created_at timestamp with time zone null`
- `failure text null`
- `fetched_at timestamp with time zone null`
- `id integer null`
- `items integer null`
- `kind text null`
- `name text null`
- `page text null`
- `shown integer null`
- `state text null`
- `tell text null`
- `url text null`

## learn.sources (table)

- `avatar_url text null`
- `by varchar(320) null`
- `client varchar(40)`
- `created_at timestamp with time zone = now()`
- `failure text null`
- `fetched_at timestamp with time zone null`
- `id integer = nextval('learn.sources_id_seq'::regclass)`
- `kind varchar(12) = 'blog'::character varying`
- `name text`
- `page text null`
- `stopped_at timestamp with time zone null`
- `tell varchar(8) = 'top'::character varying`
- `url text`

Indexes:

- `CREATE UNIQUE INDEX pk_sources ON learn.sources USING btree (id)`
- `CREATE UNIQUE INDEX uq_learn_sources_client_url ON learn.sources USING btree (client, url)`

## learn.standards (view)

- `at timestamp with time zone null`
- `by text null`
- `calls integer null`
- `chars integer null`
- `creator text null`
- `cta_kind text null`
- `cta_s numeric null`
- `cuts integer null`
- `cuts_trust text null`
- `duration_s numeric null`
- `first_line_chars integer null`
- `first_product_s numeric null`
- `format text null`
- `hashtags integer null`
- `hook_style text null`
- `id integer null`
- `kind text null`
- `lines integer null`
- `link text null`
- `logo_s numeric null`
- `music boolean null`
- `platform text null`
- `reach integer null`
- `shape text null`
- `shot_median_s numeric null`
- `shot_p90_s numeric null`
- `title text null`
- `vo boolean null`
