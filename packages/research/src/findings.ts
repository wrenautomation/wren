/**
 * Writing findings (R6) about anyone: the source into `documents` once per url
 * and text, the fact upserted on its `fact_key` (seen again = `observed_at`
 * moves, the value is the latest reading). People and company research both
 * write through here.
 */
import { createHash } from "node:crypto";
import type { Queryable } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { type DocumentKind, documents, type FindingKind, findings } from "./schema.js";

export interface DocumentDraft {
  url: string;
  kind: Exclude<DocumentKind, "pdf">;
  title: string | null;
  text: string;
  /** Who fetched it: the search backend, `linkedin`, or the job board. */
  fetchTier: string;
}

interface Draft {
  kind: FindingKind;
  /** Subject, kind, how we know, what: seeing it again is the same fact. */
  factKey: string;
  value: Record<string, unknown>;
  confidence: number;
  via: string;
  sourceUrl: string | null;
  document: DocumentDraft | null;
}

/** A fact about a person. */
export interface FindingDraft extends Draft {
  personId: number;
}

/** A fact about a company. */
export interface CompanyFindingDraft extends Draft {
  companyId: number;
}

/** Postgres text and jsonb refuse NUL; pages and snippets sometimes carry one. */
export const noNul = <T>(v: T): T =>
  typeof v === "string"
    ? (v.replaceAll("\u0000", "") as T)
    : Array.isArray(v)
      ? (v.map(noNul) as T)
      : v && typeof v === "object"
        ? (Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noNul(x)])) as T)
        : v;

export async function keepDocument(db: Queryable, draft: DocumentDraft): Promise<number> {
  const d = noNul(draft);
  const contentHash = createHash("sha256").update(d.text).digest("hex");
  const [made] = await db
    .insert(documents)
    .values({
      url: d.url,
      kind: d.kind,
      title: d.title,
      text: d.text,
      contentHash,
      fetchTier: d.fetchTier,
    })
    .onConflictDoNothing({ target: [documents.url, documents.contentHash] })
    .returning({ id: documents.id });
  if (made) return made.id;
  const [had] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.url, d.url), eq(documents.contentHash, contentHash)));
  if (!had) throw new Error(`document ${d.url} neither inserted nor found`);
  return had.id;
}

/** Upsert one finding and its source; returns the finding's id. */
export async function keepFinding(
  db: Queryable,
  draft: FindingDraft | CompanyFindingDraft,
): Promise<number> {
  const f = noNul(draft);
  const documentId = f.document ? await keepDocument(db, f.document) : null;
  const row = {
    kind: f.kind,
    personId: "personId" in f ? f.personId : null,
    companyId: "companyId" in f ? f.companyId : null,
    factKey: f.factKey,
    value: f.value,
    documentId,
    sourceUrl: f.sourceUrl,
    confidence: f.confidence,
    via: f.via,
  };
  const [kept] = await db
    .insert(findings)
    .values(row)
    .onConflictDoUpdate({
      target: findings.factKey,
      set: {
        value: row.value,
        documentId,
        sourceUrl: row.sourceUrl,
        confidence: row.confidence,
        observedAt: sql`now()`,
      },
    })
    .returning({ id: findings.id });
  if (!kept) throw new Error(`finding ${f.factKey} neither inserted nor updated`);
  return kept.id;
}
