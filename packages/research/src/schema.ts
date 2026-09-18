import { companies, runs } from "@wren/core/schema";
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
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const DOCUMENT_KINDS = ["webpage", "pdf"] as const;
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
