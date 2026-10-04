import { runs } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * All money lives in its own schema, so `books.accounts` never meets another
 * `accounts`. Amounts are whole cents (bigint) beside a currency code; never floats.
 */
export const books = pgSchema("books");

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** The chart of accounts. Seeded from `CHART` in code; rows are never deleted. */
export const accounts = books.table(
  "accounts",
  {
    id: serial("id").notNull(),
    /** The stable handle code and vendors use: `card-bmo`, `ai`. */
    key: varchar("key", { length: 64 }).notNull(),
    name: text("name").notNull(),
    type: varchar("type", { length: 16, enum: ACCOUNT_TYPES }).notNull(),
    /** The T2125 line this rolls into at year-end; null off the income statement. */
    t2125Line: varchar("t2125_line", { length: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_accounts" }),
    unique("uq_accounts_key").on(t.key),
    oneOf("ck_accounts_type", t.type, ACCOUNT_TYPES),
  ],
);
export type Account = typeof accounts.$inferSelect;

export const BILL_CYCLES = ["monthly", "yearly", "usage", "once"] as const;
export type BillCycle = (typeof BILL_CYCLES)[number];

/** Who bills us. Seeded from `VENDORS` in code, which also says where their bills arrive. */
export const vendors = books.table(
  "vendors",
  {
    id: serial("id").notNull(),
    /** The stable handle: `google-workspace`. */
    key: varchar("key", { length: 64 }).notNull(),
    name: text("name").notNull(),
    /** The expense account a bill posts to unless the bill says otherwise. */
    accountId: integer("account_id").notNull(),
    /** How it usually bills, when a bill does not say. */
    cycle: varchar("cycle", { length: 16, enum: BILL_CYCLES }),
    /**
     * Whether the GST/HST it charges can be claimed back. False for vendors on
     * the simplified regime (a registrant cannot claim it); null = not known yet.
     */
    gstClaimable: boolean("gst_claimable"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_vendors" }),
    index("ix_vendors_account_id").on(t.accountId),
    unique("uq_vendors_key").on(t.key),
    oneOf("ck_vendors_cycle", t.cycle, BILL_CYCLES),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [accounts.id],
      name: "fk_vendors_account_id_accounts",
    }),
  ],
);
export type Vendor = typeof vendors.$inferSelect;

export const DOCUMENT_SOURCES = ["mailbox", "file", "attachment"] as const;
export const DOCUMENT_KINDS = ["bill", "payment", "notice", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Every raw record, kept forever: an email, one of its attachments, a file
 * added by hand. The bytes live in the document store under `store_key`
 * (content-addressed, so the same bytes are one row); Postgres keeps the
 * text and what was read from it.
 */
export const documents = books.table(
  "documents",
  {
    id: serial("id").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    mediaType: varchar("media_type", { length: 128 }).notNull(),
    size: integer("size").notNull(),
    /** Where the bytes live in the document store. */
    storeKey: text("store_key").notNull(),
    source: varchar("source", { length: 16, enum: DOCUMENT_SOURCES }).notNull(),
    /** The email an attachment came in. */
    parentId: integer("parent_id"),
    filename: text("filename"),
    /** The inbox it was read from. */
    mailbox: text("mailbox"),
    /** That inbox's own id for the message (Gmail's), so a re-read skips it before fetching. */
    mailboxKey: text("mailbox_key"),
    /** RFC 5322 Message-ID. */
    messageId: text("message_id"),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    subject: text("subject"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** The vendor whose billing sender it came from. */
    vendorId: integer("vendor_id"),
    /** Readable text: the email body, or a PDF's text. What the reader reads and checks against. */
    text: text("text"),
    /** What reading found; null until read. Attachments are read with their email. */
    kind: varchar("kind", { length: 16, enum: DOCUMENT_KINDS }),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** The last reading: the model's raw answer, parse error, call record, and the checks' verdicts. */
    reading: jsonb("reading"),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_documents" }),
    index("ix_documents_run_id").on(t.runId),
    unique("uq_documents_sha256").on(t.sha256),
    unique("uq_documents_mailbox_key").on(t.mailbox, t.mailboxKey),
    index("ix_documents_parent_id").on(t.parentId),
    index("ix_documents_vendor_id").on(t.vendorId),
    oneOf("ck_documents_source", t.source, DOCUMENT_SOURCES),
    oneOf("ck_documents_kind", t.kind, DOCUMENT_KINDS),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "fk_documents_parent_id_documents",
    }),
    foreignKey({
      columns: [t.vendorId],
      foreignColumns: [vendors.id],
      name: "fk_documents_vendor_id_vendors",
    }),
    foreignKey({ columns: [t.runId], foreignColumns: [runs.id], name: "fk_documents_run_id_runs" }),
  ],
);
export type Document = typeof documents.$inferSelect;

export const BILL_KINDS = ["invoice", "receipt", "credit_note"] as const;
/**
 * `ok`: every check passed. `needs_review`: a check failed, so it is not
 * posted. `accepted`: you confirmed it anyway. `personal`: not a business
 * cost; kept, never posted. `void`: its document, read again, no longer gives
 * it; kept, never posted.
 */
export const REVIEW_STATES = ["ok", "needs_review", "accepted", "personal", "void"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * A vendor's invoice or receipt, as printed. One row per vendor and number:
 * every email and PDF about the same bill links to it (`bill_documents`).
 */
export const bills = books.table(
  "bills",
  {
    id: serial("id").notNull(),
    vendorId: integer("vendor_id").notNull(),
    /** The invoice number as printed; a receipt's number when there is no invoice. */
    number: text("number").notNull(),
    kind: varchar("kind", { length: 16, enum: BILL_KINDS }).notNull(),
    issuedOn: date("issued_on").notNull(),
    dueOn: date("due_on"),
    /** The service period it pays for. */
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    /** ISO 4217 code of every amount on the bill. */
    currency: char("currency", { length: 3 }).notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    /** Sum of `bill_taxes`. */
    taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    /** The CAD the card was charged, when a document states it for a non-CAD bill. */
    chargedCadCents: bigint("charged_cad_cents", { mode: "number" }),
    /** The plan or product as the vendor names it; a domain for a registrar. */
    plan: text("plan"),
    cycle: varchar("cycle", { length: 16, enum: BILL_CYCLES }),
    /** As printed: "Mastercard ending 1234". */
    paymentMethod: text("payment_method"),
    /** The bill-to block as printed. */
    billedTo: text("billed_to"),
    /** The vendor's tax registration as printed. */
    vendorTaxNumber: text("vendor_tax_number"),
    /** The expense account it posts to. */
    accountId: integer("account_id").notNull(),
    review: varchar("review", { length: 16, enum: REVIEW_STATES }).notNull(),
    /** Why it needs a look: `["total does not equal subtotal plus tax", ...]`. */
    reviewReasons: jsonb("review_reasons").$type<string[]>().default([]).notNull(),
    /** The document its amounts were read from. */
    documentId: integer("document_id").notNull(),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_bills" }),
    index("ix_bills_run_id").on(t.runId),
    index("ix_bills_document_id").on(t.documentId),
    index("ix_bills_account_id").on(t.accountId),
    unique("uq_bills_vendor_number").on(t.vendorId, t.number),
    index("ix_bills_issued_on").on(t.issuedOn),
    oneOf("ck_bills_kind", t.kind, BILL_KINDS),
    oneOf("ck_bills_cycle", t.cycle, BILL_CYCLES),
    oneOf("ck_bills_review", t.review, REVIEW_STATES),
    foreignKey({
      columns: [t.vendorId],
      foreignColumns: [vendors.id],
      name: "fk_bills_vendor_id_vendors",
    }),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [accounts.id],
      name: "fk_bills_account_id_accounts",
    }),
    foreignKey({
      columns: [t.documentId],
      foreignColumns: [documents.id],
      name: "fk_bills_document_id_documents",
    }),
    foreignKey({ columns: [t.runId], foreignColumns: [runs.id], name: "fk_bills_run_id_runs" }),
  ],
);
export type Bill = typeof bills.$inferSelect;

/** A bill's line items, in printed order. Discounts are negative lines. */
export const billLines = books.table(
  "bill_lines",
  {
    id: serial("id").notNull(),
    billId: integer("bill_id").notNull(),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    /** As printed ("3", "1.5 GB"); null when the line shows none. */
    quantity: text("quantity"),
    /** As printed ("$0.0035"): unit prices can be fractions of a cent. */
    unitPrice: text("unit_price"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_bill_lines" }),
    unique("uq_bill_lines_position").on(t.billId, t.position),
    foreignKey({
      columns: [t.billId],
      foreignColumns: [bills.id],
      name: "fk_bill_lines_bill_id_bills",
    }),
  ],
);
export type BillLine = typeof billLines.$inferSelect;

/** Each tax a bill charges (GST, HST, QST, a US state's sales tax). */
export const billTaxes = books.table(
  "bill_taxes",
  {
    id: serial("id").notNull(),
    billId: integer("bill_id").notNull(),
    position: integer("position").notNull(),
    /** As printed: "GST", "HST (13%)", "Sales tax". */
    name: text("name").notNull(),
    /** Percent, when printed: 5.0000. */
    ratePercent: numeric("rate_percent", { precision: 7, scale: 4 }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Can be claimed back as an input tax credit; otherwise it is part of the cost. */
    claimable: boolean("claimable").notNull(),
    /** The registration number printed for this tax. */
    taxNumber: text("tax_number"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_bill_taxes" }),
    unique("uq_bill_taxes_position").on(t.billId, t.position),
    foreignKey({
      columns: [t.billId],
      foreignColumns: [bills.id],
      name: "fk_bill_taxes_bill_id_bills",
    }),
  ],
);
export type BillTax = typeof billTaxes.$inferSelect;

/**
 * A payment a document confirms, toward a vendor's invoice number, or on
 * account when it names none (Google's "Payment received"). It may be read
 * before the invoice itself; `bill_id` links it once the bill exists.
 */
export const billPayments = books.table(
  "bill_payments",
  {
    id: serial("id").notNull(),
    vendorId: integer("vendor_id").notNull(),
    /** The invoice number it pays, as printed; null = on account. */
    invoiceNumber: text("invoice_number"),
    billId: integer("bill_id"),
    paidOn: date("paid_on").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** As printed: "Mastercard ending 1234". */
    method: text("method"),
    /** The receipt or transaction number, as printed. */
    reference: text("reference"),
    /** `reference`, else `<paid_on>:<amount_cents>`: the same payment read twice is one row. */
    key: text("key").notNull(),
    documentId: integer("document_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_bill_payments" }),
    index("ix_bill_payments_document_id").on(t.documentId),
    unique("uq_bill_payments_key").on(t.vendorId, t.invoiceNumber, t.key).nullsNotDistinct(),
    index("ix_bill_payments_bill_id").on(t.billId),
    foreignKey({
      columns: [t.vendorId],
      foreignColumns: [vendors.id],
      name: "fk_bill_payments_vendor_id_vendors",
    }),
    foreignKey({
      columns: [t.billId],
      foreignColumns: [bills.id],
      name: "fk_bill_payments_bill_id_bills",
    }),
    foreignKey({
      columns: [t.documentId],
      foreignColumns: [documents.id],
      name: "fk_bill_payments_document_id_documents",
    }),
  ],
);
export type BillPayment = typeof billPayments.$inferSelect;

/** Every document that speaks about a bill: the invoice email, its PDFs' email, a payment notice. */
export const billDocuments = books.table(
  "bill_documents",
  {
    billId: integer("bill_id").notNull(),
    documentId: integer("document_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.billId, t.documentId], name: "pk_bill_documents" }),
    index("ix_bill_documents_document_id").on(t.documentId),
    foreignKey({
      columns: [t.billId],
      foreignColumns: [bills.id],
      name: "fk_bill_documents_bill_id_bills",
    }),
    foreignKey({
      columns: [t.documentId],
      foreignColumns: [documents.id],
      name: "fk_bill_documents_document_id_documents",
    }),
  ],
);

export const RATE_SOURCES = ["same", "boc", "stated", "card"] as const;
export type RateSource = (typeof RATE_SOURCES)[number];

/** Daily exchange rates, CAD per unit of `currency`. `boc` is the Bank of Canada's daily rate. */
export const rates = books.table(
  "rates",
  {
    on: date("on").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    source: varchar("source", { length: 16, enum: RATE_SOURCES }).notNull(),
    cadPerUnit: numeric("cad_per_unit", { precision: 18, scale: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.on, t.currency, t.source], name: "pk_rates" }),
    oneOf("ck_rates_source", t.source, RATE_SOURCES),
  ],
);

/**
 * A journal entry. Its lines sum to zero in CAD, checked by the database at
 * commit. Never edited or deleted (a trigger refuses): a fix is a reversing
 * entry plus a new one. Every entry cites its source.
 */
export const entries = books.table(
  "entries",
  {
    id: serial("id").notNull(),
    /** The accounting date: a bill's issue date. */
    postedOn: date("posted_on").notNull(),
    memo: text("memo").notNull(),
    billId: integer("bill_id"),
    /** The entry this one cancels; each entry is reversed at most once. */
    reversesId: integer("reverses_id"),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_entries" }),
    index("ix_entries_run_id").on(t.runId),
    unique("uq_entries_reverses_id").on(t.reversesId),
    index("ix_entries_bill_id").on(t.billId),
    index("ix_entries_posted_on").on(t.postedOn),
    foreignKey({
      columns: [t.billId],
      foreignColumns: [bills.id],
      name: "fk_entries_bill_id_bills",
    }),
    foreignKey({
      columns: [t.reversesId],
      foreignColumns: [t.id],
      name: "fk_entries_reverses_id_entries",
    }),
    foreignKey({ columns: [t.runId], foreignColumns: [runs.id], name: "fk_entries_run_id_runs" }),
  ],
);
export type Entry = typeof entries.$inferSelect;

/**
 * One side of an entry. `cad_cents` is positive for a debit, negative for a
 * credit. The original amount, its currency and the rate that turned it into
 * CAD ride along, with where the rate came from.
 */
export const lines = books.table(
  "lines",
  {
    id: serial("id").notNull(),
    entryId: integer("entry_id").notNull(),
    accountId: integer("account_id").notNull(),
    cadCents: bigint("cad_cents", { mode: "number" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** CAD per unit of `currency`. */
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    rateSource: varchar("rate_source", { length: 16, enum: RATE_SOURCES }).notNull(),
    memo: text("memo"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_lines" }),
    index("ix_lines_entry_id").on(t.entryId),
    index("ix_lines_account_id").on(t.accountId),
    oneOf("ck_lines_rate_source", t.rateSource, RATE_SOURCES),
    foreignKey({
      columns: [t.entryId],
      foreignColumns: [entries.id],
      name: "fk_lines_entry_id_entries",
    }),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [accounts.id],
      name: "fk_lines_account_id_accounts",
    }),
  ],
);
export type Line = typeof lines.$inferSelect;

/**
 * One row per bill with what it cost in CAD, from its live entry (posted and
 * not reversed). `cad_cents` is what was charged; `cost_cad_cents` is the
 * expense after claimable tax. Both null until posted. `paid_cents` sums the
 * payments seen in the bill's currency.
 */
export const billCosts = books
  .view("bill_costs", {
    billId: integer("bill_id"),
    vendorId: integer("vendor_id"),
    vendor: varchar("vendor", { length: 64 }),
    vendorName: text("vendor_name"),
    number: text("number"),
    kind: varchar("kind", { length: 16 }),
    issuedOn: date("issued_on"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    currency: char("currency", { length: 3 }),
    totalCents: bigint("total_cents", { mode: "number" }),
    taxCents: bigint("tax_cents", { mode: "number" }),
    plan: text("plan"),
    cycle: varchar("cycle", { length: 16 }),
    review: varchar("review", { length: 16 }),
    account: varchar("account", { length: 64 }),
    entryId: integer("entry_id"),
    cadCents: bigint("cad_cents", { mode: "number" }),
    costCadCents: bigint("cost_cad_cents", { mode: "number" }),
    paidCents: bigint("paid_cents", { mode: "number" }),
  })
  .as(
    sql`SELECT b.id AS bill_id, b.vendor_id, v.key AS vendor, v.name AS vendor_name, b.number, b.kind, b.issued_on, b.period_start, b.period_end, b.currency, b.total_cents, b.tax_cents, b.plan, b.cycle, b.review, a.key AS account, e.id AS entry_id, (SELECT (-sum(l.cad_cents))::bigint FROM books.lines l WHERE l.entry_id = e.id AND l.cad_cents < 0) AS cad_cents, (SELECT sum(l.cad_cents)::bigint FROM books.lines l JOIN books.accounts la ON la.id = l.account_id WHERE l.entry_id = e.id AND la.type::text = 'expense'::text) AS cost_cad_cents, COALESCE((SELECT sum(p.amount_cents)::bigint FROM books.bill_payments p WHERE p.bill_id = b.id AND p.currency = b.currency), 0::bigint) AS paid_cents FROM books.bills b JOIN books.vendors v ON v.id = b.vendor_id JOIN books.accounts a ON a.id = b.account_id LEFT JOIN books.entries e ON e.bill_id = b.id AND e.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM books.entries r WHERE r.reverses_id = e.id)`,
  );

/**
 * What each subscription costs and when it renews: per vendor and plan, the
 * latest monthly or yearly bill that cost something. A yearly bill naming no
 * plan stands alone: a registrar's emails that name no domain are still one
 * renewal each. `renews_on` is a cycle after that bill (the
 * printed period misleads: Google bills the month just past, registrars renew
 * early); `monthly_cad_cents` spreads a yearly bill over 12.
 */
export const subscriptions = books
  .view("subscriptions", {
    vendorId: integer("vendor_id"),
    vendor: varchar("vendor", { length: 64 }),
    vendorName: text("vendor_name"),
    plan: text("plan"),
    cycle: varchar("cycle", { length: 16 }),
    currency: char("currency", { length: 3 }),
    lastTotalCents: bigint("last_total_cents", { mode: "number" }),
    lastCadCents: bigint("last_cad_cents", { mode: "number" }),
    lastBilledOn: date("last_billed_on"),
    renewsOn: date("renews_on"),
    monthlyCadCents: bigint("monthly_cad_cents", { mode: "number" }),
    since: date("since"),
    bills: integer("bills"),
  })
  .as(
    sql`SELECT DISTINCT ON (c.vendor_id, (CASE WHEN c.plan IS NULL AND c.cycle::text = 'yearly'::text THEN c.bill_id::text ELSE lower(COALESCE(c.plan, ''::text)) END)) c.vendor_id, c.vendor, c.vendor_name, c.plan, c.cycle, c.currency, c.total_cents AS last_total_cents, c.cad_cents AS last_cad_cents, c.issued_on AS last_billed_on, (c.issued_on + CASE WHEN c.cycle::text = 'yearly'::text THEN '1 year'::interval ELSE '1 mon'::interval END)::date AS renews_on, CASE WHEN c.cycle::text = 'yearly'::text THEN round(c.cad_cents::numeric / 12.0)::bigint ELSE c.cad_cents END AS monthly_cad_cents, (SELECT min(b2.issued_on) FROM books.bills b2 WHERE b2.vendor_id = c.vendor_id AND (CASE WHEN c.plan IS NULL AND c.cycle::text = 'yearly'::text THEN b2.id = c.bill_id ELSE lower(COALESCE(b2.plan, ''::text)) = lower(COALESCE(c.plan, ''::text)) END) AND (b2.review::text <> ALL (ARRAY['personal'::character varying, 'void'::character varying]::text[]))) AS since, (SELECT count(*)::integer FROM books.bills b2 WHERE b2.vendor_id = c.vendor_id AND (CASE WHEN c.plan IS NULL AND c.cycle::text = 'yearly'::text THEN b2.id = c.bill_id ELSE lower(COALESCE(b2.plan, ''::text)) = lower(COALESCE(c.plan, ''::text)) END) AND (b2.review::text <> ALL (ARRAY['personal'::character varying, 'void'::character varying]::text[]))) AS bills FROM books.bill_costs c WHERE (c.cycle::text = ANY (ARRAY['monthly'::character varying, 'yearly'::character varying]::text[])) AND (c.review::text <> ALL (ARRAY['personal'::character varying, 'void'::character varying]::text[])) AND c.total_cents > 0 ORDER BY c.vendor_id, (CASE WHEN c.plan IS NULL AND c.cycle::text = 'yearly'::text THEN c.bill_id::text ELSE lower(COALESCE(c.plan, ''::text)) END), c.issued_on DESC, c.bill_id DESC`,
  );

/**
 * Expense per month, account and vendor in CAD, from the journal. Reversals
 * net out, so a corrected bill counts once.
 */
export const spend = books
  .view("spend", {
    month: date("month"),
    account: varchar("account", { length: 64 }),
    accountName: text("account_name"),
    t2125Line: varchar("t2125_line", { length: 8 }),
    vendor: varchar("vendor", { length: 64 }),
    vendorName: text("vendor_name"),
    cadCents: bigint("cad_cents", { mode: "number" }),
  })
  .as(
    sql`SELECT date_trunc('month'::text, e.posted_on::timestamp with time zone)::date AS month, a.key AS account, a.name AS account_name, a.t2125_line, v.key AS vendor, v.name AS vendor_name, sum(l.cad_cents)::bigint AS cad_cents FROM books.lines l JOIN books.entries e ON e.id = l.entry_id JOIN books.accounts a ON a.id = l.account_id LEFT JOIN books.bills b ON b.id = e.bill_id LEFT JOIN books.vendors v ON v.id = b.vendor_id WHERE a.type::text = 'expense'::text GROUP BY (date_trunc('month'::text, e.posted_on::timestamp with time zone)::date), a.key, a.name, a.t2125_line, v.key, v.name`,
  );

export const USAGE_PROVIDERS = ["aws"] as const;
export type UsageProvider = (typeof USAGE_PROVIDERS)[number];

/**
 * Metered spend per day and service, from the provider's own cost API (AWS
 * Cost Explorer). It runs ahead of the bill: the month's invoice is the books'
 * truth, this is the early look. Metered amounts go below a cent, so they are
 * exact decimals, never cents. A day is fetched again until it settles.
 */
export const usage = books.table(
  "usage",
  {
    on: date("on").notNull(),
    provider: varchar("provider", { length: 16, enum: USAGE_PROVIDERS }).notNull(),
    service: text("service").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.on, t.provider, t.service], name: "pk_usage" }),
    oneOf("ck_usage_provider", t.provider, USAGE_PROVIDERS),
  ],
);

/** Metered spend per month and service: `usage` summed, for the console. */
export const usageByMonth = books
  .view("usage_by_month", {
    month: date("month"),
    provider: varchar("provider", { length: 16 }),
    service: text("service"),
    currency: char("currency", { length: 3 }),
    amount: numeric("amount", { precision: 18, scale: 6 }),
  })
  .as(
    sql`SELECT date_trunc('month'::text, u."on"::timestamp with time zone)::date AS month, u.provider, u.service, u.currency, sum(u.amount) AS amount FROM books.usage u GROUP BY (date_trunc('month'::text, u."on"::timestamp with time zone)::date), u.provider, u.service, u.currency`,
  );

/**
 * `spend` as console records (`./records.ts`): one id per line, the amount in dollars, and its
 * month aged against today, so "This month" is a static saved view.
 */
export const spendRecords = books
  .view("spend_records", {
    id: text("id"),
    month: date("month"),
    account: text("account"),
    t2125Line: text("t2125_line"),
    vendor: text("vendor"),
    amount: numeric("amount", { mode: "number" }),
    currency: text("currency"),
    age: text("age"),
  })
  .as(sql`
    select concat_ws('/', s.month, s.account, s.vendor) id, s.month,
      coalesce(s.account_name, s.account)::text account, s.t2125_line::text t2125_line,
      coalesce(s.vendor_name, s.vendor)::text vendor, s.cad_cents / 100.0 amount,
      'CAD' currency,
      case when s.month = date_trunc('month', current_date)::date then 'this_month'
        when s.month = (date_trunc('month', current_date) - interval '1 month')::date then 'last_month'
        else 'earlier' end age
    from books.spend s`);

/** `subscriptions` as console records: dollars, and whether the renewal is near or past. */
export const subscriptionRecords = books
  .view("subscription_records", {
    id: text("id"),
    vendor: text("vendor"),
    plan: text("plan"),
    cycle: text("cycle"),
    cost: numeric("cost", { mode: "number" }),
    currency: text("currency"),
    monthly: numeric("monthly", { mode: "number" }),
    cad: text("cad"),
    lastBilledOn: date("last_billed_on"),
    renewsOn: date("renews_on"),
    renewal: text("renewal"),
    since: date("since"),
    bills: integer("bills"),
  })
  .as(sql`
    select concat_ws('/', s.vendor_id, lower(coalesce(s.plan, '')), s.cycle, s.last_billed_on) id,
      coalesce(s.vendor_name, s.vendor)::text vendor, s.plan, s.cycle::text cycle,
      s.last_total_cents / 100.0 cost, s.currency::text currency,
      s.monthly_cad_cents / 100.0 monthly, 'CAD' cad, s.last_billed_on, s.renews_on,
      case when s.renews_on < current_date then 'past'
        when s.renews_on < current_date + 30 then 'soon' else 'later' end renewal,
      s.since, s.bills
    from books.subscriptions s`);

/** What the console may read by name (`ConsolePortal/view`): totals only. */
export const BOOKS_CONSOLE_VIEWS = [
  "books.spend",
  "books.subscriptions",
  "books.usage_by_month",
] as const;

export const ALERT_KINDS = [
  "capture",
  "held",
  "unread",
  "new_subscription",
  "renewal",
  "lapsed",
  "spike",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * What the daily books pass told the operator. One row per condition, keyed by
 * what it is about: raised once when it appears, cleared when it goes, raised
 * again only if it comes back. So a held bill is one message, not one a day.
 */
export const alerts = books.table(
  "alerts",
  {
    key: text("key").primaryKey(),
    kind: varchar("kind", { length: 32, enum: ALERT_KINDS }).notNull(),
    message: text("message").notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).defaultNow().notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (t) => [
    oneOf("ck_alerts_kind", t.kind, ALERT_KINDS),
    index("ix_alerts_open").on(t.kind).where(sql`${t.clearedAt} IS NULL`),
  ],
);
