import { baseColumns, nonNegative, oneOf } from "@wren/db/columns";
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
  real,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** One row per LLM request, any channel. Source of truth for spend. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    ...baseColumns,
    provider: varchar("provider", { length: 32 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    promptName: varchar("prompt_name", { length: 64 }).notNull(),
    promptHash: varchar("prompt_hash", { length: 64 }).notNull(),
    stage: varchar("stage", { length: 32 }).notNull(), // draft | edit | research | judge
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    seconds: real("seconds").notNull().default(0),
    requestId: varchar("request_id", { length: 128 }),
  },
  (t) => [
    index("ix_llm_calls_created_at").on(t.createdAt),
    index("ix_llm_calls_stage").on(t.stage),
    ...nonNegative("llm_calls", {
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      cacheReadTokens: t.cacheReadTokens,
      costUsd: t.costUsd,
      seconds: t.seconds,
    }),
  ],
);
export type LlmCall = typeof llmCalls.$inferSelect;
export type NewLlmCall = typeof llmCalls.$inferInsert;

// ---- Ported from emails_gen (exact DDL; integer ids kept for data continuity) ----

export const IMPORT_ERROR_KINDS = ["rejected", "domain_conflict", "domain_changed"] as const;
export type ImportErrorKind = (typeof IMPORT_ERROR_KINDS)[number];
export const PERSON_ORIGINS = ["registry", "website", "document", "manual", "linkedin"] as const;
export type PersonOrigin = (typeof PERSON_ORIGINS)[number];
export const LEAD_STATUSES = ["imported", "verified", "suppressed", "undeliverable"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const SUPPRESSION_KINDS = ["email", "domain"] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];
export const SUPPRESSION_REASONS = ["opt_out", "bounce", "complaint", "manual", "lifted"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").notNull(),
    command: varchar("command", { length: 64 }).notNull(),
    argv: jsonb("argv").notNull(),
    niche: varchar("niche", { length: 64 }),
    model: varchar("model", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats"),
  },
  (t) => [primaryKey({ columns: [t.id], name: "pk_runs" })],
);

export const imports = pgTable(
  "imports",
  {
    id: serial("id").notNull(),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    sourceRef: text("source_ref").notNull(),
    stats: jsonb("stats").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
    contentHash: varchar("content_hash", { length: 64 }),
    asOf: date("as_of"),
    supersededBy: integer("superseded_by"),
    defaults: jsonb("defaults"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_imports" }),
    foreignKey({
      columns: [t.supersededBy],
      foreignColumns: [t.id],
      name: "fk_imports_superseded_by_imports",
    }),
  ],
);

export const importErrors = pgTable(
  "import_errors",
  {
    id: serial("id").notNull(),
    importId: integer("import_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    kind: varchar("kind", { length: 32, enum: IMPORT_ERROR_KINDS }).notNull(),
    reason: text("reason").notNull(),
    raw: jsonb("raw"),
    companyId: integer("company_id"),
    claimantCompanyId: integer("claimant_company_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_import_errors" }),
    index("ix_import_errors_import_id").on(t.importId),
    foreignKey({
      columns: [t.claimantCompanyId],
      foreignColumns: [companies.id],
      name: "fk_import_errors_claimant_company_id_companies",
    }),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_import_errors_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_import_errors_import_id_imports",
    }),
    oneOf("ck_import_errors_importerrorkind", t.kind, IMPORT_ERROR_KINDS),
  ],
);

export const companies = pgTable(
  "companies",
  {
    id: serial("id").notNull(),
    domain: varchar("domain", { length: 255 }),
    name: varchar("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    importId: integer("import_id"),
    raw: jsonb("raw"),
    sourceKey: varchar("source_key", { length: 64 }),
    socialUrl: varchar("social_url", { length: 512 }),
    country: varchar("country", { length: 2 }),
    domainVerifiedAt: timestamp("domain_verified_at", { withTimezone: true }),
    niche: varchar("niche", { length: 32 }),
    timezone: varchar("timezone", { length: 64 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_companies" }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_companies_import_id_imports",
    }),
    unique("uq_companies_domain").on(t.domain),
    unique("uq_companies_source_key").on(t.sourceKey),
    check("ck_companies_identified", sql`(domain IS NOT NULL) OR (source_key IS NOT NULL)`),
  ],
);

export const people = pgTable(
  "people",
  {
    id: serial("id").notNull(),
    sourceKey: varchar("source_key", { length: 64 }),
    companyId: integer("company_id").notNull(),
    fullName: text("full_name").notNull(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    title: text("title"),
    isCompliance: boolean("is_compliance").notNull(),
    origin: varchar("origin", { length: 32, enum: PERSON_ORIGINS }).notNull(),
    originRef: text("origin_ref").notNull(),
    asOf: date("as_of"),
    linkedinUrl: varchar("linkedin_url", { length: 512 }),
    notes: text("notes"),
    importId: integer("import_id"),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    isTestimonial: boolean("is_testimonial").default(false).notNull(),
    testimonialOrg: text("testimonial_org"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_people" }),
    index("ix_people_company_id").on(t.companyId),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_people_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_people_import_id_imports",
    }),
    unique("uq_people_source_key").on(t.sourceKey),
    oneOf("ck_people_personorigin", t.origin, PERSON_ORIGINS),
  ],
);

export const sightings = pgTable(
  "sightings",
  {
    id: serial("id").notNull(),
    companyId: integer("company_id"),
    leadId: integer("lead_id"),
    importId: integer("import_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
    personId: integer("person_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_sightings" }),
    index("ix_sightings_company_id").on(t.companyId),
    index("ix_sightings_lead_id").on(t.leadId),
    index("ix_sightings_person_id").on(t.personId),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_sightings_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_sightings_import_id_imports",
    }),
    foreignKey({
      columns: [t.leadId],
      foreignColumns: [leads.id],
      name: "fk_sightings_lead_id_leads",
    }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_sightings_person_id_people",
    }),
    check(
      "ck_sightings_one_entity",
      sql`((((company_id IS NOT NULL))::integer + ((lead_id IS NOT NULL))::integer) + ((person_id IS NOT NULL))::integer) = 1`,
    ),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: serial("id").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    title: varchar("title"),
    persona: varchar("persona", { length: 64 }),
    source: varchar("source", { length: 64 }),
    geo: varchar("geo", { length: 64 }),
    status: varchar("status", { length: 32, enum: LEAD_STATUSES }).notNull(),
    raw: jsonb("raw").notNull(),
    companyId: integer("company_id"),
    importId: integer("import_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    country: varchar("country", { length: 2 }),
    suppressionId: integer("suppression_id"),
    socialUrl: varchar("social_url", { length: 512 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_leads" }),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_leads_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_leads_import_id_imports",
    }),
    foreignKey({
      columns: [t.suppressionId],
      foreignColumns: [suppressions.id],
      name: "fk_leads_suppression_id_suppressions",
    }),
    unique("uq_leads_email").on(t.email),
    oneOf("ck_leads_leadstatus", t.status, LEAD_STATUSES),
  ],
);

export const suppressions = pgTable(
  "suppressions",
  {
    id: serial("id").notNull(),
    kind: varchar("kind", { length: 32, enum: SUPPRESSION_KINDS }).notNull(),
    value: varchar("value", { length: 320 }).notNull(),
    reason: varchar("reason", { length: 32, enum: SUPPRESSION_REASONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_suppressions" }),
    unique("uq_suppressions_kind").on(t.kind, t.value),
    oneOf("ck_suppressions_suppressionkind", t.kind, SUPPRESSION_KINDS),
    oneOf("ck_suppressions_suppressionreason", t.reason, SUPPRESSION_REASONS),
  ],
);

export const suppressionEvents = pgTable(
  "suppression_events",
  {
    id: serial("id").notNull(),
    suppressionId: integer("suppression_id").notNull(),
    reason: varchar("reason", { length: 32, enum: SUPPRESSION_REASONS }).notNull(),
    evidence: jsonb("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_suppression_events" }),
    index("ix_suppression_events_suppression_id").on(t.suppressionId),
    foreignKey({
      columns: [t.suppressionId],
      foreignColumns: [suppressions.id],
      name: "fk_suppression_events_suppression_id_suppressions",
    }),
    oneOf("ck_suppression_events_suppressionreason", t.reason, SUPPRESSION_REASONS),
  ],
);

export type Run = typeof runs.$inferSelect;
export type ImportBatch = typeof imports.$inferSelect;
export type ImportError = typeof importErrors.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Person = typeof people.$inferSelect;
export type Sighting = typeof sightings.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Suppression = typeof suppressions.$inferSelect;
export type SuppressionEvent = typeof suppressionEvents.$inferSelect;
