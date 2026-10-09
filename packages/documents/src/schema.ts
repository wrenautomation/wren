/**
 * Documents, e-sign and estimates (designs/2026-10-09-documents.md). Main database, with a
 * `client` column, so the edge serves a signing page with one read. Wren's own use client `wren`.
 *
 * - `doc_templates`: a client's starting words and lines. A document copies what it needs, so an
 *   edit never changes a sent one.
 * - `docs`: one contract, proposal or estimate, filled when made, frozen when sent. Only the
 *   link token's SHA-256 is kept.
 * - `doc_events`: every step once, in order: the signing record reads from here.
 * - `doc_counters`: the next number per client and kind, taken with the insert.
 */
import { clients } from "@wren/core/clients";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const DOC_KINDS = ["contract", "proposal", "estimate"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_CHANNELS = ["email", "sms"] as const;
export type DocChannel = (typeof DOC_CHANNELS)[number];

/**
 * draft: being written. waiting: Send asked, on a yes. sending: yes given, the message on its
 * way. sent: out. viewed: opened. signed, declined, expired: done. void: called off by the client.
 * failed: the send refused (`why`); it can be sent again.
 */
export const DOC_STATUSES = [
  "draft",
  "waiting",
  "sending",
  "sent",
  "viewed",
  "signed",
  "declined",
  "expired",
  "void",
  "failed",
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const DOC_EVENTS = [
  "made",
  "asked",
  "sent",
  "viewed",
  "signed",
  "declined",
  "paid",
  "voided",
  "expired",
  "reminded",
] as const;
export type DocEventType = (typeof DOC_EVENTS)[number];

/** One line item. Cents and a tax percent the client types; totals are the server's. */
export interface DocLine {
  name: string;
  detail?: string | null;
  qty: number;
  unit_cents: number;
  tax_pct?: number | null;
}

export const docTemplates = pgTable(
  "doc_templates",
  {
    id: uuid("id").defaultRandom().notNull(),
    client: varchar("client", { length: 40 }).notNull(),
    kind: varchar("kind", { length: 10 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    /** Light marks: `# `, `## `, `- `, blank lines. Slots in `{...}`. */
    body: text("body").notNull().default(""),
    lines: jsonb("lines").$type<DocLine[]>().notNull().default([]),
    /** A deposit asked on signing, as a percent of the total; null asks none. */
    depositPct: integer("deposit_pct"),
    expiresDays: integer("expires_days").notNull().default(30),
    /** The starter it came from (`service`, `proposal`, `estimate`); null: the client's own. */
    starter: varchar("starter", { length: 20 }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_doc_templates" }),
    uniqueIndex("uq_doc_templates_starter").on(t.client, t.starter),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_doc_templates_client",
    }).onDelete("cascade"),
    oneOf("ck_doc_templates_kind", t.kind, DOC_KINDS),
    check("ck_doc_templates_deposit", sql`${t.depositPct} between 1 and 100`),
    check("ck_doc_templates_expires", sql`${t.expiresDays} between 1 and 365`),
  ],
);
export type DocTemplate = typeof docTemplates.$inferSelect;

export const docs = pgTable(
  "docs",
  {
    id: uuid("id").defaultRandom().notNull(),
    client: varchar("client", { length: 40 }).notNull(),
    template: uuid("template"),
    kind: varchar("kind", { length: 10 }).notNull(),
    /** Per client and kind: `EST-0007`. */
    number: varchar("number", { length: 16 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    /** Filled when made: slots left `{...}` block Send. */
    body: text("body").notNull().default(""),
    lines: jsonb("lines").$type<DocLine[]>().notNull().default([]),
    currency: varchar("currency", { length: 3 }).notNull().default("usd"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    depositCents: integer("deposit_cents"),
    /** Who it's for. */
    name: text("name"),
    email: text("email"),
    /** Their texting thread: `sms_contacts.id` in the client's database. */
    contact: integer("contact"),
    channel: varchar("channel", { length: 8 }).notNull().default("email"),
    status: varchar("status", { length: 8 }).notNull().default("draft"),
    why: text("why"),
    /** SHA-256 of the link's token, hex; the token itself is never kept. */
    tokenHash: varchar("token_hash", { length: 64 }),
    expiresDays: integer("expires_days").notNull().default(30),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** SHA-256 of the text as shown (`shownText`): the signer's post must carry the same. */
    sha256: varchar("sha256", { length: 64 }),
    /** The queued text's `sms_messages.id`, in the client's database. */
    message: integer("message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    signerName: text("signer_name"),
    signerEmail: text("signer_email"),
    signedIp: varchar("signed_ip", { length: 64 }),
    signedAgent: text("signed_agent"),
    consentVersion: varchar("consent_version", { length: 16 }),
    declinedWhy: text("declined_why"),
    /** The deposit's pay link (`pay_links.id`), made on signing. */
    payLink: uuid("pay_link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_docs" }),
    index("ix_docs_client_created").on(t.client, t.createdAt),
    uniqueIndex("uq_docs_number").on(t.client, t.number),
    uniqueIndex("uq_docs_token").on(t.tokenHash),
    index("ix_docs_status").on(t.status),
    index("ix_docs_template").on(t.template),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_docs_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.template],
      foreignColumns: [docTemplates.id],
      name: "fk_docs_template",
    }).onDelete("set null"),
    oneOf("ck_docs_kind", t.kind, DOC_KINDS),
    oneOf("ck_docs_channel", t.channel, DOC_CHANNELS),
    oneOf("ck_docs_status", t.status, DOC_STATUSES),
    check("ck_docs_totals", sql`${t.totalCents} = ${t.subtotalCents} + ${t.taxCents}`),
    check(
      "ck_docs_deposit",
      sql`${t.depositCents} is null or (${t.depositCents} >= 50 and ${t.depositCents} <= ${t.totalCents})`,
    ),
    check(
      "ck_docs_signed",
      sql`${t.status} <> 'signed' or (${t.signerName} is not null and ${t.signedAt} is not null and ${t.sha256} is not null)`,
    ),
  ],
);
export type Doc = typeof docs.$inferSelect;

export const docEvents = pgTable(
  "doc_events",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    document: uuid("document").notNull(),
    type: varchar("type", { length: 10 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** A login's email, or `recipient`. */
    by: text("by").notNull(),
    ip: varchar("ip", { length: 64 }),
    agent: text("agent"),
    /** A reason, the signer's name, a pay link: what this step needs to say. */
    note: text("note"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_doc_events" }),
    index("ix_doc_events_document").on(t.document, t.at),
    foreignKey({
      columns: [t.document],
      foreignColumns: [docs.id],
      name: "fk_doc_events_document",
    }).onDelete("cascade"),
    oneOf("ck_doc_events_type", t.type, DOC_EVENTS),
  ],
);
export type DocEvent = typeof docEvents.$inferSelect;

export const docCounters = pgTable(
  "doc_counters",
  {
    client: varchar("client", { length: 40 }).notNull(),
    kind: varchar("kind", { length: 10 }).notNull(),
    next: integer("next").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.client, t.kind], name: "pk_doc_counters" }),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_doc_counters_client",
    }).onDelete("cascade"),
    oneOf("ck_doc_counters_kind", t.kind, DOC_KINDS),
  ],
);
