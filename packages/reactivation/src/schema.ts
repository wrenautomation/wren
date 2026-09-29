import { enrollments, threadEvents } from "@wren/channel-email/schema";
import { companies, imports, people, runs } from "@wren/core/schema";
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
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * One row per CRM record, kept whole. People dedupe (the same person twice in
 * the export is one `people` row); these rows do not, so duplicates stay visible
 * to the health report. Re-importing an export updates its rows, never doubles them.
 */
export const crmContacts = pgTable(
  "crm_contacts",
  {
    id: serial("id").notNull(),
    personId: integer("person_id").notNull(),
    companyId: integer("company_id").notNull(),
    importId: integer("import_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    /** The CRM dialect it came in as: hubspot, salesforce, bullhorn, crm-generic. */
    format: varchar("format", { length: 32 }).notNull(),
    /** The CRM's own record id, else a hash of the row. */
    crmKey: varchar("crm_key", { length: 128 }).notNull(),
    /** As the CRM holds it (normalized when it parses); the health report judges it. */
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 64 }),
    /** The recruiter who owns the relationship. */
    owner: text("owner"),
    status: text("status"),
    lastContactedOn: date("last_contacted_on"),
    lastPlacementOn: date("last_placement_on"),
    addedOn: date("added_on"),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_crm_contacts" }),
    unique("uq_crm_contacts_key").on(t.format, t.crmKey),
    index("ix_crm_contacts_person_id").on(t.personId),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_crm_contacts_person_id_people",
    }),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_crm_contacts_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_crm_contacts_import_id_imports",
    }),
  ],
);

export type CrmContact = typeof crmContacts.$inferSelect;

/**
 * Who goes first (R10), one row per CRM person. `reasons` says why, each with
 * its points and the findings behind it, so the portal can show it. Rebuilt
 * whenever what it stands on changes; cheap, no calls.
 */
export const contactScores = pgTable(
  "contact_scores",
  {
    personId: integer("person_id").notNull(),
    score: integer("score").notNull(),
    /** `[{ reason, points, findingIds }]`, biggest first. */
    reasons: jsonb("reasons").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId], name: "pk_contact_scores" }),
    index("ix_contact_scores_score").on(t.score),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_contact_scores_person_id_people",
    }),
  ],
);
export type ContactScore = typeof contactScores.$inferSelect;

/**
 * `written`: at least one cited sentence survived the gate. `empty`: none did,
 * so there is nothing to show. `failed`: the model's answer didn't parse. All
 * three are kept so the same inputs are never paid for twice.
 */
export const BRIEF_STATES = ["written", "empty", "failed"] as const;
export type BriefState = (typeof BRIEF_STATES)[number];

/**
 * Why reach out to this person now (R9), one row per CRM person: sentences
 * that each cite a finding (`[f<id>]`) or a CRM record (`[c<id>]`), or they
 * were dropped. `inputs_hash` is what it was written from; a new hash means
 * a new brief.
 */
export const briefs = pgTable(
  "briefs",
  {
    personId: integer("person_id").notNull(),
    state: varchar("state", { length: 16, enum: BRIEF_STATES }).notNull(),
    text: text("text").notNull(),
    /** `{ findings: [ids], crm: [ids] }`: what the kept sentences cite. */
    citations: jsonb("citations").notNull(),
    /** Sentences the gate dropped, with why. */
    dropped: jsonb("dropped").notNull(),
    inputsHash: varchar("inputs_hash", { length: 32 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 16 }).notNull(),
    /** The call as made: raw text, parse error, provider refusal. */
    llm: jsonb("llm"),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId], name: "pk_briefs" }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_briefs_person_id_people",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_briefs_run_id_runs",
    }),
    oneOf("ck_briefs_state", t.state, BRIEF_STATES),
  ],
);
export type Brief = typeof briefs.$inferSelect;

/** A recruiter at the client: whose contacts they are, and the name the emails go out under. */
export interface Recruiter {
  name: string;
  email: string;
  /** How the CRM writes their name in its owner column; matched case-insensitively. */
  owners: string[];
}

/**
 * The firm's own details, one row (R11, R21): what the composer writes as. Kept
 * in the client's database because only that client's work reads it.
 */
export const clientProfile = pgTable(
  "client_profile",
  {
    /** Always true: the table holds one row. */
    one: boolean("one").default(true).notNull(),
    firm: text("firm").notNull(),
    /** What they place, in their words: "senior software engineers in fintech". */
    sells: text("sells").notNull(),
    /** Their average placement fee in dollars; shown in the portal, never in an email. */
    feeAvg: integer("fee_avg"),
    /** How they write: a few lines of guidance, or a past email they're proud of. */
    voice: text("voice").notNull(),
    recruiters: jsonb("recruiters").$type<Recruiter[]>().default([]).notNull(),
    /** Who gets a reply when the contact has no owner we know: a recruiter's email. */
    defaultRecruiter: varchar("default_recruiter", { length: 320 }),
    /** Pinned under every email; `{name}` becomes the sending recruiter's name. */
    signature: text("signature").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.one], name: "pk_client_profile" }),
    check("ck_client_profile_one", sql`${t.one}`),
  ],
);
export type ClientProfile = typeof clientProfile.$inferSelect;

/**
 * `drafted`: the enrollment and its messages were written. `failed`: the model's
 * answer didn't parse or broke a rule, with why. Both keep the call, so the
 * same inputs are never paid for twice.
 */
export const COMPOSITION_STATES = ["drafted", "failed"] as const;
export type CompositionState = (typeof COMPOSITION_STATES)[number];

/** One row per compose attempt at a person (R11): what was asked, what came back, what it became. */
export const compositions = pgTable(
  "compositions",
  {
    id: serial("id").notNull(),
    personId: integer("person_id").notNull(),
    state: varchar("state", { length: 16, enum: COMPOSITION_STATES }).notNull(),
    enrollmentId: integer("enrollment_id"),
    /** Why it failed: the broken rules, or the parse error. */
    detail: text("detail"),
    inputsHash: varchar("inputs_hash", { length: 32 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 16 }).notNull(),
    llm: jsonb("llm"),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_compositions" }),
    index("ix_compositions_person_id").on(t.personId),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_compositions_person_id_people",
    }),
    foreignKey({
      columns: [t.enrollmentId],
      foreignColumns: [enrollments.id],
      name: "fk_compositions_enrollment_id_enrollments",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_compositions_run_id_runs",
    }),
    oneOf("ck_compositions_state", t.state, COMPOSITION_STATES),
    check(
      "ck_compositions_enrollment_iff_drafted",
      sql`(${t.enrollmentId} is not null) = (${t.state} = 'drafted')`,
    ),
  ],
);
export type Composition = typeof compositions.$inferSelect;

/**
 * An interested reply passed to the recruiter who owns the contact (R13), and
 * whether it became a meeting: the billing unit. One per reply.
 */
export const handoffs = pgTable(
  "handoffs",
  {
    id: serial("id").notNull(),
    threadEventId: integer("thread_event_id").notNull(),
    enrollmentId: integer("enrollment_id").notNull(),
    personId: integer("person_id"),
    /** Who it went to. */
    recruiterEmail: varchar("recruiter_email", { length: 320 }).notNull(),
    /** Our Message-ID on the forward, minted before it is sent. */
    forwardMessageId: varchar("forward_message_id", { length: 255 }).notNull(),
    /** Null until the transport took it; a row without one is sent again. */
    forwardedAt: timestamp("forwarded_at", { withTimezone: true }),
    meetingBookedAt: timestamp("meeting_booked_at", { withTimezone: true }),
    /** Who marked it: a portal login's email, or `operator`. */
    bookedBy: varchar("booked_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_handoffs" }),
    unique("uq_handoffs_thread_event_id").on(t.threadEventId),
    foreignKey({
      columns: [t.threadEventId],
      foreignColumns: [threadEvents.id],
      name: "fk_handoffs_thread_event_id_thread_events",
    }),
    foreignKey({
      columns: [t.enrollmentId],
      foreignColumns: [enrollments.id],
      name: "fk_handoffs_enrollment_id_enrollments",
    }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_handoffs_person_id_people",
    }),
    check(
      "ck_handoffs_booked_by_iff_booked",
      sql`(${t.bookedBy} is null) = (${t.meetingBookedAt} is null)`,
    ),
  ],
);
export type Handoff = typeof handoffs.$inferSelect;
