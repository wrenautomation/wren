# books: schema

Tables and views: 29.

## books.accounts (table)

- `bucket varchar(16) null`
- `channel varchar(16) null`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('books.accounts_id_seq'::regclass)`
- `key varchar(64)`
- `name text`
- `t2125_line varchar(8) null`
- `type varchar(16)`

Indexes:

- `CREATE UNIQUE INDEX pk_accounts ON books.accounts USING btree (id)`
- `CREATE UNIQUE INDEX uq_accounts_key ON books.accounts USING btree (key)`

## books.alerts (table)

- `cleared_at timestamp with time zone null`
- `key text`
- `kind varchar(32)`
- `message text`
- `raised_at timestamp with time zone = now()`

Indexes:

- `CREATE INDEX ix_alerts_open ON books.alerts USING btree (kind) WHERE (cleared_at IS NULL)`
- `CREATE UNIQUE INDEX pk_alerts ON books.alerts USING btree (key)`

## books.bill_costs (view)

- `account varchar(64) null`
- `bill_id integer null`
- `cad_cents bigint null`
- `cost_cad_cents bigint null`
- `currency character(3) null`
- `cycle varchar(16) null`
- `entry_id integer null`
- `issued_on date null`
- `kind varchar(16) null`
- `number text null`
- `paid_cents bigint null`
- `period_end date null`
- `period_start date null`
- `plan text null`
- `review varchar(16) null`
- `tax_cents bigint null`
- `total_cents bigint null`
- `vendor varchar(64) null`
- `vendor_id integer null`
- `vendor_name text null`

## books.bill_documents (table)

- `bill_id integer`
- `document_id integer`

References:

- books.bills (bill_id → id)
- books.documents (document_id → id)

Indexes:

- `CREATE INDEX ix_bill_documents_document_id ON books.bill_documents USING btree (document_id)`
- `CREATE UNIQUE INDEX pk_bill_documents ON books.bill_documents USING btree (bill_id, document_id)`

## books.bill_lines (table)

- `amount_cents bigint`
- `bill_id integer`
- `description text`
- `id integer = nextval('books.bill_lines_id_seq'::regclass)`
- `period_end date null`
- `period_start date null`
- `position integer`
- `quantity text null`
- `unit_price text null`

References:

- books.bills (bill_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_bill_lines ON books.bill_lines USING btree (id)`
- `CREATE UNIQUE INDEX uq_bill_lines_position ON books.bill_lines USING btree (bill_id, "position")`

## books.bill_payments (table)

- `amount_cents bigint`
- `bill_id integer null`
- `created_at timestamp with time zone = now()`
- `currency character(3)`
- `document_id integer`
- `id integer = nextval('books.bill_payments_id_seq'::regclass)`
- `invoice_number text null`
- `key text`
- `method text null`
- `paid_on date`
- `reference text null`
- `vendor_id integer`

References:

- books.bills (bill_id → id)
- books.documents (document_id → id)
- books.vendors (vendor_id → id)

Indexes:

- `CREATE INDEX ix_bill_payments_bill_id ON books.bill_payments USING btree (bill_id)`
- `CREATE INDEX ix_bill_payments_document_id ON books.bill_payments USING btree (document_id)`
- `CREATE UNIQUE INDEX pk_bill_payments ON books.bill_payments USING btree (id)`
- `CREATE UNIQUE INDEX uq_bill_payments_key ON books.bill_payments USING btree (vendor_id, invoice_number, key) NULLS NOT DISTINCT`

## books.bill_taxes (table)

- `amount_cents bigint`
- `bill_id integer`
- `claimable boolean`
- `id integer = nextval('books.bill_taxes_id_seq'::regclass)`
- `name text`
- `position integer`
- `rate_percent numeric(7,4) null`
- `tax_number text null`

References:

- books.bills (bill_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_bill_taxes ON books.bill_taxes USING btree (id)`
- `CREATE UNIQUE INDEX uq_bill_taxes_position ON books.bill_taxes USING btree (bill_id, "position")`

## books.bills (table)

- `account_id integer`
- `billed_to text null`
- `charged_cad_cents bigint null`
- `created_at timestamp with time zone = now()`
- `currency character(3)`
- `cycle varchar(16) null`
- `document_id integer`
- `due_on date null`
- `id integer = nextval('books.bills_id_seq'::regclass)`
- `issued_on date`
- `kind varchar(16)`
- `number text`
- `payment_method text null`
- `period_end date null`
- `period_start date null`
- `plan text null`
- `review varchar(16)`
- `review_reasons jsonb = '[]'::jsonb`
- `run_id uuid null`
- `subtotal_cents bigint`
- `tax_cents bigint`
- `total_cents bigint`
- `updated_at timestamp with time zone = now()`
- `vendor_id integer`
- `vendor_tax_number text null`

References:

- books.accounts (account_id → id)
- books.documents (document_id → id)
- books.vendors (vendor_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_bills_account_id ON books.bills USING btree (account_id)`
- `CREATE INDEX ix_bills_document_id ON books.bills USING btree (document_id)`
- `CREATE INDEX ix_bills_issued_on ON books.bills USING btree (issued_on)`
- `CREATE INDEX ix_bills_run_id ON books.bills USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_bills ON books.bills USING btree (id)`
- `CREATE UNIQUE INDEX uq_bills_vendor_number ON books.bills USING btree (vendor_id, number)`

## books.card_lines (table)

- `amount_cents bigint`
- `bill_id integer null`
- `card varchar(4)`
- `created_at timestamp with time zone = now()`
- `currency character(3)`
- `description text`
- `descriptor text`
- `document_id integer`
- `fingerprint text`
- `id integer = nextval('books.card_lines_id_seq'::regclass)`
- `on date`
- `personal boolean = false`
- `source varchar(16)`
- `vendor_id integer null`

References:

- books.bills (bill_id → id)
- books.documents (document_id → id)
- books.vendors (vendor_id → id)

Indexes:

- `CREATE INDEX ix_card_lines_bill_id ON books.card_lines USING btree (bill_id)`
- `CREATE INDEX ix_card_lines_document_id ON books.card_lines USING btree (document_id)`
- `CREATE INDEX ix_card_lines_on ON books.card_lines USING btree ("on")`
- `CREATE INDEX ix_card_lines_vendor_id ON books.card_lines USING btree (vendor_id)`
- `CREATE UNIQUE INDEX pk_card_lines ON books.card_lines USING btree (id)`
- `CREATE UNIQUE INDEX uq_card_lines_fingerprint ON books.card_lines USING btree (fingerprint)`

## books.card_records (view)

- `amount numeric null`
- `bill text null`
- `card text null`
- `currency text null`
- `description text null`
- `descriptor text null`
- `id integer null`
- `on date null`
- `source text null`
- `state text null`
- `vendor text null`

## books.card_rules (table)

- `created_at timestamp with time zone = now()`
- `descriptor text`
- `personal boolean = false`
- `vendor_id integer null`

References:

- books.vendors (vendor_id → id)

Indexes:

- `CREATE INDEX ix_card_rules_vendor_id ON books.card_rules USING btree (vendor_id)`
- `CREATE UNIQUE INDEX pk_card_rules ON books.card_rules USING btree (descriptor)`

## books.documents (table)

- `created_at timestamp with time zone = now()`
- `filename text null`
- `from_address text null`
- `from_name text null`
- `id integer = nextval('books.documents_id_seq'::regclass)`
- `kind varchar(16) null`
- `mailbox text null`
- `mailbox_key text null`
- `media_type varchar(128)`
- `message_id text null`
- `parent_id integer null`
- `read_at timestamp with time zone null`
- `reading jsonb null`
- `run_id uuid null`
- `sent_at timestamp with time zone null`
- `sha256 character(64)`
- `size integer`
- `source varchar(16)`
- `store_key text`
- `subject text null`
- `text text null`
- `vendor_id integer null`

References:

- books.documents (parent_id → id)
- books.vendors (vendor_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_documents_parent_id ON books.documents USING btree (parent_id)`
- `CREATE INDEX ix_documents_run_id ON books.documents USING btree (run_id)`
- `CREATE INDEX ix_documents_vendor_id ON books.documents USING btree (vendor_id)`
- `CREATE UNIQUE INDEX pk_documents ON books.documents USING btree (id)`
- `CREATE UNIQUE INDEX uq_documents_mailbox_key ON books.documents USING btree (mailbox, mailbox_key)`
- `CREATE UNIQUE INDEX uq_documents_sha256 ON books.documents USING btree (sha256)`

## books.econ_channels (view)

- `booked integer null`
- `cac_12 numeric null`
- `cac_3 numeric null`
- `cac_6 numeric null`
- `channel text null`
- `currency text null`
- `id text null`
- `interested integer null`
- `latest boolean null`
- `leads integer null`
- `month date null`
- `new_clients integer null`
- `per_booked numeric null`
- `per_interested numeric null`
- `per_lead numeric null`
- `per_reply numeric null`
- `per_send numeric null`
- `replies integer null`
- `sends integer null`
- `spend numeric null`

## books.econ_client_months (view)

- `channel text null`
- `churned boolean null`
- `client_id text null`
- `first_month date null`
- `is_new boolean null`
- `kept_cents bigint null`
- `month date null`
- `mrr_cents bigint null`
- `paying boolean null`
- `revenue_cents bigint null`

## books.econ_cohorts (view)

- `clients integer null`
- `cohort date null`
- `currency text null`
- `id text null`
- `months_since integer null`
- `paying integer null`
- `revenue numeric null`
- `revenue_kept numeric null`
- `still_paying numeric null`

## books.econ_months (view)

- `acquisition numeric null`
- `arpa numeric null`
- `arpa_3 numeric null`
- `cac_12 numeric null`
- `cac_3 numeric null`
- `cac_6 numeric null`
- `churned integer null`
- `currency text null`
- `delivery numeric null`
- `gross_margin numeric null`
- `id text null`
- `latest boolean null`
- `logo_churn numeric null`
- `ltv numeric null`
- `ltv_cac numeric null`
- `month date null`
- `mrr numeric null`
- `new_clients integer null`
- `overhead numeric null`
- `payback numeric null`
- `paying integer null`
- `paying_start integer null`
- `realized_ltv numeric null`
- `realized_ltv_all numeric null`
- `revenue numeric null`
- `revenue_churn numeric null`
- `spend numeric null`

## books.econ_paid (view)

- `cad_cents bigint null`
- `client_id text null`
- `engagement_id integer null`
- `invoice_id integer null`
- `month date null`
- `mrr_cents bigint null`
- `paid_on date null`
- `period text null`
- `setup boolean null`

## books.entries (table)

- `bill_id integer null`
- `created_at timestamp with time zone = now()`
- `id integer = nextval('books.entries_id_seq'::regclass)`
- `memo text`
- `posted_on date`
- `reverses_id integer null`
- `run_id uuid null`

References:

- books.bills (bill_id → id)
- books.entries (reverses_id → id)
- public.runs (run_id → id)

Indexes:

- `CREATE INDEX ix_entries_bill_id ON books.entries USING btree (bill_id)`
- `CREATE INDEX ix_entries_posted_on ON books.entries USING btree (posted_on)`
- `CREATE INDEX ix_entries_run_id ON books.entries USING btree (run_id)`
- `CREATE UNIQUE INDEX pk_entries ON books.entries USING btree (id)`
- `CREATE UNIQUE INDEX uq_entries_reverses_id ON books.entries USING btree (reverses_id)`

## books.lines (table)

- `account_id integer`
- `amount_cents bigint`
- `cad_cents bigint`
- `currency character(3)`
- `entry_id integer`
- `id integer = nextval('books.lines_id_seq'::regclass)`
- `memo text null`
- `rate numeric(18,8)`
- `rate_source varchar(16)`

References:

- books.accounts (account_id → id)
- books.entries (entry_id → id)

Indexes:

- `CREATE INDEX ix_lines_account_id ON books.lines USING btree (account_id)`
- `CREATE INDEX ix_lines_entry_id ON books.lines USING btree (entry_id)`
- `CREATE UNIQUE INDEX pk_lines ON books.lines USING btree (id)`

## books.rates (table)

- `cad_per_unit numeric(18,8)`
- `created_at timestamp with time zone = now()`
- `currency character(3)`
- `on date`
- `source varchar(16)`

Indexes:

- `CREATE UNIQUE INDEX pk_rates ON books.rates USING btree ("on", currency, source)`

## books.spend (view)

- `account varchar(64) null`
- `account_name text null`
- `cad_cents bigint null`
- `month date null`
- `t2125_line varchar(8) null`
- `vendor varchar(64) null`
- `vendor_name text null`

## books.spend_records (view)

- `account text null`
- `age text null`
- `amount numeric null`
- `currency text null`
- `id text null`
- `month date null`
- `t2125_line text null`
- `vendor text null`

## books.subscription_ends (table)

- `created_at timestamp with time zone = now()`
- `ended_on date`
- `plan text = ''::text`
- `vendor_id integer`

References:

- books.vendors (vendor_id → id)

Indexes:

- `CREATE UNIQUE INDEX pk_subscription_ends ON books.subscription_ends USING btree (vendor_id, plan)`

## books.subscription_records (view)

- `billed_for text null`
- `bills integer null`
- `cad text null`
- `cost numeric null`
- `currency text null`
- `cycle text null`
- `id text null`
- `last_billed_on date null`
- `monthly numeric null`
- `plan text null`
- `renewal text null`
- `renews_on date null`
- `since date null`
- `vendor text null`

## books.subscriptions (view)

- `bills integer null`
- `currency character(3) null`
- `cycle varchar(16) null`
- `last_billed_on date null`
- `last_cad_cents bigint null`
- `last_total_cents bigint null`
- `monthly_cad_cents bigint null`
- `plan text null`
- `renews_on date null`
- `since date null`
- `vendor varchar(64) null`
- `vendor_id integer null`
- `vendor_name text null`

## books.usage (table)

- `amount numeric(18,6)`
- `currency character(3)`
- `fetched_at timestamp with time zone = now()`
- `on date`
- `provider varchar(16)`
- `service text`

Indexes:

- `CREATE UNIQUE INDEX pk_usage ON books.usage USING btree ("on", provider, service)`

## books.usage_by_month (view)

- `amount numeric null`
- `currency character(3) null`
- `month date null`
- `provider varchar(16) null`
- `service text null`

## books.usage_lines (table)

- `amount_cents bigint`
- `client varchar(40) null`
- `computed_at timestamp with time zone = now()`
- `cost_cents bigint`
- `currency character(3) = 'USD'::bpchar`
- `id integer = nextval('books.usage_lines_id_seq'::regclass)`
- `markup_pct integer`
- `month date`
- `state varchar(12) = 'draft'::character varying`
- `units bigint`
- `vendor varchar(32)`

Indexes:

- `CREATE INDEX ix_usage_lines_month ON books.usage_lines USING btree (month)`
- `CREATE UNIQUE INDEX pk_usage_lines ON books.usage_lines USING btree (id)`
- `CREATE UNIQUE INDEX uq_usage_lines_month ON books.usage_lines USING btree (client, vendor, month) NULLS NOT DISTINCT`

## books.vendors (table)

- `account_id integer`
- `created_at timestamp with time zone = now()`
- `cycle varchar(16) null`
- `gst_claimable boolean null`
- `id integer = nextval('books.vendors_id_seq'::regclass)`
- `key varchar(64)`
- `name text`

References:

- books.accounts (account_id → id)

Indexes:

- `CREATE INDEX ix_vendors_account_id ON books.vendors USING btree (account_id)`
- `CREATE UNIQUE INDEX pk_vendors ON books.vendors USING btree (id)`
- `CREATE UNIQUE INDEX uq_vendors_key ON books.vendors USING btree (key)`
