/**
 * The SMS channel's tables. Five, each one fact:
 *
 * - `sms_numbers`: the pool we send from (PH-D10). Fixed size, each paused on
 *   its own health, never replaced automatically.
 * - `sms_contacts`: a lead's number, where we found it (the page, as evidence
 *   it was published), what a lookup said it is, and where its sequence stands.
 *   The sticky sender lives here: a contact is always texted from one number.
 * - `sms_messages`: every text both ways. Outbound rows are written as intent
 *   (`sending`) before the provider is called, so a crash never double-sends.
 * - `sms_events`: every webhook, raw, keyed by the provider's event id. The
 *   dedupe and the audit trail in one.
 * - `sms_templates`: William's words for each slot code declares
 *   (templates.ts). No row = empty = that text is never sent.
 *
 * Opt-outs are `suppressions` rows of kind `phone` (core), the same table every
 * channel reads.
 */
import { companies, people, runs } from "@wren/core/schema";
import { baseColumns, oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const NUMBER_STATES = ["active", "paused", "retired"] as const;
export type NumberState = (typeof NUMBER_STATES)[number];

/** The countries a person's number may be in: one +1 plan, two countries. */
export const PHONE_COUNTRIES = ["US", "CA"] as const;
export type PhoneCountry = (typeof PHONE_COUNTRIES)[number];

export const LINE_TYPES = ["mobile", "landline", "voip", "toll_free", "unknown"] as const;
export type LineType = (typeof LINE_TYPES)[number];

/**
 * Where a contact stands. `new` = found, not enrolled. `enrolled` = its
 * sequence is running. The rest are ends: `replied` (a human answered, the
 * sequence stops), `opted_out` (STOP or a plain "don't text me"), `finished`
 * (every step sent, no answer), `stopped` (an operator, or a failed number),
 * `unreachable` (a landline, or the carrier refused the number for good).
 */
export const CONTACT_STATES = [
  "new",
  "enrolled",
  "replied",
  "opted_out",
  "finished",
  "stopped",
  "unreachable",
] as const;
export type ContactState = (typeof CONTACT_STATES)[number];

/**
 * Why we may text this number at all. `published` = the business put it on its
 * own site (the page is the evidence). `opt_in` = the person gave it to us for
 * this (a reply with their cell, a form); `basis_detail` points at where. The
 * sender only texts the bases `WREN_SMS_BASES` allows, which must match what the
 * registered campaign says about its lead source.
 */
export const CONTACT_BASES = ["published", "opt_in"] as const;
export type ContactBasis = (typeof CONTACT_BASES)[number];

export const DIRECTIONS = ["out", "in"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** `sequence` = a cold step; `manual` = typed by the operator in the app or CLI; `inbound` = theirs. */
export const MESSAGE_KINDS = ["sequence", "manual", "inbound"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * Outbound: queued → sending → sent → delivered | failed. `unknown` = the
 * provider call's fate is lost (crash or network); never resent. `skipped` =
 * the contact ended before this step was due. Inbound rows are `received`.
 */
export const MESSAGE_STATES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "unknown",
  "skipped",
  "received",
] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

export const DISPOSITIONS = [
  "interested",
  "not_interested",
  "question",
  "wrong_person",
  "opt_out",
  "other",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_SOURCES = ["rule", "llm", "operator"] as const;
export type DispositionSource = (typeof DISPOSITION_SOURCES)[number];

export const smsNumbers = pgTable(
  "sms_numbers",
  {
    ...baseColumns,
    e164: varchar("e164", { length: 16 }).notNull(),
    provider: varchar("provider", { length: 16 }).notNull(),
    /** The provider's own id for the number, when it has one. */
    providerId: varchar("provider_id", { length: 64 }),
    state: varchar("state", { length: 16, enum: NUMBER_STATES }).notNull().default("active"),
    pausedReason: text("paused_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** Day one of this number's ramp, fleet time. The daily cap grows from here. */
    rampStartedOn: date("ramp_started_on").notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    /** Where the number is (from its digits). It texts phones in its own country only. */
    country: varchar("country", { length: 2, enum: PHONE_COUNTRIES }).notNull().default("US"),
    /**
     * When the carriers attached it to the registered 10DLC campaign. A US number
     * texts nobody until then; Canadian numbers need no registration.
     */
    registeredAt: timestamp("registered_at", { withTimezone: true }),
  },
  (t) => [
    unique("uq_sms_numbers_e164").on(t.e164),
    oneOf("ck_sms_numbers_numberstate", t.state, NUMBER_STATES),
    oneOf("ck_sms_numbers_country", t.country, PHONE_COUNTRIES),
    check(
      "ck_sms_numbers_paused_reason_iff_paused",
      sql`((state)::text = 'paused'::text) = (paused_reason IS NOT NULL)`,
    ),
  ],
);

export const smsContacts = pgTable(
  "sms_contacts",
  {
    id: serial("id").primaryKey(),
    e164: varchar("e164", { length: 16 }).notNull(),
    /** Null only for a stranger who texted one of our numbers first. */
    companyId: integer("company_id"),
    personId: integer("person_id"),
    /** The crawled page the number was published on (documents.id), and its URL: the evidence. */
    sourceDocumentId: integer("source_document_id"),
    sourceUrl: text("source_url"),
    /** How it was found: `tel_link`, `page_text`, `manual`, `inbound`, `form`. */
    sourceKind: varchar("source_kind", { length: 16 }).notNull(),
    /** The source's own id for it, when it has one (`form`: the lander's application id). */
    sourceRef: varchar("source_ref", { length: 64 }),
    /** What they called themselves, when no person row names them (a form applicant). */
    name: text("name"),
    email: text("email"),
    basis: varchar("basis", { length: 16, enum: CONTACT_BASES }).notNull(),
    basisDetail: text("basis_detail"),
    lineType: varchar("line_type", { length: 16, enum: LINE_TYPES }).notNull().default("unknown"),
    carrier: varchar("carrier", { length: 128 }),
    lookedUpAt: timestamp("looked_up_at", { withTimezone: true }),
    lookup: jsonb("lookup"),
    /** The sticky sender: every text to this contact goes out from this number. */
    numberId: uuid("number_id"),
    state: varchar("state", { length: 16, enum: CONTACT_STATES }).notNull().default("new"),
    stateReason: text("state_reason"),
    niche: varchar("niche", { length: 32 }),
    sequence: varchar("sequence", { length: 64 }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Last time the operator opened this thread; inbound after it is unread. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_sms_contacts_e164_company").on(t.e164, t.companyId),
    unique("uq_sms_contacts_source_ref").on(t.sourceKind, t.sourceRef),
    // One running sequence per phone, whichever company it was found under.
    uniqueIndex("uq_sms_contacts_enrolled_e164")
      .on(t.e164)
      .where(sql`(state)::text = 'enrolled'::text`),
    index("ix_sms_contacts_company_id").on(t.companyId),
    index("ix_sms_contacts_state").on(t.state),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_sms_contacts_company_id_companies",
    }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_sms_contacts_person_id_people",
    }),
    foreignKey({
      columns: [t.numberId],
      foreignColumns: [smsNumbers.id],
      name: "fk_sms_contacts_number_id_sms_numbers",
    }),
    oneOf("ck_sms_contacts_contactbasis", t.basis, CONTACT_BASES),
    oneOf("ck_sms_contacts_linetype", t.lineType, LINE_TYPES),
    oneOf("ck_sms_contacts_contactstate", t.state, CONTACT_STATES),
    check("ck_sms_contacts_e164", sql`(e164)::text ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      "ck_sms_contacts_sequence_iff_enrolled_at",
      sql`(sequence IS NULL) = (enrolled_at IS NULL)`,
    ),
  ],
);

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id").notNull(),
    direction: varchar("direction", { length: 4, enum: DIRECTIONS }).notNull(),
    kind: varchar("kind", { length: 16, enum: MESSAGE_KINDS }).notNull(),
    /** Sequence step, 1-based; null for manual and inbound. */
    step: smallint("step"),
    template: varchar("template", { length: 64 }),
    /** Our number (the pool row) on either direction. */
    numberId: uuid("number_id"),
    fromE164: varchar("from_e164", { length: 16 }),
    toE164: varchar("to_e164", { length: 16 }).notNull(),
    body: text("body").notNull(),
    state: varchar("state", { length: 16, enum: MESSAGE_STATES }).notNull(),
    providerId: varchar("provider_id", { length: 64 }),
    parts: smallint("parts"),
    costUsd: doublePrecision("cost_usd"),
    errorCode: varchar("error_code", { length: 32 }),
    detail: text("detail"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    disposition: varchar("disposition", { length: 16, enum: DISPOSITIONS }),
    dispositionSource: varchar("disposition_source", { length: 16, enum: DISPOSITION_SOURCES }),
    /** The classifier's full record (label, quote, confidence, model), applied or not. */
    classification: jsonb("classification"),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_sms_messages_contact_id").on(t.contactId),
    index("ix_sms_messages_state_due").on(t.state, t.dueAt),
    index("ix_sms_messages_number_attempted").on(t.numberId, t.attemptedAt),
    uniqueIndex("uq_sms_messages_provider_id").on(t.providerId),
    uniqueIndex("uq_sms_messages_contact_step")
      .on(t.contactId, t.step)
      .where(sql`(kind)::text = 'sequence'::text`),
    foreignKey({
      columns: [t.contactId],
      foreignColumns: [smsContacts.id],
      name: "fk_sms_messages_contact_id_sms_contacts",
    }),
    foreignKey({
      columns: [t.numberId],
      foreignColumns: [smsNumbers.id],
      name: "fk_sms_messages_number_id_sms_numbers",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_sms_messages_run_id_runs",
    }),
    oneOf("ck_sms_messages_direction", t.direction, DIRECTIONS),
    oneOf("ck_sms_messages_messagekind", t.kind, MESSAGE_KINDS),
    oneOf("ck_sms_messages_messagestate", t.state, MESSAGE_STATES),
    oneOf("ck_sms_messages_disposition", t.disposition, DISPOSITIONS),
    oneOf("ck_sms_messages_dispositionsource", t.dispositionSource, DISPOSITION_SOURCES),
    check(
      "ck_sms_messages_step_iff_sequence",
      sql`(step IS NOT NULL) = ((kind)::text = 'sequence'::text)`,
    ),
    check(
      "ck_sms_messages_inbound_shape",
      sql`((direction)::text = 'in'::text) = ((kind)::text = 'inbound'::text) AND ((direction)::text = 'in'::text) = ((state)::text = 'received'::text)`,
    ),
    check(
      "ck_sms_messages_sent_has_provider_id",
      sql`((state)::text <> ALL ((ARRAY['sent'::character varying, 'delivered'::character varying])::text[])) OR (provider_id IS NOT NULL)`,
    ),
    check(
      "ck_sms_messages_disposition_source",
      sql`(disposition IS NULL) = (disposition_source IS NULL)`,
    ),
  ],
);

export const smsEvents = pgTable(
  "sms_events",
  {
    id: serial("id").primaryKey(),
    provider: varchar("provider", { length: 16 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 64 }).notNull(),
    type: varchar("type", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** What applying it did (`delivered #12`, `stop: suppressed`, `ignored: unknown message`). */
    outcome: text("outcome"),
  },
  (t) => [unique("uq_sms_events_provider_event").on(t.provider, t.providerEventId)],
);

export const smsTemplates = pgTable("sms_templates", {
  /** A slot key: `<sequence>#<step>` or `keyword.<help|start|stop>`. */
  key: varchar("key", { length: 120 }).primaryKey(),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Who saved it: an operator's email, or `cli`. */
  updatedBy: varchar("updated_by", { length: 200 }).notNull(),
});

export type SmsNumber = typeof smsNumbers.$inferSelect;
export type SmsContact = typeof smsContacts.$inferSelect;
export type NewSmsContact = typeof smsContacts.$inferInsert;
export type SmsMessage = typeof smsMessages.$inferSelect;
export type SmsEventRow = typeof smsEvents.$inferSelect;
export type SmsTemplateRow = typeof smsTemplates.$inferSelect;
