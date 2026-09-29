/**
 * Writes a lookup: each finding's source into `documents` (once per url and
 * text), the finding itself (seen again = `observed_at` moves), the person's
 * trusted profile, and where the lookup stands. Every write is an upsert, so
 * re-running a person is safe.
 */
import { createHash } from "node:crypto";
import { people } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { documents, findings, personLookups } from "../schema.js";
import type { DocumentDraft, LookupResult } from "./lookup.js";

/** Postgres text and jsonb refuse NUL; pages and snippets sometimes carry one. */
const noNul = <T>(v: T): T =>
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

export async function recordLookup(
  db: Queryable,
  personId: number,
  r: LookupResult,
  runId: string | null = null,
): Promise<void> {
  for (const f of noNul(r.findings)) {
    const documentId = f.document ? await keepDocument(db, f.document) : null;
    const row = {
      kind: f.kind,
      personId: f.personId,
      factKey: f.factKey,
      value: f.value,
      documentId,
      sourceUrl: f.sourceUrl,
      confidence: f.confidence,
      via: f.via,
    };
    await db
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
      });
  }
  if (r.profile)
    await db.update(people).set({ linkedinUrl: r.profile.url }).where(eq(people.id, personId));
  const state = { state: r.state, tried: noNul(r.tried), retryAt: r.retryAt, runId };
  await db
    .insert(personLookups)
    .values({ personId, ...state })
    .onConflictDoUpdate({
      target: personLookups.personId,
      set: { ...state, lookedUpAt: sql`now()` },
    });
}
