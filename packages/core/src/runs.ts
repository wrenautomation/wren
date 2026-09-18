import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { type Run, runs } from "./schema.js";

/**
 * The run ledger: one `runs` row per stage invocation, opened before the first
 * unit of work and closed with the stage's stats. A run id stamped on what a stage
 * writes (enrichments, documents, verifications, enrollments, messages) groups
 * "which process bought this" and "what did an afternoon cost".
 */
export interface RunOptions {
  command: string;
  /** The command's options (limit, niche, shard, provider name); never secrets. Stored verbatim. */
  argv: Record<string, unknown>;
  niche?: string | null;
  model?: string | null;
}

const ERROR_TEXT_LIMIT = 500;

export async function openRun(db: Queryable, opts: RunOptions): Promise<Run> {
  const [row] = await db
    .insert(runs)
    .values({
      id: crypto.randomUUID(),
      command: opts.command,
      argv: opts.argv,
      niche: opts.niche ?? null,
      model: opts.model ?? null,
    })
    .returning();
  return row as Run;
}

/** Close the row with the stage's stats. Idempotent: a second call is a no-op. */
export async function finishRun(
  db: Queryable,
  runId: string,
  stats: Record<string, unknown> | null,
): Promise<void> {
  const [row] = await db
    .select({ finishedAt: runs.finishedAt })
    .from(runs)
    .where(eq(runs.id, runId));
  if (row?.finishedAt) return;
  await db.update(runs).set({ stats, finishedAt: new Date() }).where(eq(runs.id, runId));
}

/**
 * Open a ledger row, run the body with it, close it. The body returns its stats;
 * a thrown error closes the row with `{ error }` (truncated) and propagates.
 */
export async function recordedRun<T extends Record<string, unknown> | null>(
  db: Queryable,
  opts: RunOptions,
  body: (run: Run) => Promise<T>,
): Promise<{ run: Run; stats: T }> {
  const run = await openRun(db, opts);
  try {
    const stats = await body(run);
    await finishRun(db, run.id, stats);
    return { run, stats };
  } catch (err) {
    const text = `${err instanceof Error ? err.name : "Error"}: ${err instanceof Error ? err.message : String(err)}`;
    await finishRun(db, run.id, { error: text.slice(0, ERROR_TEXT_LIMIT) }).catch(() => {});
    throw err;
  }
}
