CREATE SCHEMA "books";
--> statement-breakpoint
CREATE TABLE "books"."accounts" (
	"id" serial NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"type" varchar(16) NOT NULL,
	"t2125_line" varchar(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_accounts" PRIMARY KEY("id"),
	CONSTRAINT "uq_accounts_key" UNIQUE("key"),
	CONSTRAINT "ck_accounts_type" CHECK (("type")::text = ANY ((ARRAY['asset'::character varying, 'liability'::character varying, 'equity'::character varying, 'income'::character varying, 'expense'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "books"."bill_documents" (
	"bill_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	CONSTRAINT "pk_bill_documents" PRIMARY KEY("bill_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "books"."bill_lines" (
	"id" serial NOT NULL,
	"bill_id" integer NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" text,
	"unit_price" text,
	"amount_cents" bigint NOT NULL,
	"period_start" date,
	"period_end" date,
	CONSTRAINT "pk_bill_lines" PRIMARY KEY("id"),
	CONSTRAINT "uq_bill_lines_position" UNIQUE("bill_id","position")
);
--> statement-breakpoint
CREATE TABLE "books"."bill_payments" (
	"id" serial NOT NULL,
	"vendor_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"bill_id" integer,
	"paid_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"method" text,
	"reference" text,
	"key" text NOT NULL,
	"document_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_bill_payments" PRIMARY KEY("id"),
	CONSTRAINT "uq_bill_payments_key" UNIQUE("vendor_id","invoice_number","key")
);
--> statement-breakpoint
CREATE TABLE "books"."bill_taxes" (
	"id" serial NOT NULL,
	"bill_id" integer NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"rate_percent" numeric(7, 4),
	"amount_cents" bigint NOT NULL,
	"claimable" boolean NOT NULL,
	"tax_number" text,
	CONSTRAINT "pk_bill_taxes" PRIMARY KEY("id"),
	CONSTRAINT "uq_bill_taxes_position" UNIQUE("bill_id","position")
);
--> statement-breakpoint
CREATE TABLE "books"."bills" (
	"id" serial NOT NULL,
	"vendor_id" integer NOT NULL,
	"number" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date,
	"period_start" date,
	"period_end" date,
	"currency" char(3) NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"charged_cad_cents" bigint,
	"plan" text,
	"cycle" varchar(16),
	"payment_method" text,
	"billed_to" text,
	"vendor_tax_number" text,
	"account_id" integer NOT NULL,
	"review" varchar(16) NOT NULL,
	"review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_id" integer NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_bills" PRIMARY KEY("id"),
	CONSTRAINT "uq_bills_vendor_number" UNIQUE("vendor_id","number"),
	CONSTRAINT "ck_bills_kind" CHECK (("kind")::text = ANY ((ARRAY['invoice'::character varying, 'receipt'::character varying, 'credit_note'::character varying])::text[])),
	CONSTRAINT "ck_bills_cycle" CHECK (("cycle")::text = ANY ((ARRAY['monthly'::character varying, 'yearly'::character varying, 'usage'::character varying, 'once'::character varying])::text[])),
	CONSTRAINT "ck_bills_review" CHECK (("review")::text = ANY ((ARRAY['ok'::character varying, 'needs_review'::character varying, 'accepted'::character varying, 'personal'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "books"."documents" (
	"id" serial NOT NULL,
	"sha256" char(64) NOT NULL,
	"media_type" varchar(128) NOT NULL,
	"size" integer NOT NULL,
	"store_key" text NOT NULL,
	"source" varchar(16) NOT NULL,
	"parent_id" integer,
	"filename" text,
	"mailbox" text,
	"mailbox_key" text,
	"message_id" text,
	"from_address" text,
	"from_name" text,
	"subject" text,
	"sent_at" timestamp with time zone,
	"vendor_id" integer,
	"text" text,
	"kind" varchar(16),
	"read_at" timestamp with time zone,
	"reading" jsonb,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_documents" PRIMARY KEY("id"),
	CONSTRAINT "uq_documents_sha256" UNIQUE("sha256"),
	CONSTRAINT "uq_documents_mailbox_key" UNIQUE("mailbox","mailbox_key"),
	CONSTRAINT "ck_documents_source" CHECK (("source")::text = ANY ((ARRAY['mailbox'::character varying, 'file'::character varying, 'attachment'::character varying])::text[])),
	CONSTRAINT "ck_documents_kind" CHECK (("kind")::text = ANY ((ARRAY['bill'::character varying, 'payment'::character varying, 'notice'::character varying, 'other'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "books"."entries" (
	"id" serial NOT NULL,
	"posted_on" date NOT NULL,
	"memo" text NOT NULL,
	"bill_id" integer,
	"reverses_id" integer,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_entries" PRIMARY KEY("id"),
	CONSTRAINT "uq_entries_reverses_id" UNIQUE("reverses_id")
);
--> statement-breakpoint
CREATE TABLE "books"."lines" (
	"id" serial NOT NULL,
	"entry_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"cad_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"rate_source" varchar(16) NOT NULL,
	"memo" text,
	CONSTRAINT "pk_lines" PRIMARY KEY("id"),
	CONSTRAINT "ck_lines_rate_source" CHECK (("rate_source")::text = ANY ((ARRAY['same'::character varying, 'boc'::character varying, 'stated'::character varying, 'card'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "books"."rates" (
	"on" date NOT NULL,
	"currency" char(3) NOT NULL,
	"source" varchar(16) NOT NULL,
	"cad_per_unit" numeric(18, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_rates" PRIMARY KEY("on","currency","source"),
	CONSTRAINT "ck_rates_source" CHECK (("source")::text = ANY ((ARRAY['same'::character varying, 'boc'::character varying, 'stated'::character varying, 'card'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "books"."vendors" (
	"id" serial NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"account_id" integer NOT NULL,
	"cycle" varchar(16),
	"gst_claimable" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_vendors" PRIMARY KEY("id"),
	CONSTRAINT "uq_vendors_key" UNIQUE("key"),
	CONSTRAINT "ck_vendors_cycle" CHECK (("cycle")::text = ANY ((ARRAY['monthly'::character varying, 'yearly'::character varying, 'usage'::character varying, 'once'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "books"."bill_documents" ADD CONSTRAINT "fk_bill_documents_bill_id_bills" FOREIGN KEY ("bill_id") REFERENCES "books"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bill_documents" ADD CONSTRAINT "fk_bill_documents_document_id_documents" FOREIGN KEY ("document_id") REFERENCES "books"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bill_lines" ADD CONSTRAINT "fk_bill_lines_bill_id_bills" FOREIGN KEY ("bill_id") REFERENCES "books"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bill_payments" ADD CONSTRAINT "fk_bill_payments_vendor_id_vendors" FOREIGN KEY ("vendor_id") REFERENCES "books"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bill_payments" ADD CONSTRAINT "fk_bill_payments_bill_id_bills" FOREIGN KEY ("bill_id") REFERENCES "books"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bill_payments" ADD CONSTRAINT "fk_bill_payments_document_id_documents" FOREIGN KEY ("document_id") REFERENCES "books"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bill_taxes" ADD CONSTRAINT "fk_bill_taxes_bill_id_bills" FOREIGN KEY ("bill_id") REFERENCES "books"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bills" ADD CONSTRAINT "fk_bills_vendor_id_vendors" FOREIGN KEY ("vendor_id") REFERENCES "books"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bills" ADD CONSTRAINT "fk_bills_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "books"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bills" ADD CONSTRAINT "fk_bills_document_id_documents" FOREIGN KEY ("document_id") REFERENCES "books"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."bills" ADD CONSTRAINT "fk_bills_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."documents" ADD CONSTRAINT "fk_documents_parent_id_documents" FOREIGN KEY ("parent_id") REFERENCES "books"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."documents" ADD CONSTRAINT "fk_documents_vendor_id_vendors" FOREIGN KEY ("vendor_id") REFERENCES "books"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."documents" ADD CONSTRAINT "fk_documents_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."entries" ADD CONSTRAINT "fk_entries_bill_id_bills" FOREIGN KEY ("bill_id") REFERENCES "books"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."entries" ADD CONSTRAINT "fk_entries_reverses_id_entries" FOREIGN KEY ("reverses_id") REFERENCES "books"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."entries" ADD CONSTRAINT "fk_entries_run_id_runs" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."lines" ADD CONSTRAINT "fk_lines_entry_id_entries" FOREIGN KEY ("entry_id") REFERENCES "books"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."lines" ADD CONSTRAINT "fk_lines_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "books"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."vendors" ADD CONSTRAINT "fk_vendors_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "books"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_bill_documents_document_id" ON "books"."bill_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ix_bill_payments_bill_id" ON "books"."bill_payments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "ix_bills_issued_on" ON "books"."bills" USING btree ("issued_on");--> statement-breakpoint
CREATE INDEX "ix_documents_parent_id" ON "books"."documents" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_documents_vendor_id" ON "books"."documents" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "ix_entries_bill_id" ON "books"."entries" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "ix_entries_posted_on" ON "books"."entries" USING btree ("posted_on");--> statement-breakpoint
CREATE INDEX "ix_lines_entry_id" ON "books"."lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "ix_lines_account_id" ON "books"."lines" USING btree ("account_id");--> statement-breakpoint
CREATE VIEW "books"."bill_costs" AS (SELECT b.id AS bill_id, b.vendor_id, v.key AS vendor, v.name AS vendor_name, b.number, b.kind, b.issued_on, b.period_start, b.period_end, b.currency, b.total_cents, b.tax_cents, b.plan, b.cycle, b.review, a.key AS account, e.id AS entry_id, (SELECT (-sum(l.cad_cents))::bigint FROM books.lines l WHERE l.entry_id = e.id AND l.cad_cents < 0) AS cad_cents, (SELECT sum(l.cad_cents)::bigint FROM books.lines l JOIN books.accounts la ON la.id = l.account_id WHERE l.entry_id = e.id AND la.type::text = 'expense'::text) AS cost_cad_cents, COALESCE((SELECT sum(p.amount_cents)::bigint FROM books.bill_payments p WHERE p.bill_id = b.id AND p.currency = b.currency), 0::bigint) AS paid_cents FROM books.bills b JOIN books.vendors v ON v.id = b.vendor_id JOIN books.accounts a ON a.id = b.account_id LEFT JOIN books.entries e ON e.bill_id = b.id AND e.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM books.entries r WHERE r.reverses_id = e.id));--> statement-breakpoint
CREATE VIEW "books"."spend" AS (SELECT date_trunc('month'::text, e.posted_on::timestamp with time zone)::date AS month, a.key AS account, a.name AS account_name, a.t2125_line, v.key AS vendor, v.name AS vendor_name, sum(l.cad_cents)::bigint AS cad_cents FROM books.lines l JOIN books.entries e ON e.id = l.entry_id JOIN books.accounts a ON a.id = l.account_id LEFT JOIN books.bills b ON b.id = e.bill_id LEFT JOIN books.vendors v ON v.id = b.vendor_id WHERE a.type::text = 'expense'::text GROUP BY (date_trunc('month'::text, e.posted_on::timestamp with time zone)::date), a.key, a.name, a.t2125_line, v.key, v.name);--> statement-breakpoint
CREATE VIEW "books"."subscriptions" AS (SELECT DISTINCT ON (c.vendor_id, (lower(COALESCE(c.plan, ''::text)))) c.vendor_id, c.vendor, c.vendor_name, c.plan, c.cycle, c.currency, c.total_cents AS last_total_cents, c.cad_cents AS last_cad_cents, c.issued_on AS last_billed_on, (c.issued_on + CASE WHEN c.cycle::text = 'yearly'::text THEN '1 year'::interval ELSE '1 mon'::interval END)::date AS renews_on, CASE WHEN c.cycle::text = 'yearly'::text THEN round(c.cad_cents::numeric / 12.0)::bigint ELSE c.cad_cents END AS monthly_cad_cents, (SELECT min(b2.issued_on) FROM books.bills b2 WHERE b2.vendor_id = c.vendor_id AND lower(COALESCE(b2.plan, ''::text)) = lower(COALESCE(c.plan, ''::text)) AND b2.review::text <> 'personal'::text) AS since, (SELECT count(*)::integer FROM books.bills b2 WHERE b2.vendor_id = c.vendor_id AND lower(COALESCE(b2.plan, ''::text)) = lower(COALESCE(c.plan, ''::text)) AND b2.review::text <> 'personal'::text) AS bills FROM books.bill_costs c WHERE (c.cycle::text = ANY (ARRAY['monthly'::character varying, 'yearly'::character varying]::text[])) AND c.review::text <> 'personal'::text ORDER BY c.vendor_id, (lower(COALESCE(c.plan, ''::text))), c.issued_on DESC, c.bill_id DESC);--> statement-breakpoint
-- Double entry, enforced where it cannot be skipped: at commit, every entry has
-- two or more lines summing to zero cents.
CREATE FUNCTION "books"."entry_balances"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry integer;
  total bigint;
  n integer;
BEGIN
  IF TG_TABLE_NAME = 'entries' THEN entry := NEW.id; ELSE entry := NEW.entry_id; END IF;
  SELECT coalesce(sum(cad_cents), 0), count(*) INTO total, n FROM "books"."lines" WHERE entry_id = entry;
  IF n < 2 OR total <> 0 THEN
    RAISE EXCEPTION 'books entry % does not balance: % lines summing to % cents', entry, n, total;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "entries_balance" AFTER INSERT ON "books"."entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "books"."entry_balances"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "lines_balance" AFTER INSERT ON "books"."lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "books"."entry_balances"();--> statement-breakpoint
-- Entries are never edited: a fix is a reversing entry plus a new one.
CREATE FUNCTION "books"."never_edited"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'books.% rows are never edited or deleted; post a reversing entry', TG_TABLE_NAME;
END $$;--> statement-breakpoint
CREATE TRIGGER "entries_never_edited" BEFORE UPDATE OR DELETE ON "books"."entries" FOR EACH ROW EXECUTE FUNCTION "books"."never_edited"();--> statement-breakpoint
CREATE TRIGGER "lines_never_edited" BEFORE UPDATE OR DELETE ON "books"."lines" FOR EACH ROW EXECUTE FUNCTION "books"."never_edited"();
