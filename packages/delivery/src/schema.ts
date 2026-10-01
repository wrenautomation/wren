import { clientMembers, clients } from "@wren/core/clients";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * What we do for each client, in the main database beside the registry (D11):
 * the dated plan, the timeline, deliverables, asks and results. Every row hangs
 * off an engagement, which hangs off the client, so all of it drops with them.
 */
export const delivery = pgSchema("delivery");

/** `onboarding`: the contract, setup invoice and access come first; the plan starts when it's signed and paid. */
export const ENGAGEMENT_STATUSES = ["onboarding", "active", "paused", "done"] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

/** One bought offer for one client (D1). While onboarding, `starts_on` is the day we aim for. */
export const engagements = delivery.table(
  "engagements",
  {
    id: serial("id").notNull(),
    clientId: varchar("client_id", { length: 40 }).notNull(),
    /** An id in the offers registry. */
    offerId: varchar("offer_id", { length: 64 }).notNull(),
    startsOn: date("starts_on").notNull(),
    status: varchar("status", { length: 16, enum: ENGAGEMENT_STATUSES })
      .default("active")
      .notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_engagements" }),
    foreignKey({
      columns: [t.clientId],
      foreignColumns: [clients.id],
      name: "fk_engagements_client",
    }).onDelete("cascade"),
    index("ix_engagements_client").on(t.clientId),
    oneOf("ck_engagements_status", t.status, ENGAGEMENT_STATUSES),
  ],
);
export type Engagement = typeof engagements.$inferSelect;

/** A phase of the offer's plan with dates (D2). The planned dates never move; `due_on` does, with a reason. */
export const milestones = delivery.table(
  "milestones",
  {
    id: serial("id").notNull(),
    engagementId: integer("engagement_id").notNull(),
    /** The plan's phase id: `set-up`. */
    key: varchar("key", { length: 64 }).notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    plannedFrom: date("planned_from").notNull(),
    /** Null: open-ended, it runs until we stop. */
    plannedTo: date("planned_to"),
    dueOn: date("due_on"),
    doneOn: date("done_on"),
    /** Why `due_on` moved off `planned_to`; set on every slip. */
    slipReason: text("slip_reason"),
    /** What the plan promised from this phase. */
    promised: jsonb("promised").$type<string[]>().default([]).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_milestones" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_milestones_engagement",
    }).onDelete("cascade"),
    unique("uq_milestones_key").on(t.engagementId, t.key),
  ],
);
export type Milestone = typeof milestones.$inferSelect;

/** The timeline (D3): what we did, what's next. Internal ones never reach a client (D12). */
export const updates = delivery.table(
  "updates",
  {
    id: serial("id").notNull(),
    engagementId: integer("engagement_id").notNull(),
    milestoneId: integer("milestone_id"),
    /** An email, or a product's name for what it posts itself. */
    author: text("author").notNull(),
    body: text("body").notNull(),
    internal: boolean("internal").default(false).notNull(),
    /** An operator took it down; kept for the record. */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_updates" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_updates_engagement",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.milestoneId],
      foreignColumns: [milestones.id],
      name: "fk_updates_milestone",
    }).onDelete("set null"),
    index("ix_updates_engagement").on(t.engagementId, t.createdAt),
    index("ix_updates_milestone").on(t.milestoneId),
  ],
);
export type Update = typeof updates.$inferSelect;

export const DELIVERABLE_KINDS = ["file", "link", "loom", "doc"] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];
export const DELIVERABLE_STATES = ["waiting", "approved", "changes"] as const;
export type DeliverableState = (typeof DELIVERABLE_STATES)[number];

/** Something we hand over (D4). A new version is a new row pointing at the last. */
export const deliverables = delivery.table(
  "deliverables",
  {
    id: serial("id").notNull(),
    engagementId: integer("engagement_id").notNull(),
    milestoneId: integer("milestone_id"),
    title: text("title").notNull(),
    kind: varchar("kind", { length: 8, enum: DELIVERABLE_KINDS }).notNull(),
    url: text("url"),
    /** In the private bucket, under `clients/<id>/`. */
    fileKey: text("file_key"),
    version: integer("version").default(1).notNull(),
    previousId: integer("previous_id"),
    status: varchar("status", { length: 8, enum: DELIVERABLE_STATES }).default("waiting").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_deliverables" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_deliverables_engagement",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.milestoneId],
      foreignColumns: [milestones.id],
      name: "fk_deliverables_milestone",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.previousId],
      foreignColumns: [t.id],
      name: "fk_deliverables_previous",
    }).onDelete("set null"),
    index("ix_deliverables_engagement").on(t.engagementId),
    index("ix_deliverables_milestone").on(t.milestoneId),
    // Home's "latest version only" asks who points here.
    index("ix_deliverables_previous").on(t.previousId),
    oneOf("ck_deliverables_kind", t.kind, DELIVERABLE_KINDS),
    oneOf("ck_deliverables_status", t.status, DELIVERABLE_STATES),
    check("ck_deliverables_where", sql`${t.url} is not null or ${t.fileKey} is not null`),
  ],
);
export type Deliverable = typeof deliverables.$inferSelect;

/** What we need from the client (D5), answered in place. */
export const asks = delivery.table(
  "asks",
  {
    id: serial("id").notNull(),
    engagementId: integer("engagement_id").notNull(),
    milestoneId: integer("milestone_id"),
    text: text("text").notNull(),
    dueOn: date("due_on"),
    answer: text("answer"),
    fileKey: text("file_key"),
    answeredBy: text("answered_by"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_asks" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_asks_engagement",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.milestoneId],
      foreignColumns: [milestones.id],
      name: "fk_asks_milestone",
    }).onDelete("set null"),
    index("ix_asks_engagement").on(t.engagementId),
    index("ix_asks_milestone").on(t.milestoneId),
  ],
);
export type Ask = typeof asks.$inferSelect;

/** The offer's measures so far (D6), one row per measure. */
export const results = delivery.table(
  "results",
  {
    engagementId: integer("engagement_id").notNull(),
    /** A measure key on the offer: `meetings_booked`. */
    key: varchar("key", { length: 64 }).notNull(),
    value: numeric("value", { mode: "number" }).notNull(),
    note: text("note"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.engagementId, t.key], name: "pk_results" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_results_engagement",
    }).onDelete("cascade"),
  ],
);
export type Result = typeof results.$inferSelect;

/** What mail a person gets about a client's work (D9). */
export const MAIL_LEVELS = ["all", "digest", "off"] as const;
export type MailLevel = (typeof MAIL_LEVELS)[number];

/**
 * Each member's mail level and how far they've been told. No row means "all",
 * told through the day they were invited. Goes with the membership.
 */
export const memberMail = delivery.table(
  "member_mail",
  {
    clientId: varchar("client_id", { length: 40 }).notNull(),
    email: text("email").notNull(),
    level: varchar("level", { length: 8, enum: MAIL_LEVELS }).default("all").notNull(),
    /** New asks and deliverables up to here have been mailed (or skipped by level). */
    toldThrough: timestamp("told_through", { withTimezone: true }),
    /** The Friday the last digest went out for. */
    digestOn: date("digest_on"),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.email], name: "pk_member_mail" }),
    foreignKey({
      columns: [t.clientId, t.email],
      foreignColumns: [clientMembers.clientId, clientMembers.email],
      name: "fk_member_mail_member",
    }).onDelete("cascade"),
    oneOf("ck_member_mail_level", t.level, MAIL_LEVELS),
  ],
);
export type MemberMail = typeof memberMail.$inferSelect;

/** The weekly one-tap "how's it going", 1 to 5 (D10). One per person per engagement per week. */
export const pulses = delivery.table(
  "pulses",
  {
    id: serial("id").notNull(),
    engagementId: integer("engagement_id").notNull(),
    email: text("email").notNull(),
    /** The Monday of the week it's for. */
    week: date("week").notNull(),
    score: smallint("score").notNull(),
    note: text("note"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_pulses" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_pulses_engagement",
    }).onDelete("cascade"),
    unique("uq_pulses_week").on(t.engagementId, t.email, t.week),
    check("ck_pulses_score", sql`${t.score} between 1 and 5`),
  ],
);
export type Pulse = typeof pulses.$inferSelect;

/**
 * What DeliveryWatch told the operator (D8), so a standing problem pings once a
 * week, not every hour. A row goes when its problem clears; a new one pings again.
 */
export const pings = delivery.table(
  "pings",
  {
    engagementId: integer("engagement_id").notNull(),
    /** "quiet", "away", "step:<key>", "ask:<id>", "pulse:<id>", "reply:<u|d><id>" or "invoice:<id>". */
    about: varchar("about", { length: 80 }).notNull(),
    pingedAt: timestamp("pinged_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.engagementId, t.about], name: "pk_pings" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_pings_engagement",
    }).onDelete("cascade"),
  ],
);
export type Ping = typeof pings.$inferSelect;

/**
 * A thread under an update or a deliverable: the client asks, Wren answers.
 * Exactly one of the two. `fromWren` says which side wrote it, for who gets told.
 */
export const comments = delivery.table(
  "comments",
  {
    id: serial("id").notNull(),
    engagementId: integer("engagement_id").notNull(),
    updateId: integer("update_id"),
    deliverableId: integer("deliverable_id"),
    author: text("author").notNull(),
    fromWren: boolean("from_wren").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_comments" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_comments_engagement",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.updateId],
      foreignColumns: [updates.id],
      name: "fk_comments_update",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.deliverableId],
      foreignColumns: [deliverables.id],
      name: "fk_comments_deliverable",
    }).onDelete("cascade"),
    index("ix_comments_update").on(t.updateId),
    index("ix_comments_deliverable").on(t.deliverableId),
    index("ix_comments_engagement").on(t.engagementId, t.createdAt),
    check("ck_comments_on", sql`num_nonnulls(${t.updateId}, ${t.deliverableId}) = 1`),
  ],
);
export type Comment = typeof comments.$inferSelect;

export const INVOICE_STATUSES = ["open", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * An invoice we sent through Wise for an engagement, tracked here so the client
 * sees what's owed and we see what's late. Wise holds the invoice itself; `link`
 * is its page to view and pay. Overdue is an open one past `due_on`.
 */
export const invoices = delivery.table(
  "invoices",
  {
    id: serial("id").notNull(),
    engagementId: integer("engagement_id").notNull(),
    /** The number printed on the Wise invoice. */
    number: varchar("number", { length: 64 }).notNull(),
    /** What it's for, as the client reads it: "Setup", "Meetings booked in October". */
    description: text("description").notNull(),
    cents: integer("cents").notNull(),
    currency: varchar("currency", { length: 3 }).default("USD").notNull(),
    issuedOn: date("issued_on").notNull(),
    dueOn: date("due_on").notNull(),
    status: varchar("status", { length: 16, enum: INVOICE_STATUSES }).default("open").notNull(),
    paidOn: date("paid_on"),
    link: text("link"),
    /** The setup fee: paying it (with the contract signed) starts the plan. */
    setup: boolean("setup").default(false).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_invoices" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_invoices_engagement",
    }).onDelete("cascade"),
    // Wise numbers its invoices across all our clients.
    unique("uq_invoices_number").on(t.number),
    index("ix_invoices_engagement").on(t.engagementId),
    oneOf("ck_invoices_status", t.status, INVOICE_STATUSES),
    check("ck_invoices_cents", sql`${t.cents} > 0`),
    check("ck_invoices_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("ck_invoices_paid", sql`(${t.status} = 'paid') = (${t.paidOn} is not null)`),
  ],
);
export type Invoice = typeof invoices.$inferSelect;

/** What the client pays, frozen into the contract when it's issued. Cents; null = none. */
export interface Terms {
  currency: string;
  setupCents: number;
  monthlyCents: number | null;
  perUnitCents: number | null;
  /** What a per-unit fee counts, singular: "meeting booked". */
  unit: string | null;
  /** The most the per-unit fees add up to. */
  capCents: number | null;
  /** How long it runs, or null until either side ends it. */
  days: number | null;
  /** Past `days`, it carries on until this many units, or null to stop at `days`. Older terms lack it. */
  until?: number | null;
  /** Days after an invoice's date that it's due. */
  payDays: number;
}

/**
 * The contract for an engagement: the exact text we issued, and who signed it,
 * when and from where. `body` never changes after issue; `sha256` is its
 * fingerprint, checked on signing so nobody signs a text they didn't see.
 */
export const agreements = delivery.table(
  "agreements",
  {
    id: serial("id").notNull(),
    engagementId: integer("engagement_id").notNull(),
    /** The template's version: `2026-10-01`. */
    version: varchar("version", { length: 16 }).notNull(),
    terms: jsonb("terms").$type<Terms>().notNull(),
    body: text("body").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    issuedBy: text("issued_by").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
    signerName: text("signer_name"),
    signerTitle: text("signer_title"),
    signerEmail: text("signer_email"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signedIp: text("signed_ip"),
    signedAgent: text("signed_agent"),
    /** The signed copy went out by email. */
    mailedAt: timestamp("mailed_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_agreements" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_agreements_engagement",
    }).onDelete("cascade"),
    unique("uq_agreements_engagement").on(t.engagementId),
    check(
      "ck_agreements_signed",
      sql`(${t.signedAt} is null) = (${t.signerName} is null) and (${t.signedAt} is null) = (${t.signerEmail} is null)`,
    ),
  ],
);
export type Agreement = typeof agreements.$inferSelect;

export const ACCESS_STATUSES = ["open", "granted", "declined", "revoked"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

/**
 * A formal request for access to one of the client's systems: what, how much,
 * why, and how to take it back. The client answers it; `revoked` is them
 * taking it back, which they can do any time.
 */
export const accessRequests = delivery.table(
  "access_requests",
  {
    id: serial("id").notNull(),
    engagementId: integer("engagement_id").notNull(),
    /** "Your ATS". */
    system: text("system").notNull(),
    /** "Read only: candidates and open roles". */
    scope: text("scope").notNull(),
    why: text("why").notNull(),
    revoke: text("revoke").notNull(),
    status: varchar("status", { length: 16, enum: ACCESS_STATUSES }).default("open").notNull(),
    /** The client's note: who they added, or why they can't. */
    note: text("note"),
    answeredBy: text("answered_by"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_access_requests" }),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_access_requests_engagement",
    }).onDelete("cascade"),
    index("ix_access_requests_engagement").on(t.engagementId),
    oneOf("ck_access_requests_status", t.status, ACCESS_STATUSES),
  ],
);
export type AccessRequest = typeof accessRequests.$inferSelect;
