# books: schema

Tables and views: 29.

## books.accounts (table)

- `id integer = nextval('books.accounts_id_seq'::regclass)`
- `key varchar(64)`
- `name text`
- `type varchar(16)`
- `t2125_line varchar(8) null`
- `created_at timestamp with time zone = now()`
- `bucket varchar(16) null`
- `channel varchar(16) null`

Indexes:

- `CREATE UNIQUE INDEX pk_accounts ON books.accounts USING btree (id)`
- `CREATE UNIQUE INDEX uq_accounts_key ON books.accounts USING btree (key)`

## books.bill_documents (table)

- `bill_id integer`
- `document_id integer`

References:

- books.bills (bill_id → id)
- books.documents (document_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_bill_documents ON books.bill_documents USING btree (bill_id, document_id)`
- `CREATE INDEX ix_bill_documents_document_id ON books.bill_documents USING btree (document_id)`

## books.bill_lines (table)

- `id integer = nextval('books.bill_lines_id_seq'::regclass)`
- `bill_id integer`
- `position integer`
- `description text`
- `quantity text null`
- `unit_price text null`
- `amount_cents bigint`
- `period_start date null`
- `period_end date null`

References:

- books.bills (bill_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_bill_lines ON books.bill_lines USING btree (id)`
- `CREATE UNIQUE INDEX uq_bill_lines_position ON books.bill_lines USING btree (bill_id, "position")`

## books.bill_payments (table)

- `id integer = nextval('books.bill_payments_id_seq'::regclass)`
- `vendor_id integer`
- `invoice_number text null`
- `bill_id integer null`
- `paid_on date`
- `amount_cents bigint`
- `currency character(3)`
- `method text null`
- `reference text null`
- `key text`
- `document_id integer`
- `created_at timestamp with time zone = now()`

References:

- books.bills (bill_id → id)
- books.documents (document_id → id)
- books.vendors (vendor_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_bill_payments ON books.bill_payments USING btree (id)`
- `CREATE INDEX ix_bill_payments_bill_id ON books.bill_payments USING btree (bill_id)`
- `CREATE UNIQUE INDEX uq_bill_payments_key ON books.bill_payments USING btree (vendor_id, invoice_number, key) NULLS NOT DISTINCT`
- `CREATE INDEX ix_bill_payments_document_id ON books.bill_payments USING btree (document_id)`

## books.bill_taxes (table)

- `id integer = nextval('books.bill_taxes_id_seq'::regclass)`
- `bill_id integer`
- `position integer`
- `name text`
- `rate_percent numeric(7,4) null`
- `amount_cents bigint`
- `claimable boolean`
- `tax_number text null`

References:

- books.bills (bill_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_bill_taxes ON books.bill_taxes USING btree (id)`
- `CREATE UNIQUE INDEX uq_bill_taxes_position ON books.bill_taxes USING btree (bill_id, "position")`

## books.bills (table)

- `id integer = nextval('books.bills_id_seq'::regclass)`
- `vendor_id integer`
- `number text`
- `kind varchar(16)`
- `issued_on date`
- `due_on date null`
- `period_start date null`
- `period_end date null`
- `currency character(3)`
- `subtotal_cents bigint`
- `tax_cents bigint`
- `total_cents bigint`
- `charged_cad_cents bigint null`
- `plan text null`
- `cycle varchar(16) null`
- `payment_method text null`
- `billed_to text null`
- `vendor_tax_number text null`
- `account_id integer`
- `review varchar(16)`
- `review_reasons jsonb = '[]'::jsonb`
- `document_id integer`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

References:

- public.runs (run_id → id)
- books.accounts (account_id → id)
- books.documents (document_id → id)
- books.vendors (vendor_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_bills ON books.bills USING btree (id)`
- `CREATE UNIQUE INDEX uq_bills_vendor_number ON books.bills USING btree (vendor_id, number)`
- `CREATE INDEX ix_bills_issued_on ON books.bills USING btree (issued_on)`
- `CREATE INDEX ix_bills_run_id ON books.bills USING btree (run_id)`
- `CREATE INDEX ix_bills_document_id ON books.bills USING btree (document_id)`
- `CREATE INDEX ix_bills_account_id ON books.bills USING btree (account_id)`

## books.documents (table)

- `id integer = nextval('books.documents_id_seq'::regclass)`
- `sha256 character(64)`
- `media_type varchar(128)`
- `size integer`
- `store_key text`
- `source varchar(16)`
- `parent_id integer null`
- `filename text null`
- `mailbox text null`
- `mailbox_key text null`
- `message_id text null`
- `from_address text null`
- `from_name text null`
- `subject text null`
- `sent_at timestamp with time zone null`
- `vendor_id integer null`
- `text text null`
- `kind varchar(16) null`
- `read_at timestamp with time zone null`
- `reading jsonb null`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`

References:

- public.runs (run_id → id)
- books.documents (parent_id → id)
- books.vendors (vendor_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_documents ON books.documents USING btree (id)`
- `CREATE UNIQUE INDEX uq_documents_sha256 ON books.documents USING btree (sha256)`
- `CREATE UNIQUE INDEX uq_documents_mailbox_key ON books.documents USING btree (mailbox, mailbox_key)`
- `CREATE INDEX ix_documents_parent_id ON books.documents USING btree (parent_id)`
- `CREATE INDEX ix_documents_vendor_id ON books.documents USING btree (vendor_id)`
- `CREATE INDEX ix_documents_run_id ON books.documents USING btree (run_id)`

## books.entries (table)

- `id integer = nextval('books.entries_id_seq'::regclass)`
- `posted_on date`
- `memo text`
- `bill_id integer null`
- `reverses_id integer null`
- `run_id uuid null`
- `created_at timestamp with time zone = now()`

References:

- public.runs (run_id → id)
- books.bills (bill_id → id)
- books.entries (reverses_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_entries ON books.entries USING btree (id)`
- `CREATE UNIQUE INDEX uq_entries_reverses_id ON books.entries USING btree (reverses_id)`
- `CREATE INDEX ix_entries_bill_id ON books.entries USING btree (bill_id)`
- `CREATE INDEX ix_entries_posted_on ON books.entries USING btree (posted_on)`
- `CREATE INDEX ix_entries_run_id ON books.entries USING btree (run_id)`

## books.lines (table)

- `id integer = nextval('books.lines_id_seq'::regclass)`
- `entry_id integer`
- `account_id integer`
- `cad_cents bigint`
- `amount_cents bigint`
- `currency character(3)`
- `rate numeric(18,8)`
- `rate_source varchar(16)`
- `memo text null`

References:

- books.accounts (account_id → id)
- books.entries (entry_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_lines ON books.lines USING btree (id)`
- `CREATE INDEX ix_lines_entry_id ON books.lines USING btree (entry_id)`
- `CREATE INDEX ix_lines_account_id ON books.lines USING btree (account_id)`

## books.rates (table)

- `on date`
- `currency character(3)`
- `source varchar(16)`
- `cad_per_unit numeric(18,8)`
- `created_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_rates ON books.rates USING btree ("on", currency, source)`

## books.vendors (table)

- `id integer = nextval('books.vendors_id_seq'::regclass)`
- `key varchar(64)`
- `name text`
- `account_id integer`
- `cycle varchar(16) null`
- `gst_claimable boolean null`
- `created_at timestamp with time zone = now()`

References:

- books.accounts (account_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_vendors ON books.vendors USING btree (id)`
- `CREATE UNIQUE INDEX uq_vendors_key ON books.vendors USING btree (key)`
- `CREATE INDEX ix_vendors_account_id ON books.vendors USING btree (account_id)`

## books.bill_costs (view)

- `bill_id integer null`
- `vendor_id integer null`
- `vendor varchar(64) null`
- `vendor_name text null`
- `number text null`
- `kind varchar(16) null`
- `issued_on date null`
- `period_start date null`
- `period_end date null`
- `currency character(3) null`
- `total_cents bigint null`
- `tax_cents bigint null`
- `plan text null`
- `cycle varchar(16) null`
- `review varchar(16) null`
- `account varchar(64) null`
- `entry_id integer null`
- `cad_cents bigint null`
- `cost_cad_cents bigint null`
- `paid_cents bigint null`

## books.spend (view)

- `month date null`
- `account varchar(64) null`
- `account_name text null`
- `t2125_line varchar(8) null`
- `vendor varchar(64) null`
- `vendor_name text null`
- `cad_cents bigint null`

## books.subscriptions (view)

- `vendor_id integer null`
- `vendor varchar(64) null`
- `vendor_name text null`
- `plan text null`
- `cycle varchar(16) null`
- `currency character(3) null`
- `last_total_cents bigint null`
- `last_cad_cents bigint null`
- `last_billed_on date null`
- `renews_on date null`
- `monthly_cad_cents bigint null`
- `since date null`
- `bills integer null`

## books.alerts (table)

- `key text`
- `kind varchar(32)`
- `message text`
- `raised_at timestamp with time zone = now()`
- `cleared_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX pk_alerts ON books.alerts USING btree (key)`
- `CREATE INDEX ix_alerts_open ON books.alerts USING btree (kind) WHERE (cleared_at IS NULL)`

## books.usage (table)

- `on date`
- `provider varchar(16)`
- `service text`
- `currency character(3)`
- `amount numeric(18,6)`
- `fetched_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_usage ON books.usage USING btree ("on", provider, service)`

## books.usage_by_month (view)

- `month date null`
- `provider varchar(16) null`
- `service text null`
- `currency character(3) null`
- `amount numeric null`

## books.spend_records (view)

- `id text null`
- `month date null`
- `account text null`
- `t2125_line text null`
- `vendor text null`
- `amount numeric null`
- `currency text null`
- `age text null`

## books.econ_paid (view)

- `invoice_id integer null`
- `engagement_id integer null`
- `client_id text null`
- `paid_on date null`
- `month date null`
- `setup boolean null`
- `period text null`
- `cad_cents bigint null`
- `mrr_cents bigint null`

## books.econ_client_months (view)

- `client_id text null`
- `month date null`
- `first_month date null`
- `channel text null`
- `is_new boolean null`
- `paying boolean null`
- `churned boolean null`
- `revenue_cents bigint null`
- `mrr_cents bigint null`
- `kept_cents bigint null`

## books.econ_months (view)

- `id text null`
- `month date null`
- `latest boolean null`
- `currency text null`
- `spend numeric null`
- `acquisition numeric null`
- `delivery numeric null`
- `overhead numeric null`
- `revenue numeric null`
- `mrr numeric null`
- `paying integer null`
- `paying_start integer null`
- `new_clients integer null`
- `churned integer null`
- `arpa numeric null`
- `arpa_3 numeric null`
- `gross_margin numeric null`
- `cac_3 numeric null`
- `cac_6 numeric null`
- `cac_12 numeric null`
- `logo_churn numeric null`
- `revenue_churn numeric null`
- `ltv numeric null`
- `ltv_cac numeric null`
- `payback numeric null`
- `realized_ltv numeric null`
- `realized_ltv_all numeric null`

## books.econ_cohorts (view)

- `id text null`
- `cohort date null`
- `months_since integer null`
- `currency text null`
- `clients integer null`
- `paying integer null`
- `still_paying numeric null`
- `revenue numeric null`
- `revenue_kept numeric null`

## books.subscription_records (view)

- `id text null`
- `vendor text null`
- `plan text null`
- `cycle text null`
- `cost numeric null`
- `currency text null`
- `monthly numeric null`
- `cad text null`
- `last_billed_on date null`
- `renews_on date null`
- `renewal text null`
- `since date null`
- `bills integer null`
- `billed_for text null`

## books.econ_channels (view)

- `id text null`
- `channel text null`
- `month date null`
- `latest boolean null`
- `currency text null`
- `spend numeric null`
- `leads integer null`
- `sends integer null`
- `replies integer null`
- `interested integer null`
- `booked integer null`
- `new_clients integer null`
- `per_lead numeric null`
- `per_send numeric null`
- `per_reply numeric null`
- `per_interested numeric null`
- `per_booked numeric null`
- `cac_3 numeric null`
- `cac_6 numeric null`
- `cac_12 numeric null`

## books.usage_lines (table)

- `id integer = nextval('books.usage_lines_id_seq'::regclass)`
- `client varchar(40) null`
- `vendor varchar(32)`
- `month date`
- `units bigint`
- `cost_cents bigint`
- `markup_pct integer`
- `amount_cents bigint`
- `currency character(3) = 'USD'::bpchar`
- `state varchar(12) = 'draft'::character varying`
- `computed_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX pk_usage_lines ON books.usage_lines USING btree (id)`
- `CREATE UNIQUE INDEX uq_usage_lines_month ON books.usage_lines USING btree (client, vendor, month) NULLS NOT DISTINCT`
- `CREATE INDEX ix_usage_lines_month ON books.usage_lines USING btree (month)`

## books.card_lines (table)

- `id integer = nextval('books.card_lines_id_seq'::regclass)`
- `card varchar(4)`
- `on date`
- `description text`
- `descriptor text`
- `amount_cents bigint`
- `currency character(3)`
- `source varchar(16)`
- `fingerprint text`
- `document_id integer`
- `vendor_id integer null`
- `personal boolean = false`
- `bill_id integer null`
- `created_at timestamp with time zone = now()`

References:

- books.bills (bill_id → id)
- books.documents (document_id → id)
- books.vendors (vendor_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_card_lines ON books.card_lines USING btree (id)`
- `CREATE UNIQUE INDEX uq_card_lines_fingerprint ON books.card_lines USING btree (fingerprint)`
- `CREATE INDEX ix_card_lines_document_id ON books.card_lines USING btree (document_id)`
- `CREATE INDEX ix_card_lines_vendor_id ON books.card_lines USING btree (vendor_id)`
- `CREATE INDEX ix_card_lines_bill_id ON books.card_lines USING btree (bill_id)`
- `CREATE INDEX ix_card_lines_on ON books.card_lines USING btree ("on")`

## books.card_rules (table)

- `descriptor text`
- `vendor_id integer null`
- `personal boolean = false`
- `created_at timestamp with time zone = now()`

References:

- books.vendors (vendor_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_card_rules ON books.card_rules USING btree (descriptor)`
- `CREATE INDEX ix_card_rules_vendor_id ON books.card_rules USING btree (vendor_id)`

## books.subscription_ends (table)

- `vendor_id integer`
- `plan text = ''::text`
- `ended_on date`
- `created_at timestamp with time zone = now()`

References:

- books.vendors (vendor_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_subscription_ends ON books.subscription_ends USING btree (vendor_id, plan)`

## books.card_records (view)

- `id integer null`
- `on date null`
- `description text null`
- `descriptor text null`
- `amount numeric null`
- `currency text null`
- `card text null`
- `vendor text null`
- `state text null`
- `bill text null`
- `source text null`
