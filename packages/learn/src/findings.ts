/**
 * A Learn item as a document, and its breakdown as findings (designs/2026-10-25-ingestion-engine.md,
 * Nouns). An instance on a content line and a finding point at research `documents`; the item keeps
 * its feed state and its read. Each fact `factRows` yields is one `fact` finding, keyed
 * `doc:<document>/<path>`, so a second write of the same breakdown moves nothing.
 */
import { createHash } from "node:crypto";
import type { Queryable } from "@wren/db";
import { type DocumentKind, documents, findings } from "@wren/research/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { factRows } from "./calls.js";
import { type BreakdownRow, type ITEM_KINDS, items } from "./schema.js";

/** The medium a kind is read as. */
const MEDIUM: Record<(typeof ITEM_KINDS)[number], DocumentKind> = {
  article: "webpage",
  video: "video",
  reel: "video",
  film: "video",
  post: "post",
  episode: "audio",
};

/** The item's document, made from what its feed gave the first time it is asked for. Null: no such item. */
async function documentOf(db: Queryable, id: number): Promise<number | null> {
  const [item] = await db
    .select({
      url: items.url,
      kind: items.kind,
      title: items.title,
      text: items.text,
      documentId: items.documentId,
    })
    .from(items)
    .where(eq(items.id, id));
  if (!item) return null;
  if (item.documentId !== null) return item.documentId;
  // Two workspaces with one URL and one feed text share the document.
  const [doc] = await db
    .insert(documents)
    .values({
      url: item.url,
      kind: MEDIUM[item.kind],
      contentHash: createHash("sha256").update(item.text).digest("hex"),
      title: item.title,
      text: item.text,
      fetchTier: "learn",
    })
    .onConflictDoUpdate({
      target: [documents.url, documents.contentHash],
      set: { title: sql`${documents.title}` },
    })
    .returning({ id: documents.id });
  if (!doc) throw new Error(`no document for item ${id}`);
  await db
    .update(items)
    .set({ documentId: doc.id })
    .where(and(eq(items.id, id), isNull(items.documentId)));
  return doc.id;
}

/** Write a breakdown's facts as findings on the item's document. Returns how many it holds. */
export async function factFindings(db: Queryable, b: BreakdownRow): Promise<number> {
  const doc = await documentOf(db, b.itemId);
  if (doc === null) return 0;
  const rows = factRows(b);
  if (rows.length === 0) return 0;
  await db
    .insert(findings)
    .values(
      rows.map((r) => ({
        kind: "fact" as const,
        factKey: `doc:${doc}/${r.path}`,
        value: { label: r.label, value: r.value },
        documentId: doc,
        confidence: 1,
        via: "breakdown",
        question: r.path,
        proof: r.proof ?? null,
        by: b.by,
      })),
    )
    .onConflictDoUpdate({
      target: findings.factKey,
      set: {
        value: sql`excluded.value`,
        proof: sql`excluded.proof`,
        by: sql`excluded.by`,
        observedAt: sql`now()`,
      },
    });
  return rows.length;
}
