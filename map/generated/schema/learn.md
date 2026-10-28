# learn: schema

Tables and views: 19.

## learn.digests (table)

- `day date`
- `items integer`
- `at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_digests ON learn.digests USING btree (day)`

## learn.items (table)

- `id integer = nextval('learn.items_id_seq'::regclass)`
- `source_id integer null`
- `url text`
- `kind varchar(8) = 'article'::character varying`
- `title text`
- `creator text null`
- `text text = ''::text`
- `transcript text null`
- `file text null`
- `needs_mac timestamp with time zone null`
- `read_at timestamp with time zone null`
- `read_failure text null`
- `published_at timestamp with time zone null`
- `score smallint null`
- `verdict varchar(8) null`
- `summary text null`
- `changes jsonb = '[]'::jsonb`
- `why text null`
- `tries smallint = 0`
- `scored_at timestamp with time zone null`
- `saved_at timestamp with time zone null`
- `saved_by varchar(320) null`
- `saved_via varchar(8) null`
- `told_at timestamp with time zone null`
- `archived_at timestamp with time zone null`
- `search tsvector null`
- `created_at timestamp with time zone = now()`
- `type varchar(12) = 'link'::character varying`
- `thumbnail_url text null`
- `duration integer null`
- `media_url text null`
- `moments jsonb = '[]'::jsonb`
- `opened_at timestamp with time zone null`
- `position integer null`
- `played_at timestamp with time zone null`
- `starred_at timestamp with time zone null`
- `later_at timestamp with time zone null`
- `pinned_at timestamp with time zone null`
- `collection_id integer null`
- `client varchar(40)`
- `embedding real[] null`
- `stats jsonb null`
- `stats_at timestamp with time zone null`
- `draft_id uuid null`
- `document_id integer`

References:

- public.documents (document_id → id)
- learn.sources (source_id → id)
- learn.collections (collection_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_items ON learn.items USING btree (id)`
- `CREATE INDEX ix_learn_items_source ON learn.items USING btree (source_id)`
- `CREATE INDEX ix_learn_items_created ON learn.items USING btree (created_at)`
- `CREATE INDEX ix_learn_items_saved ON learn.items USING btree (saved_at)`
- `CREATE INDEX ix_learn_items_search ON learn.items USING gin (search)`
- `CREATE INDEX ix_learn_items_collection ON learn.items USING btree (collection_id)`
- `CREATE INDEX ix_learn_items_type ON learn.items USING btree (type)`
- `CREATE UNIQUE INDEX uq_learn_items_client_url ON learn.items USING btree (client, url)`
- `CREATE UNIQUE INDEX uq_learn_items_draft_id ON learn.items USING btree (draft_id)`
- `CREATE INDEX ix_learn_items_document_id ON learn.items USING btree (document_id)`

## learn.sop_sources (table)

- `id integer = nextval('learn.sop_sources_id_seq'::regclass)`
- `item_id integer null`
- `sop varchar(64)`
- `state varchar(8) = 'asked'::character varying`
- `file text null`
- `points timestamp with time zone null`
- `error text null`
- `by varchar(320) null`
- `asked_at timestamp with time zone = now()`
- `done_at timestamp with time zone null`
- `note_id uuid null`
- `client varchar(40) null`
- `title text null`
- `text text null`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_sop_sources ON learn.sop_sources USING btree (id)`
- `CREATE UNIQUE INDEX uq_learn_sop_sources_item_sop ON learn.sop_sources USING btree (item_id, sop)`
- `CREATE INDEX ix_learn_sop_sources_sop ON learn.sop_sources USING btree (sop)`

## learn.sources (table)

- `id integer = nextval('learn.sources_id_seq'::regclass)`
- `url text`
- `page text null`
- `name text`
- `kind varchar(12) = 'blog'::character varying`
- `tell varchar(8) = 'top'::character varying`
- `fetched_at timestamp with time zone null`
- `failure text null`
- `stopped_at timestamp with time zone null`
- `by varchar(320) null`
- `created_at timestamp with time zone = now()`
- `avatar_url text null`
- `client varchar(40)`

Indexes:

- `CREATE UNIQUE INDEX pk_sources ON learn.sources USING btree (id)`
- `CREATE UNIQUE INDEX uq_learn_sources_client_url ON learn.sources USING btree (client, url)`

## learn.collections (table)

- `id integer = nextval('learn.collections_id_seq'::regclass)`
- `name varchar(80)`
- `parent_id integer null`
- `by varchar(320) null`
- `created_at timestamp with time zone = now()`
- `client varchar(40)`

References:

- learn.collections (parent_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_collections ON learn.collections USING btree (id)`
- `CREATE INDEX ix_learn_collections_parent ON learn.collections USING btree (parent_id)`
- `CREATE INDEX ix_learn_collections_client ON learn.collections USING btree (client)`

## learn.item_tags (table)

- `item_id integer`
- `tag varchar(40)`
- `at timestamp with time zone = now()`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_item_tags ON learn.item_tags USING btree (item_id, tag)`
- `CREATE INDEX ix_learn_item_tags_tag ON learn.item_tags USING btree (tag)`

## learn.seen (table)

- `email varchar(320)`
- `at timestamp with time zone = now()`
- `client varchar(40)`

Indexes:

- `CREATE UNIQUE INDEX pk_seen ON learn.seen USING btree (client, email)`

## learn.item_records (view)

- `id integer null`
- `title text null`
- `kind text null`
- `type text null`
- `creator text null`
- `source text null`
- `source_kind text null`
- `source_id integer null`
- `score integer null`
- `summary text null`
- `changes text null`
- `why text null`
- `verdict text null`
- `state text null`
- `status text null`
- `failure text null`
- `tags text null`
- `collection varchar(80) null`
- `starred boolean null`
- `later boolean null`
- `duration integer null`
- `sops text null`
- `at timestamp with time zone null`
- `saved_at timestamp with time zone null`
- `saved_via text null`
- `created_at timestamp with time zone null`
- `open text null`
- `chars integer null`

## learn.saved_records (view)

- `id integer null`
- `title text null`
- `kind text null`
- `type text null`
- `creator text null`
- `source text null`
- `source_kind text null`
- `source_id integer null`
- `score integer null`
- `summary text null`
- `changes text null`
- `why text null`
- `verdict text null`
- `state text null`
- `status text null`
- `failure text null`
- `tags text null`
- `collection varchar(80) null`
- `starred boolean null`
- `later boolean null`
- `duration integer null`
- `sops text null`
- `at timestamp with time zone null`
- `saved_at timestamp with time zone null`
- `saved_via text null`
- `created_at timestamp with time zone null`
- `open text null`
- `chars integer null`

## learn.source_records (view)

- `id integer null`
- `name text null`
- `url text null`
- `page text null`
- `kind text null`
- `avatar_url text null`
- `tell text null`
- `state text null`
- `items integer null`
- `shown integer null`
- `fetched_at timestamp with time zone null`
- `failure text null`
- `by text null`
- `created_at timestamp with time zone null`

## learn.alert_picks (table)

- `client varchar(40)`
- `email varchar(320)`
- `source_id integer`
- `pick varchar(8)`
- `at timestamp with time zone = now()`

References:

- learn.sources (source_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_alert_picks ON learn.alert_picks USING btree (client, email, source_id)`
- `CREATE INDEX ix_learn_alert_picks_source ON learn.alert_picks USING btree (source_id)`

## learn.alerts (table)

- `id integer = nextval('learn.alerts_id_seq'::regclass)`
- `client varchar(40)`
- `email varchar(320)`
- `item_id integer`
- `why varchar(8)`
- `state varchar(8)`
- `at timestamp with time zone = now()`
- `seen_at timestamp with time zone null`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_alerts ON learn.alerts USING btree (id)`
- `CREATE UNIQUE INDEX uq_learn_alerts_person_item ON learn.alerts USING btree (client, email, item_id)`
- `CREATE INDEX ix_learn_alerts_person_at ON learn.alerts USING btree (client, email, at)`
- `CREATE INDEX ix_learn_alerts_item ON learn.alerts USING btree (item_id)`

## learn.settings (table)

- `client varchar(40)`
- `digest_mail boolean = false`
- `by varchar(320) null`
- `at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_settings ON learn.settings USING btree (client)`

## learn.readers (table)

- `client varchar(40)`
- `email varchar(320)`
- `saved varchar(8) = 'top'::character varying`
- `mailed_on date null`

Indexes:

- `CREATE UNIQUE INDEX pk_readers ON learn.readers USING btree (client, email)`

## learn.breakdowns (table)

- `item_id integer`
- `hook_style varchar(16)`
- `hook text`
- `hook_why text`
- `topic text`
- `beats jsonb = '[]'::jsonb`
- `cta_kind varchar(12)`
- `cta text null`
- `created_at timestamp with time zone = now()`
- `kind varchar(8)`
- `facts jsonb = '{}'::jsonb`
- `by varchar(8) = 'model'::character varying`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_breakdowns ON learn.breakdowns USING btree (item_id)`
- `CREATE INDEX ix_learn_breakdowns_hook_style ON learn.breakdowns USING btree (hook_style)`
- `CREATE INDEX ix_learn_breakdowns_kind ON learn.breakdowns USING btree (kind)`

## learn.checks (table)

- `item_id integer`
- `sop text`
- `path text`
- `label text`
- `value text`
- `kind varchar(8)`
- `measure varchar(12)`
- `with_n integer`
- `with_median real`
- `all_n integer`
- `all_median real`
- `at timestamp with time zone = now()`

References:

- learn.items (item_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_checks ON learn.checks USING btree (item_id, sop, path, value)`
- `CREATE INDEX ix_learn_checks_sop ON learn.checks USING btree (sop)`

## learn.breakdown_records (view)

- `id integer null`
- `title text null`
- `creator text null`
- `source text null`
- `source_id integer null`
- `followed text null`
- `type text null`
- `kind text null`
- `hook_style text null`
- `hook text null`
- `hook_why text null`
- `topic text null`
- `format text null`
- `beats text null`
- `cta_kind text null`
- `cta text null`
- `likes integer null`
- `comments integer null`
- `views integer null`
- `reach integer null`
- `score integer null`
- `at timestamp with time zone null`
- `stats_at timestamp with time zone null`
- `open text null`
- `calls integer null`
- `called boolean null`
- `check text null`
- `check_why text null`

## learn.hook_records (view)

- `id text null`
- `style text null`
- `reels integer null`
- `creators integer null`
- `median_reach integer null`
- `top_reach integer null`
- `top text null`
- `top_creator text null`
- `last_at timestamp with time zone null`

## learn.standards (view)

- `id integer null`
- `kind text null`
- `platform text null`
- `creator text null`
- `title text null`
- `reach integer null`
- `at timestamp with time zone null`
- `by text null`
- `hook_style text null`
- `cta_kind text null`
- `format text null`
- `shape text null`
- `link text null`
- `chars integer null`
- `lines integer null`
- `first_line_chars integer null`
- `hashtags integer null`
- `duration_s numeric null`
- `cuts integer null`
- `shot_median_s numeric null`
- `shot_p90_s numeric null`
- `first_product_s numeric null`
- `logo_s numeric null`
- `cta_s numeric null`
- `cuts_trust text null`
- `music boolean null`
- `vo boolean null`
- `calls integer null`
