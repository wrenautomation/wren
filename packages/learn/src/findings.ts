/**
 * A breakdown as findings on its item's document (designs/2026-10-25-ingestion-engine.md, Nouns).
 * Each fact `factRows` yields is one `fact` finding, keyed `doc:<document>/<path>`, so a second
 * write of the same breakdown moves nothing. His calls on a fact use that key as their subject.
 */
import type { Queryable } from "@wren/db";
import { findings } from "@wren/research/schema";
import { eq, sql } from "drizzle-orm";
import { factRows } from "./calls.js";
import { type BreakdownRow, items } from "./schema.js";

/** Write a breakdown's facts as findings on the item's document. Returns how many it holds. */
export async function factFindings(db: Queryable, b: BreakdownRow): Promise<number> {
  const [item] = await db
    .select({ doc: items.documentId })
    .from(items)
    .where(eq(items.id, b.itemId));
  if (!item) return 0;
  const doc = item.doc;
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
