import { contactCandidates, enrollments, threadEvents } from "@wren/channel-email/schema";
import { companies, imports, people, runs } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
import { findings } from "@wren/research/schema";
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
    index("ix_crm_contacts_import_id").on(t.importId),
    index("ix_crm_contacts_company_id").on(t.companyId),
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
 * What a score says to do. `reach_out`: a reason to write now (a move with a
 * firm to write to, or open roles at their company); only these get drafts.
 * `keep_warm`: still there, or not found, and nothing new: no draft, the
 * portal's "Keep warm" view. `none`: left, and nobody knows for where.
 */
export const NEXT_STEPS = ["reach_out", "keep_warm", "none"] as const;
export type NextStep = (typeof NEXT_STEPS)[number];

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
    /** Null only on a row scored before it existed: the next score fills it. */
    nextStep: varchar("next_step", { length: 16, enum: NEXT_STEPS }),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId], name: "pk_contact_scores" }),
    index("ix_contact_scores_score").on(t.score),
    oneOf("ck_contact_scores_nextstep", t.nextStep, NEXT_STEPS),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_contact_scores_person_id_people",
    }),
  ],
);
export type ContactScore = typeof contactScores.$inferSelect;

/**
 * `found`: a pattern address at the new firm passed the verifier. `no_domain`:
 * no site that speaks for the firm. `catch_all`: its server takes any address,
 * so none is proven. `not_found`: every pattern tried bounced or stayed unsure.
 */
export const MOVER_OUTCOMES = ["found", "no_domain", "catch_all", "not_found"] as const;
export type MoverOutcome = (typeof MOVER_OUTCOMES)[number];

/**
 * A mover's address at their new firm, one row per move (`job_change`
 * finding) tried. A miss is tried again after a while; a newer move is a new row.
 */
export const moverAddresses = pgTable(
  "mover_addresses",
  {
    findingId: integer("finding_id").notNull(),
    personId: integer("person_id").notNull(),
    /** The new firm's site, when one was found. */
    domain: varchar("domain", { length: 255 }),
    outcome: varchar("outcome", { length: 16, enum: MOVER_OUTCOMES }).notNull(),
    /** The verified address, when `found`. */
    candidateId: integer("candidate_id"),
    triedAt: timestamp("tried_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.findingId], name: "pk_mover_addresses" }),
    index("ix_mover_addresses_person_id").on(t.personId),
    index("ix_mover_addresses_candidate_id").on(t.candidateId),
    foreignKey({
      columns: [t.findingId],
      foreignColumns: [findings.id],
      name: "fk_mover_addresses_finding_id_findings",
    }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_mover_addresses_person_id_people",
    }),
    foreignKey({
      columns: [t.candidateId],
      foreignColumns: [contactCandidates.id],
      name: "fk_mover_addresses_candidate_id_contact_candidates",
    }),
    oneOf("ck_mover_addresses_moveroutcome", t.outcome, MOVER_OUTCOMES),
    check(
      "ck_mover_addresses_found_iff_candidate",
      sql`(${t.candidateId} is not null) = (${t.outcome} = 'found')`,
    ),
  ],
);
export type MoverAddress = typeof moverAddresses.$inferSelect;

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
    index("ix_briefs_run_id").on(t.runId),
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
/** `raced`: written, then someone else enrolled the person, firm or address first. Not their failure. */
export const COMPOSITION_STATES = ["drafted", "failed", "raced"] as const;
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
    index("ix_compositions_run_id").on(t.runId),
    index("ix_compositions_enrollment_id").on(t.enrollmentId),
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
    /** The last try to forward it; the oldest try goes first, so one stuck row never blocks the rest. */
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    meetingBookedAt: timestamp("meeting_booked_at", { withTimezone: true }),
    /** Who marked it: a portal login's email, or `operator`. */
    bookedBy: varchar("booked_by", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_handoffs" }),
    index("ix_handoffs_person_id").on(t.personId),
    index("ix_handoffs_enrollment_id").on(t.enrollmentId),
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

/**
 * A call to someone on the list, marked in the portal ("Mark called"). Their Last contact is
 * the later of this and the CRM's, and their history shows who called. The CRM rows stay as the
 * CRM holds them.
 */
export const calls = pgTable(
  "calls",
  {
    id: serial("id").notNull(),
    personId: integer("person_id").notNull(),
    /** A portal login's email. */
    calledBy: varchar("called_by", { length: 320 }).notNull(),
    calledAt: timestamp("called_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_calls" }),
    index("ix_calls_person_id").on(t.personId, t.calledAt),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_calls_person_id_people",
    }),
  ],
);

/**
 * A form an account sent on one of the client's own Sites pages or forms: Keep's "visited"
 * signal (designs/2026-10-07-health.md, Keep). Our pages keep no visitor id, so only a visitor
 * who says who they are counts: an email at the account's domain, or a known contact's email.
 * Copied from Wren's `site_forms` by the reactivation pass; `entry` is that row's id.
 */
export const accountVisits = pgTable(
  "account_visits",
  {
    id: serial("id").notNull(),
    entry: uuid("entry").notNull(),
    companyId: integer("company_id").notNull(),
    /** The contact whose email it was, when one is known. */
    personId: integer("person_id"),
    email: varchar("email", { length: 320 }).notNull(),
    /** The form's name, else the page's title. */
    what: text("what").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_account_visits" }),
    unique("uq_account_visits_entry").on(t.entry),
    index("ix_account_visits_company_at").on(t.companyId, t.at),
    index("ix_account_visits_person_id").on(t.personId).where(sql`person_id is not null`),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_account_visits_company_id_companies",
    }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_account_visits_person_id_people",
    }),
  ],
);

/**
 * A job order from the client's ATS export, kept whole (`wren crm job-orders`). An open one
 * means the account is giving work, so Keep doesn't call it overdue. A row whose company we
 * don't know keeps the name and no `company_id`. Again replaces each order by its id.
 */
export const jobOrders = pgTable(
  "job_orders",
  {
    id: serial("id").notNull(),
    /** The ATS dialect it came in as: bullhorn, jobadder, ats-generic. */
    format: varchar("format", { length: 32 }).notNull(),
    /** The ATS's own id, else a hash of who and what. */
    orderKey: varchar("order_key", { length: 128 }).notNull(),
    companyId: integer("company_id"),
    companyName: text("company_name"),
    title: text("title"),
    status: text("status"),
    /** Read from the status and the close date: closed, filled, lost, cancelled or on hold are not. */
    open: boolean("open").notNull(),
    openings: integer("openings"),
    owner: text("owner"),
    openedOn: date("opened_on"),
    closedOn: date("closed_on"),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_job_orders" }),
    unique("uq_job_orders_key").on(t.format, t.orderKey),
    index("ix_job_orders_company_id").on(t.companyId).where(sql`open`),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_job_orders_company_id_companies",
    }),
  ],
);
