/**
 * Search by meaning: each read item embedded once (title, summary and the start of its
 * transcript), kept on the row as a unit vector, and compared in memory. A workspace holds
 * thousands of items at most, so no vector index (the box's Postgres has no pgvector).
 */
import type { Queryable } from "@wren/db";
import { cosine, type Embed } from "@wren/llm";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { items } from "./schema.js";

/** About the model's 2048 tokens. */
const EMBED_CHARS = 6000;
/** Below this an item is not near the query: Gemini puts unrelated text near 0.6, related near 0.8. */
export const NEAR_FLOOR = 0.7;

/** What an item is embedded from. */
export function embedText(i: {
  title: string;
  summary: string | null;
  transcript: string | null;
  text: string;
}): string {
  const body = (i.transcript ?? i.text).replace(/^---\n[\s\S]*?\n---\n/, "");
  return [i.title, i.summary, body]
    .filter((s) => s?.trim())
    .join("\n\n")
    .slice(0, EMBED_CHARS);
}

/** Embed up to `limit` read items that have none yet, newest first. */
export async function embedMissing(
  db: Queryable,
  embed: Embed,
  limit = 50,
): Promise<{ embedded: number }> {
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      summary: items.summary,
      transcript: items.transcript,
      text: items.text,
    })
    .from(items)
    .where(and(isNotNull(items.readAt), isNull(items.embedding), isNull(items.archivedAt)))
    .orderBy(desc(items.id))
    .limit(limit);
  if (!rows.length) return { embedded: 0 };
  const vectors = await embed(rows.map(embedText), "document");
  for (const [i, r] of rows.entries())
    await db
      .update(items)
      .set({ embedding: vectors[i] ?? null })
      .where(eq(items.id, r.id));
  return { embedded: rows.length };
}

/** A workspace's items nearest a query vector, nearest first, at `NEAR_FLOOR` or above. */
export async function nearItems(
  db: Queryable,
  client: string,
  query: readonly number[],
  limit = 40,
): Promise<{ id: number; near: number }[]> {
  const rows = await db
    .select({ id: items.id, embedding: items.embedding })
    .from(items)
    .where(and(eq(items.client, client), isNotNull(items.embedding), isNull(items.archivedAt)));
  return rows
    .map((r) => ({ id: r.id, near: cosine(query, r.embedding ?? []) }))
    .filter((r) => r.near >= NEAR_FLOOR)
    .sort((a, b) => b.near - a.near)
    .slice(0, limit);
}
