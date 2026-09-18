/**
 * Persisting an LLM enrichment: one row per (subject, kind, model, prompt_version).
 * The cache contract is "one paid call per document/company per prompt version";
 * the unique constraints on enrichments enforce it. A parse-failed row is NOT a
 * success: selection queries exclude it so the next run retries, and the retry
 * lands on the same row with the earlier failure kept in `previous_attempts`.
 * `run_id` names the run that produced the row's CURRENT output.
 */
import type { Queryable } from "@wren/db";
import { and, eq } from "drizzle-orm";
import { type Enrichment, type EnrichmentKind, enrichments } from "../schema.js";

export interface UpsertEnrichment {
  kind: EnrichmentKind;
  model: string;
  promptVersion: string;
  output: Record<string, unknown>;
  documentId?: number | null;
  companyId?: number | null;
  runId?: string | null;
}

/** Insert, or replace an existing parse-failed row for the same key. */
export async function upsertEnrichment(
  db: Queryable,
  input: UpsertEnrichment,
): Promise<Enrichment> {
  const documentId = input.documentId ?? null;
  const companyId = input.companyId ?? null;
  if ((documentId === null) === (companyId === null))
    throw new Error("exactly one of documentId / companyId");
  const subject =
    documentId !== null
      ? eq(enrichments.documentId, documentId)
      : eq(enrichments.companyId, companyId as number);
  const [existing] = await db
    .select()
    .from(enrichments)
    .where(
      and(
        subject,
        eq(enrichments.kind, input.kind),
        eq(enrichments.model, input.model),
        eq(enrichments.promptVersion, input.promptVersion),
      ),
    );
  const runId = input.runId ?? null;
  if (!existing) {
    const [row] = await db
      .insert(enrichments)
      .values({
        documentId,
        companyId,
        kind: input.kind,
        model: input.model,
        promptVersion: input.promptVersion,
        output: input.output,
        runId,
      })
      .returning();
    return row as Enrichment;
  }
  const prior = (existing.output ?? {}) as Record<string, unknown>;
  if (!prior.parse_error) {
    // A success is never re-bought; reaching here means a selection query let a
    // cached unit through. Surface it, don't overwrite.
    throw new Error(`enrichment ${existing.id} already succeeded; refusing to overwrite`);
  }
  const previous = Array.isArray(prior.previous_attempts) ? [...prior.previous_attempts] : [];
  previous.push({ parse_error: prior.parse_error, call: prior.call ?? null });
  const [row] = await db
    .update(enrichments)
    .set({ output: { ...input.output, previous_attempts: previous }, runId })
    .where(eq(enrichments.id, existing.id))
    .returning();
  return row as Enrichment;
}
