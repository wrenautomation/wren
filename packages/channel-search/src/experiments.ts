/**
 * The bandit over site experiments (designs/2026-10-06-flags-experiments-surveys-heatmaps.md §3):
 * each pass, every running experiment's variants are scored on its goal since it started, and
 * the shares move (`@wren/experiments`, Thompson). P(best) at 0.95 settles it: the shares hold
 * at 90/10 until William ships the winner or stops it.
 */

import {
  liveExperiments,
  saveDecision,
  type VariantCounts,
  variantCounts,
} from "@wren/core/experiment-store";
import type { ExperimentGoal } from "@wren/core/flags";
import type { Queryable } from "@wren/db";
import { type AlleleCounts, evaluateLocus, parseSettings } from "@wren/experiments";

/** Visitors, not sends: a variant drops or settles only after this many saw it. */
export const SITE_MIN_VISITORS = 200;
const SETTINGS = parseSettings({
  selection: "thompson",
  fitness: "booked",
  minSends: SITE_MIN_VISITORS,
});

export interface Decision {
  shares: Record<string, number>;
  pBest: Record<string, number>;
  retired: string[];
  best: string | null;
  settled: boolean;
}

/** One experiment's next shares from its counts. Pure. */
export function decide(
  flag: string,
  variants: readonly string[],
  retired: readonly string[],
  goal: ExperimentGoal,
  counts: readonly VariantCounts[],
): Decision {
  const live = variants.filter((v) => !retired.includes(v));
  const of = (v: string): AlleleCounts => {
    const c = counts.find((x) => x.variant === v);
    return {
      exposures: c?.visitors ?? 0,
      booked: Math.min(c?.[goal] ?? 0, c?.visitors ?? 0),
      replies: 0,
      interested: 0,
      opens: 0,
      tracked: 0,
      negatives: 0,
    };
  };
  const r = evaluateLocus(
    { locus: flag, alleles: live, counts: live.map(of), tried: variants.length, history: [] },
    SETTINGS,
  );
  return {
    shares: { ...r.shares },
    pBest: { ...r.pBest },
    retired: [...retired, ...r.retire.map((x) => x.allele)],
    best: r.best,
    settled: r.settled,
  };
}

/** Moves every running experiment. Returns how many it moved and how many settled. */
export async function decideExperiments(
  db: Queryable,
): Promise<{ moved: number; settled: number }> {
  let moved = 0;
  let settled = 0;
  for (const { e, variants } of await liveExperiments(db)) {
    const since = e.startedAt ? e.startedAt.toISOString().slice(0, 10) : null;
    const d = decide(e.flag, variants, e.retired, e.goal, await variantCounts(db, e.flag, since));
    await saveDecision(db, e.flag, d);
    moved += 1;
    if (d.settled) settled += 1;
  }
  return { moved, settled };
}
