# watch: schema

Tables and views: 5.

## watch.mail (table)

- `at timestamp with time zone`
- `created_at timestamp with time zone = now()`
- `done_at timestamp with time zone null`
- `from_address varchar(320)`
- `from_name text`
- `id integer = nextval('watch.mail_id_seq'::regclass)`
- `link text null`
- `mailbox varchar(320)`
- `message_id varchar(255)`
- `reader varchar(8) = 'monitor'::character varying`
- `rule_id integer null`
- `snippet text null`
- `subject text`
- `summary text null`
- `thread_id varchar(255)`
- `verdict varchar(8) null`
- `why text null`

References:

- watch.rules (rule_id → id)

Indexes:

- `CREATE INDEX ix_watch_mail_at ON watch.mail USING btree (at)`
- `CREATE INDEX ix_watch_mail_from ON watch.mail USING btree (from_address)`
- `CREATE INDEX ix_watch_mail_rule ON watch.mail USING btree (rule_id)`
- `CREATE UNIQUE INDEX pk_mail ON watch.mail USING btree (id)`
- `CREATE UNIQUE INDEX uq_watch_mail_message ON watch.mail USING btree (mailbox, message_id)`

## watch.mail_records (view)

- `at timestamp with time zone null`
- `from_address text null`
- `held integer null`
- `id integer null`
- `mailbox varchar(320) null`
- `open text null`
- `others text null`
- `queue text null`
- `sender text null`
- `subject text null`
- `summary text null`
- `verdict text null`
- `why text null`

## watch.mail_sent (table)

- `body text`
- `by varchar(320)`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('watch.mail_sent_id_seq'::regclass)`
- `mail_id integer`
- `mailbox varchar(320)`
- `ours varchar(320)`
- `provider_id varchar(255) null`
- `sent_at timestamp with time zone null`
- `state varchar(8) = 'sending'::character varying`
- `subject text`
- `thread_id varchar(255)`
- `to_address varchar(320)`
- `why text null`

References:

- watch.mail (mail_id → id)

Indexes:

- `CREATE INDEX ix_watch_mail_sent_mail ON watch.mail_sent USING btree (mail_id)`
- `CREATE INDEX ix_watch_mail_sent_thread ON watch.mail_sent USING btree (mailbox, thread_id)`
- `CREATE UNIQUE INDEX pk_mail_sent ON watch.mail_sent USING btree (id)`

## watch.rule_records (view)

- `by text null`
- `created_at timestamp with time zone null`
- `id integer null`
- `sender text null`
- `settles text null`
- `subject text null`
- `verdict text null`
- `words text null`

## watch.rules (table)

- `by varchar(320) null`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('watch.rules_id_seq'::regclass)`
- `sender varchar(320) null`
- `subject text null`
- `verdict varchar(8) null`
- `words text`

Indexes:

- `CREATE UNIQUE INDEX pk_rules ON watch.rules USING btree (id)`
