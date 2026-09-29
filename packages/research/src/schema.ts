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
    html: text("html"),
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
