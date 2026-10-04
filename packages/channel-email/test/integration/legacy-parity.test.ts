import { readFileSync } from "node:fs";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The ported schema must equal the emails_gen schema object-for-object, so the
 * live data restores with `pg_dump --data-only` and nothing is lost.
 * Legacy DDL is loaded from the fixture into a second database in the same container.
 */
const FIXTURE = new URL("../fixtures/emailsgen-schema.sql", import.meta.url).pathname;
const SKIP_TABLES = new Set(["alembic_version"]);
const VIEW_RENAMES: Record<string, string> = {
  llm_calls: "email_llm_calls",
  stage_costs: "email_stage_costs",
};
/**
 * Checks wren widened since the port: values added to an enum check. Legacy
 * rows still satisfy them, so a restore still holds; anything else must match.
 */
const WIDENED: Record<string, string[]> = {
  ck_people_personorigin: ["linkedin", "crm"],
  ck_suppressions_suppressionkind: ["phone"],
  ck_contact_candidates_candidateevidence: ["crm"],
  ck_documents_documentkind: ["snippet", "profile"],
  ck_messages_approvalsource: ["client"],
  ck_enrichments_enrichmentkind: ["opener", "video"],
  ck_enrollments_stopreason: ["undeliverable"],
};
const unwiden = (c: Catalog["constraints"][number]) => ({
  ...c,
  def: (WIDENED[c.name] ?? []).reduce(
    (d, v) => d.replace(`, ('${v}'::character varying)::text`, ""),
    c.def,
  ),
});
/**
 * Objects wren added to legacy tables after the cutover (2026-09-19), when the
 * legacy data was already restored. Only these may exist beyond the legacy set.
 */
const ADDED = {
  columns: new Set([
    "enrollments.offer",
    "messages.link_code",
    "enrollments.contact_round",
    "enrollments.away_until",
    "companies.decline_reason",
    "messages.offered_times",
    "documents.html_key",
    "documents.tel_hrefs",
    "companies.linkedin_url",
    // 2026-10-04: copy experiments; a genome's lineage.
    "template_versions.parent_version",
    "template_versions.experiment_id",
  ]),
  constraints: new Set(["uq_messages_link_code", "fk_template_versions_experiment_id_experiments"]),
  indexes: new Set([
    "ix_enrollments_offer",
    "uq_messages_link_code",
    "ix_verifications_email_checked_at",
    // 2026-10-03 database audit: every foreign key indexed, the domain lookup indexed.
    "ix_companies_import_id",
    "ix_contact_candidates_lead_id",
    "ix_import_errors_claimant_company_id",
    "ix_import_errors_company_id",
    "ix_imports_superseded_by",
    "ix_leads_company_id",
    "ix_leads_import_id",
    "ix_leads_suppression_id",
    "ix_people_import_id",
    "ix_sightings_import_id",
    "ix_thread_events_in_reply_to_message_id",
    "ix_verifications_email_domain",
    // 2026-10-04: the console's firm view reads indexes only.
    "ix_companies_firm_records",
    "ix_documents_company_fetched",
    "ix_leads_company_verified",
    "ix_people_company_created",
    "ix_template_versions_experiment_id",
  ]),
  /** Legacy views wren grew (lead recycling, recruiting ranks): still present, bodies free to differ. */
  views: new Set(["campaign_funnel", "enrollment_outcomes", "person_facts"]),
};

/** Legacy indexes wren dropped: each a prefix of an index that serves the same reads (2026-10-03 audit, 2026-10-04). */
const DROPPED_INDEXES = new Set([
  "ix_documents_company_id",
  "ix_people_company_id",
  "ix_contact_candidates_person_id",
  "ix_enrichments_company_id",
  "ix_enrichments_document_id",
  "ix_messages_enrollment_id",
]);

interface Catalog {
  columns: { tbl: string; col: string; type: string; notnull: boolean; def: string | null }[];
  constraints: { tbl: string; name: string; def: string }[];
  indexes: { tbl: string; name: string; def: string }[];
  views: { name: string; def: string }[];
}

async function describeDb(client: postgres.Sql, only: Set<string>): Promise<Catalog> {
  const columns = await client<Catalog["columns"]>`
    select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as def
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    order by 1, 2`;
  const constraints = await client<Catalog["constraints"]>`
    select c.relname as tbl, x.conname as name, pg_get_constraintdef(x.oid) as def
    from pg_constraint x join pg_class c on c.oid = x.conrelid
    where x.connamespace = 'public'::regnamespace order by 1, 2`;
  const indexes = await client<Catalog["indexes"]>`
    select tablename as tbl, indexname as name, indexdef as def
    from pg_indexes where schemaname = 'public' order by 1, 2`;
  const views = await client<Catalog["views"]>`
    select viewname as name, pg_get_viewdef(('public.' || viewname)::regclass, true) as def
    from pg_views where schemaname = 'public' order by 1`;
  const keep = <T extends { tbl: string }>(rows: T[]) => rows.filter((r) => only.has(r.tbl));
  return {
    columns: keep([...columns]),
    constraints: keep([...constraints]),
    indexes: keep([...indexes]),
    views: [...views],
  };
}

let pg: TestPostgres;
let legacy: postgres.Sql;
let wren: postgres.Sql;
let legacyTables: Set<string>;

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute(sql`create database legacy`);
  legacy = postgres(pg.url.replace(/\/[^/]+$/, "/legacy"), { max: 1 });
  await legacy.unsafe(readFileSync(FIXTURE, "utf8"));
  wren = postgres(pg.url, { max: 1 });
  const rows = await legacy<
    { tablename: string }[]
  >`select tablename from pg_tables where schemaname='public'`;
  legacyTables = new Set(rows.map((r) => r.tablename).filter((t) => !SKIP_TABLES.has(t)));
});
afterAll(async () => {
  await legacy.end();
  await wren.end();
  await pg.stop();
});

describe("legacy parity", () => {
  it("covers all 22 emails_gen tables", () => {
    expect(legacyTables.size).toBe(22);
  });

  it("has identical columns, constraints, indexes and views", async () => {
    const [a, b] = await Promise.all([
      describeDb(legacy, legacyTables),
      describeDb(wren, legacyTables),
    ]);
    const renameView = (v: { name: string; def: string }) => ({
      name: VIEW_RENAMES[v.name] ?? v.name,
      def: v.def.replace(/\b(llm_calls|stage_costs)\b/g, (m) => VIEW_RENAMES[m] ?? m),
    });
    const grown = (v: { name: string; def: string }) =>
      ADDED.views.has(v.name) ? { name: v.name, def: "(grown)" } : v;
    const legacyViews = a.views
      .map(renameView)
      .map(grown)
      .sort((x, y) => x.name.localeCompare(y.name));
    const wrenViews = b.views.filter((v) => legacyViews.some((l) => l.name === v.name)).map(grown);
    expect(b.columns.filter((c) => !ADDED.columns.has(`${c.tbl}.${c.col}`))).toEqual(a.columns);
    expect(b.constraints.filter((c) => !ADDED.constraints.has(c.name)).map(unwiden)).toEqual(
      a.constraints,
    );
    expect(b.indexes.filter((i) => !ADDED.indexes.has(i.name))).toEqual(
      a.indexes.filter((i) => !DROPPED_INDEXES.has(i.name)),
    );
    expect(wrenViews).toEqual(legacyViews);
    expect(wrenViews).toHaveLength(16);
  });
});
