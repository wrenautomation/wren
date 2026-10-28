# watch: schema

Tables and views: 5.

## watch.mail (table)

- `id integer = nextval('watch.mail_id_seq'::regclass)`
- `mailbox varchar(320)`
- `message_id varchar(255)`
- `thread_id varchar(255)`
- `from_name text`
- `from_address varchar(320)`
- `subject text`
- `snippet text null`
- `at timestamp with time zone`
- `verdict varchar(8) null`
- `why text null`
- `summary text null`
- `rule_id integer null`
- `done_at timestamp with time zone null`
- `created_at timestamp with time zone = now()`
- `link text null`
- `reader varchar(8) = 'monitor'::character varying`

References:

- watch.rules (rule_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_mail ON watch.mail USING btree (id)`
- `CREATE INDEX ix_watch_mail_from ON watch.mail USING btree (from_address)`
- `CREATE INDEX ix_watch_mail_at ON watch.mail USING btree (at)`
- `CREATE INDEX ix_watch_mail_rule ON watch.mail USING btree (rule_id)`
- `CREATE UNIQUE INDEX uq_watch_mail_message ON watch.mail USING btree (mailbox, message_id)`

## watch.rules (table)

- `id integer = nextval('watch.rules_id_seq'::regclass)`
- `words text`
- `sender varchar(320) null`
- `subject text null`
- `verdict varchar(8) null`
- `by varchar(320) null`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_rules ON watch.rules USING btree (id)`

## watch.rule_records (view)

- `id integer null`
- `words text null`
- `sender text null`
- `subject text null`
- `verdict text null`
- `settles text null`
- `by text null`
- `created_at timestamp with time zone null`

## watch.mail_records (view)

- `id integer null`
- `mailbox varchar(320) null`
- `sender text null`
- `from_address text null`
- `subject text null`
- `summary text null`
- `verdict text null`
- `why text null`
- `queue text null`
- `at timestamp with time zone null`
- `open text null`
- `held integer null`
- `others text null`

## watch.mail_sent (table)

- `id integer = nextval('watch.mail_sent_id_seq'::regclass)`
- `mail_id integer`
- `mailbox varchar(320)`
- `thread_id varchar(255)`
- `to_address varchar(320)`
- `subject text`
- `body text`
- `ours varchar(320)`
- `provider_id varchar(255) null`
- `state varchar(8) = 'sending'::character varying`
- `why text null`
- `by varchar(320)`
- `created_at timestamp with time zone = now()`
- `sent_at timestamp with time zone null`

References:

- watch.mail (mail_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_mail_sent ON watch.mail_sent USING btree (id)`
- `CREATE INDEX ix_watch_mail_sent_thread ON watch.mail_sent USING btree (mailbox, thread_id)`
- `CREATE INDEX ix_watch_mail_sent_mail ON watch.mail_sent USING btree (mail_id)`
