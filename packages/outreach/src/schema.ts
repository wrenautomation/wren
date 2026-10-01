/**
 * Cold outreach on Reddit and LinkedIn: four tables, each one fact.
 *
 * - `reach_accounts`: the accounts we speak as, one row per autobrowse
 *   credential (`reddit@alt`, `linkedin@wren`), with the last health read
 *   (age, karma, suspended) the warmup protocol runs on.
 * - `reach_contacts`: a person on a platform, where a search found them,
 *   what their page said, and where their sequence stands. The sticky
 *   account lives here: one person is always reached from one account.
 * - `reach_messages`: every connect, message and reply, both ways. Outbound
 *   rows are written as intent (`sending`) before the platform is called, so
 *   a crash never sends twice.
 * - `reach_templates`: William's words for each slot code declares
 *   (sequences.ts). No row = empty = that step never goes.
 *
 * Opt-outs ("stop messaging me") are `suppressions` rows of kind `handle`
 * (core), the same table every channel reads.
 */
import { companies, people, runs } from "@wren/core/schema";
import { baseColumns, oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  check,
  date,
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

export const PLATFORMS = ["reddit", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** `warming` = reads and organic steps only; `active` = may reach out; `paused` = nothing. */
export const ACCOUNT_STATES = ["warming", "active", "paused", "retired"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/**
 * new → enrolled → (connected →) replied | finished | unreachable. `opted_out`
 * = they said stop; `blocked` = the platform refused us on them.
 */
export const CONTACT_STATES = [
  "new",
  "enrolled",
  "connected",
  "replied",
  "finished",
  "unreachable",
  "opted_out",
  "blocked",
] as const;
export type ContactState = (typeof CONTACT_STATES)[number];

export const DIRECTIONS = ["out", "in"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** `connect` = an invite (LinkedIn); `sequence` = a cold step; `manual` = typed by the operator; `inbound` = theirs. */
export const MESSAGE_KINDS = ["connect", "sequence", "manual", "inbound"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Outbound: queued → sending → sent | failed. `unknown` = the platform call's fate is lost; never resent. */
export const MESSAGE_STATES = [
  "queued",
  "sending",
  "sent",
  "failed",
  "unknown",
  "skipped",
  "received",
] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

export const reachAccounts = pgTable(
  "reach_accounts",
  {
    ...baseColumns,
    platform: varchar("platform", { length: 16, enum: PLATFORMS }).notNull(),
    /** The autobrowse credential key this account speaks as. */
    account: varchar("account", { length: 120 }).notNull(),
    /** The platform's handle, from the last health read. */
    handle: varchar("handle", { length: 120 }),
    state: varchar("state", { length: 16, enum: ACCOUNT_STATES }).notNull().default("warming"),
    pausedReason: text("paused_reason"),
    /** Day one of outreach from this account (fleet time): the LinkedIn ramp counts from here. */
    startedOn: date("started_on").notNull(),
    /** The last `health()` answer, as the adapter gave it. */
    health: jsonb("health"),
    healthAt: timestamp("health_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    unique("uq_reach_accounts_platform_account").on(t.platform, t.account),
    oneOf("ck_reach_accounts_platform", t.platform, PLATFORMS),
    oneOf("ck_reach_accounts_state", t.state, ACCOUNT_STATES),
    check(
      "ck_reach_accounts_paused_reason_iff_paused",
      sql`((state)::text = 'paused'::text) = (paused_reason IS NOT NULL)`,
    ),
  ],
);

export const reachContacts = pgTable(
  "reach_contacts",
  {
    id: serial("id").primaryKey(),
    platform: varchar("platform", { length: 16, enum: PLATFORMS }).notNull(),
    handle: varchar("handle", { length: 120 }).notNull(),
    url: text("url").notNull(),
    name: text("name"),
    headline: text("headline"),
    /** Where the search saw them (`r/startups`, `search:founder recruiting`, `company/acme`, `manual`). */
    foundIn: varchar("found_in", { length: 200 }).notNull(),
    companyId: integer("company_id"),
    personId: integer("person_id"),
    niche: varchar("niche", { length: 32 }),
    /** The page as `enrich` read it; null until read. */
    profile: jsonb("profile"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    /** The sticky sender. */
    accountId: uuid("account_id"),
    state: varchar("state", { length: 16, enum: CONTACT_STATES }).notNull().default("new"),
    stateReason: text("state_reason"),
    sequence: varchar("sequence", { length: 64 }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
    /** LinkedIn: when the invite was accepted (relationship read as connected). */
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Last time the operator opened this thread; inbound after it is unread. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_reach_contacts_platform_handle").on(t.platform, t.handle),
    index("ix_reach_contacts_state").on(t.state),
    index("ix_reach_contacts_company_id").on(t.companyId),
    oneOf("ck_reach_contacts_platform", t.platform, PLATFORMS),
    oneOf("ck_reach_contacts_state", t.state, CONTACT_STATES),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_reach_contacts_company_id_companies",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_reach_contacts_person_id_people",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [reachAccounts.id],
      name: "fk_reach_contacts_account_id_reach_accounts",
    }).onDelete("set null"),
  ],
);

export const reachMessages = pgTable(
  "reach_messages",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id").notNull(),
    accountId: uuid("account_id"),
    direction: varchar("direction", { length: 4, enum: DIRECTIONS }).notNull(),
    kind: varchar("kind", { length: 16, enum: MESSAGE_KINDS }).notNull(),
    /** The sequence step (1-based) for `sequence` rows. */
    step: smallint("step"),
    /** The slot key the body was rendered from. */
    template: varchar("template", { length: 120 }),
    subject: text("subject"),
    body: text("body").notNull(),
    state: varchar("state", { length: 16, enum: MESSAGE_STATES }).notNull(),
    stateReason: text("state_reason"),
    /** Outbound: not before this. */
    dueAt: timestamp("due_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** The platform's id for it (an inbound message's name, a sent one's ref when given). */
    ref: varchar("ref", { length: 200 }),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_reach_messages_contact_id").on(t.contactId),
    index("ix_reach_messages_due").on(t.state, t.dueAt),
    /** One inbound row per platform id. */
    uniqueIndex("uq_reach_messages_in_ref")
      .on(t.contactId, t.ref)
      .where(sql`(direction)::text = 'in'::text`),
    oneOf("ck_reach_messages_direction", t.direction, DIRECTIONS),
    oneOf("ck_reach_messages_kind", t.kind, MESSAGE_KINDS),
    oneOf("ck_reach_messages_state", t.state, MESSAGE_STATES),
    foreignKey({
      columns: [t.contactId],
      foreignColumns: [reachContacts.id],
      name: "fk_reach_messages_contact_id_reach_contacts",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [reachAccounts.id],
      name: "fk_reach_messages_account_id_reach_accounts",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_reach_messages_run_id_runs",
    }).onDelete("set null"),
  ],
);

export const reachTemplates = pgTable("reach_templates", {
  /** A slot key: `<platform>:<sequence>#<step>` or `linkedin:connect-note`. */
  key: varchar("key", { length: 120 }).primaryKey(),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Who saved it: an operator's email, or `cli`. */
  updatedBy: varchar("updated_by", { length: 200 }).notNull(),
});

export type ReachAccount = typeof reachAccounts.$inferSelect;
export type ReachContact = typeof reachContacts.$inferSelect;
export type ReachMessage = typeof reachMessages.$inferSelect;
