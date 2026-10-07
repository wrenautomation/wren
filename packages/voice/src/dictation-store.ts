/**
 * Dictation's timings (designs/2026-10-07-dictation.md, Measuring): each dictation is a `dictate`
 * run in the run ledger, no words and no person, pruned at 30 days. The Voice app's Latency
 * page reads p50 and p95 per adapter and stage.
 */
import { finishRun, openRun, RUNS_RETENTION_DAYS } from "@wren/core";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ADAPTERS } from "./dictation/route.js";
import { DICTATION_STAGES, type DictationStage } from "./dictation/session.js";

export const DICTATE_COMMAND = "dictate";

const ms = z.number().int().min(0).max(600_000).nullable();

/** One finished dictation, as the portal's engine reports it. */
export const dictatedSchema = z.object({
  adapter: z.enum(ADAPTERS),
  model: z.string().min(1).max(64),
  micMs: ms,
  firstMs: ms,
  finalMs: ms,
  /** Press to model ready, when this press loaded it. */
  loadMs: ms,
  words: z.number().int().min(0).max(20_000),
  audioMs: z.number().int().min(0).max(3_600_000),
});
export type Dictated = z.infer<typeof dictatedSchema>;

export interface DictationStat {
  adapter: string;
  stage: DictationStage;
  p50: number | null;
  p95: number | null;
  n: number;
}

export async function saveDictation(db: Queryable, d: Dictated): Promise<string> {
  const { adapter, model, ...stats } = dictatedSchema.parse(d);
  const run = await openRun(db, { command: DICTATE_COMMAND, argv: { adapter }, model });
  await finishRun(db, run.id, stats);
  return run.id;
}

/** p50 and p95 per adapter and stage over the runs the ledger keeps. */
export async function dictationStats(db: Queryable, now = new Date()): Promise<DictationStat[]> {
  const since = new Date(now.getTime() - RUNS_RETENTION_DAYS * 86_400_000).toISOString();
  const rows = await db.execute<{
    adapter: string;
    stage: DictationStage;
    p50: string | null;
    p95: string | null;
    n: string;
  }>(sql`
    SELECT r.argv->>'adapter' AS adapter, s.stage,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY s.v) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY s.v) AS p95,
      count(*) AS n
    FROM runs r,
      LATERAL (VALUES
        ('load', (r.stats->>'loadMs')::numeric),
        ('mic', (r.stats->>'micMs')::numeric),
        ('first', (r.stats->>'firstMs')::numeric),
        ('final', (r.stats->>'finalMs')::numeric)) AS s(stage, v)
    WHERE r.command = ${DICTATE_COMMAND} AND r.finished_at IS NOT NULL
      AND r.started_at >= ${since}::timestamptz AND s.v IS NOT NULL
    GROUP BY 1, 2`);
  const order = Object.keys(DICTATION_STAGES);
  return rows
    .map((r) => ({
      adapter: r.adapter,
      stage: r.stage,
      p50: r.p50 === null ? null : Math.round(Number(r.p50)),
      p95: r.p95 === null ? null : Math.round(Number(r.p95)),
      n: Number(r.n),
    }))
    .sort((a, b) =>
      a.adapter === b.adapter
        ? order.indexOf(a.stage) - order.indexOf(b.stage)
        : a.adapter.localeCompare(b.adapter),
    );
}
