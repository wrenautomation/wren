/**
 * Give pre-ledger LLM enrichment rows the same `call` record and envelope layout
 * new rows get. Idempotent: rows with a record are skipped; the raw body is never
 * touched. Two legacy layouts exist: extraction rows with `api` at the top level,
 * and pick rows that nested {raw_text, api} under `llm`. The pick layout is lifted
 * so one SQL path reads both. A free-route pick never called a provider and gets
 * `call: null`. Latency and run_id are unknowable after the fact and stay null.
 */
import type { Queryable } from "@wren/db";
import { callRecord, providerFromModel } from "@wren/llm";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { enrichments } from "../schema.js";
import { FREE_PICK_METHODS } from "./email-pick/graph.js";

export interface BackfillStats extends Record<string, number> {
  selected: number;
  backfilled: number;
  legacy_pick_lifted: number;
  free_routes: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A deterministic-route pick bought nothing; a rejected classify did make a round trip. */
function tookFreeRoute(kind: string, output: Record<string, unknown>): boolean {
  if (kind !== "email_pick") return false;
  const pick = output.pick;
  const method = isRecord(pick) && typeof pick.method === "string" ? pick.method : "";
  return FREE_PICK_METHODS.has(method) && !output.provider_rejected;
}

export async function backfillCallRecords(
  db: Queryable,
  opts: { limit?: number } = {},
): Promise<BackfillStats> {
  const q = db
    .select()
    .from(enrichments)
    .where(and(ne(enrichments.model, "deterministic"), sql`NOT (${enrichments.output} ? 'call')`))
    .orderBy(asc(enrichments.id));
  const rows = opts.limit === undefined ? await q : await q.limit(opts.limit);
  const stats: BackfillStats = {
    selected: rows.length,
    backfilled: 0,
    legacy_pick_lifted: 0,
    free_routes: 0,
  };
  for (const row of rows) {
    const output: Record<string, unknown> = { ...((row.output ?? {}) as Record<string, unknown>) };
    if (isRecord(output.llm)) {
      const nested = output.llm;
      delete output.llm;
      output.raw_text ??= nested.raw_text ?? null;
      output.api ??= nested.api ?? null;
      stats.legacy_pick_lifted += 1;
    } else if ("llm" in output) {
      delete output.llm;
      output.raw_text ??= null;
      output.api ??= null;
    }
    const raw = isRecord(output.api) ? output.api : null;
    if (tookFreeRoute(row.kind, output)) {
      output.call = null;
      stats.free_routes += 1;
    } else {
      output.call = callRecord(raw, {
        model: row.model,
        provider: providerFromModel(row.model, raw),
        latencyMs: null,
        runId: null,
        rejected: Boolean(output.provider_rejected),
      });
    }
    await db.update(enrichments).set({ output }).where(eq(enrichments.id, row.id));
    stats.backfilled += 1;
  }
  return stats;
}
