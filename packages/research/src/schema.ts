import { companies, imports, people, runs } from "@wren/core/schema";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * `snippet`: a search engine's few lines about a page (url = the page, not the
 * results page). `profile`: a platform's structured read of a profile, as JSON text.
 */
export const DOCUMENT_KINDS = ["webpage", "pdf", "snippet", "profile"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const ENRICHMENT_KINDS = [
  "people_extraction",
  "firmographics",
  "email_scan",
  "email_pick",
  "opener",
  "video",
] as const;
export type EnrichmentKind = (typeof ENRICHMENT_KINDS)[number];

export const documents = pgTable(
  "documents",
  {
    id: serial("id").notNull(),
    companyId: integer("company_id"),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    kind: varchar("kind", { length: 32, enum: DOCUMENT_KINDS }).notNull(),
    statusCode: integer("status_code"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    title: text("title"),
    text: text("text").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    /** Inline until `archivePages` moves it to the pages bucket; `htmlOf` reads either. */
    html: text("html"),
    /** Where the archived HTML is (`pages/<id>.html.gz`); null while inline. */
    htmlKey: text("html_key"),
    /** The archived page's `tel:` link targets, kept for the phone lift; null while inline. */
    telHrefs: text("tel_hrefs").array(),
    fetchTier: varchar("fetch_tier", { length: 16 }).default("httpx").notNull(),
    isShell: boolean("is_shell").default(false).notNull(),
    robotsDisallowed: boolean("robots_disallowed").default(false).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_documents" }),
    index("ix_documents_company_id").on(t.companyId),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_documents_company_id_companies",
    }),
    unique("uq_documents_url").on(t.url, t.contentHash),
    oneOf("ck_documents_documentkind", t.kind, DOCUMENT_KINDS),
  ],
);

export const enrichments = pgTable(
  "enrichments",
  {
    id: serial("id").notNull(),
    documentId: integer("document_id"),
    kind: varchar("kind", { length: 32, enum: ENRICHMENT_KINDS }).notNull(),
    model: varchar("model", { length: 64 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 16 }).notNull(),
    output: jsonb("output").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    companyId: integer("company_id"),
    runId: uuid("run_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_enrichments" }),
    index("ix_enrichments_company_id").on(t.companyId),
    index("ix_enrichments_document_id").on(t.documentId),
    index("ix_enrichments_run_id").on(t.runId),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_enrichments_company_id_companies",
    }),
    foreignKey({
      columns: [t.documentId],
      foreignColumns: [documents.id],
      name: "fk_enrichments_document_id_documents",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_enrichments_run_id_runs",
    }),
    unique("uq_enrichments_document_id").on(t.documentId, t.kind, t.model, t.promptVersion),
    unique("uq_enrichments_company_id").on(t.companyId, t.kind, t.model, t.promptVersion),
    oneOf("ck_enrichments_enrichmentkind", t.kind, ENRICHMENT_KINDS),
    check("ck_enrichments_one_subject", sql`(document_id IS NULL) <> (company_id IS NULL)`),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Enrichment = typeof enrichments.$inferSelect;
export type NewEnrichment = typeof enrichments.$inferInsert;

export const DISCOVERY_KINDS = ["discover", "verify"] as const;
export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];
/** Why one discovery unit ended the way it did; `attached`/`verified` are the passes. */
export const DISCOVERY_OUTCOMES = [
  "attached",
  "verified",
  "no_name",
  "no_candidate",
  "unreachable",
  "gate_rejected",
] as const;
export type DiscoveryOutcome = (typeof DISCOVERY_OUTCOMES)[number];

/**
 * One row per discovery or verification unit, pass or miss. A miss keeps its
 * company out of the next passes (retry after a cooling period) so a queue
 * head of unguessable names cannot block the rest; and "why has this firm no
 * domain?" has an answer.
 */
export const discoveryAttempts = pgTable(
  "discovery_attempts",
  {
    id: serial("id").notNull(),
    companyId: integer("company_id").notNull(),
    kind: varchar("kind", { length: 16, enum: DISCOVERY_KINDS }).notNull(),
    outcome: varchar("outcome", { length: 32, enum: DISCOVERY_OUTCOMES }).notNull(),
    /** The batch (imports row) the run wrote its evidence under. */
    importId: integer("import_id"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_discovery_attempts" }),
    index("ix_discovery_attempts_company_kind").on(t.companyId, t.kind, t.attemptedAt),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_discovery_attempts_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_discovery_attempts_import_id_imports",
    }),
    oneOf("ck_discovery_attempts_kind", t.kind, DISCOVERY_KINDS),
    oneOf("ck_discovery_attempts_outcome", t.outcome, DISCOVERY_OUTCOMES),
  ],
);
export type DiscoveryAttempt = typeof discoveryAttempts.$inferSelect;

/**
 * Research facts about a person or a company (R6). One row per fact, never
 * per source read: `fact_key` names the fact (subject, kind, how we know,
 * what), so seeing it again moves `observed_at` instead of adding a row.
 * Downstream reads findings, never the sources.
 */
export const FINDING_KINDS = [
  "job_change",
  "still_there",
  "left",
  "hiring",
  "post",
  "news",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const findings = pgTable(
  "findings",
  {
    id: serial("id").notNull(),
    kind: varchar("kind", { length: 32, enum: FINDING_KINDS }).notNull(),
    personId: integer("person_id"),
    companyId: integer("company_id"),
    factKey: varchar("fact_key", { length: 400 }).notNull(),
    value: jsonb("value").notNull(),
    documentId: integer("document_id"),
    sourceUrl: text("source_url"),
    /** 0..1: how sure the reading is, not how good the news is. */
    confidence: real("confidence").notNull(),
    /** How we know: `email`, `search`, `linkedin@research`, `x`, `instagram`, `crawl`. */
    via: varchar("via", { length: 64 }).notNull(),
    /** Last time a read showed it; the first time is `created_at`. */
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_findings" }),
    unique("uq_findings_fact_key").on(t.factKey),
    index("ix_findings_person_id").on(t.personId),
    index("ix_findings_company_id").on(t.companyId),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_findings_person_id_people",
    }),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_findings_company_id_companies",
    }),
    foreignKey({
      columns: [t.documentId],
      foreignColumns: [documents.id],
      name: "fk_findings_document_id_documents",
    }),
    oneOf("ck_findings_findingkind", t.kind, FINDING_KINDS),
    check("ck_findings_one_subject", sql`(person_id IS NULL) <> (company_id IS NULL)`),
    check("ck_findings_confidence", sql`confidence >= 0 AND confidence <= 1`),
  ],
);
export type Finding = typeof findings.$inferSelect;

/**
 * Where a person lookup (R7) stands, one row per person. `matched`: we trust a
 * profile as this person (its url is on `people.linkedin_url`). `unresolved`:
 * nothing matched safely, so nothing was guessed. `capped`: a platform's daily
 * cap stopped it; `retry_at` says when to try again. `tried` is the audit
 * trail (queries, reads, why each candidate was kept or dropped), for
 * measuring false matches by hand.
 */
export const LOOKUP_STATES = ["matched", "unresolved", "capped"] as const;
export type LookupState = (typeof LOOKUP_STATES)[number];

export const personLookups = pgTable(
  "person_lookups",
  {
    personId: integer("person_id").notNull(),
    state: varchar("state", { length: 16, enum: LOOKUP_STATES }).notNull(),
    tried: jsonb("tried").notNull(),
    retryAt: timestamp("retry_at", { withTimezone: true }),
    runId: uuid("run_id"),
    lookedUpAt: timestamp("looked_up_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId], name: "pk_person_lookups" }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_person_lookups_person_id_people",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_person_lookups_run_id_runs",
    }),
    oneOf("ck_person_lookups_lookupstate", t.state, LOOKUP_STATES),
  ],
);
export type PersonLookup = typeof personLookups.$inferSelect;

/**
 * Where a company's hiring check stands, one row per company. `hiring`: a
 * board or LinkedIn lists open roles (the `hiring` finding holds them).
 * `no_openings`: a board was read and lists none. `unresolved`: no board found
 * and no page to read. `capped`: a daily cap stopped it; `retry_at` says when.
 * Checks go stale: `checked_at` says how fresh the answer is.
 */
export const COMPANY_CHECK_STATES = ["hiring", "no_openings", "unresolved", "capped"] as const;
export type CompanyCheckState = (typeof COMPANY_CHECK_STATES)[number];

export const companyChecks = pgTable(
  "company_checks",
  {
    companyId: integer("company_id").notNull(),
    state: varchar("state", { length: 16, enum: COMPANY_CHECK_STATES }).notNull(),
    /** The hiring finding this check stands on; null unless hiring. */
    findingId: integer("finding_id"),
    tried: jsonb("tried").notNull(),
    retryAt: timestamp("retry_at", { withTimezone: true }),
    runId: uuid("run_id"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId], name: "pk_company_checks" }),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_company_checks_company_id_companies",
    }),
    foreignKey({
      columns: [t.findingId],
      foreignColumns: [findings.id],
      name: "fk_company_checks_finding_id_findings",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_company_checks_run_id_runs",
    }),
    oneOf("ck_company_checks_state", t.state, COMPANY_CHECK_STATES),
  ],
);
export type CompanyCheck = typeof companyChecks.$inferSelect;

/**
 * A study: one question researched from the open web into a cited report.
 * `angles` are its sub-questions, one report section each (a plain question is
 * its own single angle). Anything can be studied: a vertical before we sell to
 * it, a buyer's market, a vendor. Every claim in the report quotes a page we
 * read, or it is dropped. `drafts` are what the claims get turned into once
 * every angle is in (offer candidates, cold emails), each a task in words.
 */
export interface StudyDraftSpec {
  /** Names the draft in the report and on the command line: `offers`, `emails`. */
  key: string;
  /** The task, in full: what to write, how many, which rules to follow. */
  ask: string;
}

export const studies = pgTable(
  "studies",
  {
    id: serial("id").notNull(),
    /** How people name it on the command line: `recruiting-offers-2026-10`. */
    slug: varchar("slug", { length: 80 }).notNull(),
    question: text("question").notNull(),
    angles: jsonb("angles").$type<string[]>().notNull(),
    drafts: jsonb("drafts").$type<StudyDraftSpec[]>().notNull(),
    /** The niche it serves, when it serves one; studies are niche-free otherwise. */
    niche: varchar("niche", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_studies" }),
    unique("uq_studies_slug").on(t.slug),
  ],
);
export type Study = typeof studies.$inferSelect;

/**
 * The units of a study, in order: `plan` an angle into search queries,
 * `search` a query, `ask` an answer engine about an angle (its citations get
 * read, its prose never counts), `read` a page, `claims` an angle's pages into
 * quoted claims, `draft` the claims into something to use (offers, emails).
 * One row per unit is the checkpoint: a re-run skips what is done.
 */
export const STUDY_STEPS = ["plan", "search", "ask", "read", "claims", "draft"] as const;
export type StudyStep = (typeof STUDY_STEPS)[number];
/**
 * `failed` (an unparseable answer, a site error) is tried again on the next
 * run; the rest are final. `refused`: the provider or site said no to this
 * input. `empty`: it answered with nothing to use.
 */
export const STUDY_OUTCOMES = ["ok", "empty", "refused", "failed"] as const;
export type StudyOutcome = (typeof STUDY_OUTCOMES)[number];

export const studySteps = pgTable(
  "study_steps",
  {
    id: serial("id").notNull(),
    studyId: integer("study_id").notNull(),
    step: varchar("step", { length: 16, enum: STUDY_STEPS }).notNull(),
    /** The unit: an angle (plan, ask, claims), a query (search), a URL (read), a kind (draft). */
    key: text("key").notNull(),
    outcome: varchar("outcome", { length: 16, enum: STUDY_OUTCOMES }).notNull(),
    /** The page a read stored. */
    documentId: integer("document_id"),
    /** What the unit found: queries, hits, sources, kept and dropped claims, the LLM envelope. */
    detail: jsonb("detail").notNull(),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_study_steps" }),
    unique("uq_study_steps_unit").on(t.studyId, t.step, t.key),
    foreignKey({
      columns: [t.studyId],
      foreignColumns: [studies.id],
      name: "fk_study_steps_study_id_studies",
    }),
    foreignKey({
      columns: [t.documentId],
      foreignColumns: [documents.id],
      name: "fk_study_steps_document_id_documents",
    }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [runs.id],
      name: "fk_study_steps_run_id_runs",
    }),
    oneOf("ck_study_steps_step", t.step, STUDY_STEPS),
    oneOf("ck_study_steps_outcome", t.outcome, STUDY_OUTCOMES),
  ],
);
export type StudyStepRow = typeof studySteps.$inferSelect;
