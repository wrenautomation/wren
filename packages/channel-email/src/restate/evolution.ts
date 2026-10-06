/**
 * The copy-evolution loop: once a day at 08:00 (send timezone), each running
 * experiment ticks (file import, counts, retire, snapshot, settle). When the strategist
 * is due, the LLM tiers write candidates for William's queue. A tick that changed a
 * genome re-renders that niche's queue so no draft keeps a retired allele.
 */
import type * as restate from "@restatedev/restate-sdk";
import { pruneRuns } from "@wren/core";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { parseSettings } from "@wren/experiments";
import { type LlmFor, proposeCandidates, writeDue } from "../evolve/candidates.js";
import {
  type EvolveTick,
  getExperiment,
  runningExperiments,
  tickExperiment,
} from "../evolve/experiments.js";
import type { SendPolicy } from "../send/policy.js";
import { zonedInstant } from "../send/tz.js";
import { type Campaign, refreshCampaign } from "./compose-scheduler.js";

export interface EvolutionDeps {
  db: Db;
  campaigns: ReadonlyMap<string, Campaign>;
  policy: SendPolicy;
  trackOpens?: boolean;
  /** The tiers' models; without it no candidates are written. */
  llmFor?: LlmFor;
}

export const EVOLUTION_KEY = "fleet";
export const EVOLUTION_COMMAND = "evolve tick";
export const EVOLUTION_HOUR = 8;
/** A second pass inside this window skips an experiment already ticked (a retried step). */
const TICKED_WITHIN_MS = 20 * 60 * 60 * 1000;

export interface EvolutionStats {
  ticked: EvolveTick[];
  skipped: number;
  proposed: { experiment: number; queued: number; approved: number; error?: string }[];
  /** Old inbox-sync and send-tick runs nothing references, deleted (see `pruneRuns`). */
  pruned: number;
}

/** The next 08:00 local strictly after `now`. */
export function nextTickAt(policy: SendPolicy, now: Date): Date {
  const local = policy.localNow(now);
  for (let offset = 0; offset < 2; offset += 1) {
    const day = local.date.addDays(offset);
    const at = zonedInstant(policy.timezone, day.year, day.month, day.day, EVOLUTION_HOUR, 0);
    if (at.getTime() > now.getTime()) return at;
  }
  throw new Error("no 08:00 within two days");
}

/** Tick every running experiment whose template a campaign still carries. */
export async function tickAll(
  db: Db,
  campaigns: ReadonlyMap<string, Campaign>,
  opts: { now: Date; trackOpens: boolean; skipRecent?: boolean; llmFor?: LlmFor },
): Promise<EvolutionStats> {
  const stats: EvolutionStats = { ticked: [], skipped: 0, proposed: [], pruned: 0 };
  const changed = new Set<string>();
  const since = new Date(opts.now.getTime() - TICKED_WITHIN_MS);
  for (const exp of await runningExperiments(db)) {
    if (opts.skipRecent && exp.lastTick !== null && exp.lastTick > since) {
      stats.skipped++;
      continue;
    }
    const file = campaigns.get(exp.niche)?.templates.get(exp.template);
    const result = await tickExperiment(db, exp.id, file);
    if (!result) continue;
    stats.ticked.push(result);
    if (result.genomeChanged) changed.add(exp.niche);
    if (!opts.llmFor) continue;
    const settings = parseSettings((await getExperiment(db, exp.id)).settings);
    if (!writeDue(settings, result)) continue;
    try {
      const p = await proposeCandidates(db, exp.id, opts.llmFor);
      stats.proposed.push({ experiment: exp.id, queued: p.queued.length, approved: p.approved });
      if (p.approved > 0) changed.add(exp.niche);
    } catch (err) {
      // One experiment's tiers failing leaves the others' ticks standing.
      const error = err instanceof Error ? err.message : String(err);
      stats.proposed.push({ experiment: exp.id, queued: 0, approved: 0, error });
    }
  }
  for (const niche of changed) {
    const campaign = campaigns.get(niche);
    if (campaign) await refreshCampaign(db, campaign, opts.trackOpens, true);
  }
  // Housekeeping on the fleet's one daily pass; the ledger is core's, so any loop could host it.
  stats.pruned = await pruneRuns(db, opts.now);
  return stats;
}

export function makeEvolution(deps: EvolutionDeps) {
  return makeLoopObject("Evolution", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const delay = nextTickAt(deps.policy, now).getTime() - now.getTime();
    return runPass<EvolutionStats>(ctx, deps.db, now, {
      name: "evolve tick",
      ledger: { command: EVOLUTION_COMMAND, argv: { daemon: true } },
      body: () =>
        tickAll(deps.db, deps.campaigns, {
          now,
          trackOpens: deps.trackOpens ?? false,
          skipRecent: true,
          ...(deps.llmFor ? { llmFor: deps.llmFor } : {}),
        }),
      delayAfter: () => delay,
      retryMs: delay,
    });
  });
}

export type Evolution = ReturnType<typeof makeEvolution>;
