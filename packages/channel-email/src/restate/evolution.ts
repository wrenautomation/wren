/**
 * The copy-evolution loop: once a day at 08:00 (send timezone), each running
 * experiment ticks (file import, counts, retire, snapshot, settle). A tick that
 * changed a genome re-renders that niche's queue so no draft keeps a retired allele.
 */
import type * as restate from "@restatedev/restate-sdk";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { type EvolveTick, runningExperiments, tickExperiment } from "../evolve/experiments.js";
import type { SendPolicy } from "../send/policy.js";
import { zonedInstant } from "../send/tz.js";
import { type Campaign, refreshCampaign } from "./compose-scheduler.js";

export interface EvolutionDeps {
  db: Db;
  campaigns: ReadonlyMap<string, Campaign>;
  policy: SendPolicy;
  trackOpens?: boolean;
}

export const EVOLUTION_KEY = "fleet";
export const EVOLUTION_COMMAND = "evolve tick";
export const EVOLUTION_HOUR = 8;
/** A second pass inside this window skips an experiment already ticked (a retried step). */
const TICKED_WITHIN_MS = 20 * 60 * 60 * 1000;

export interface EvolutionStats {
  ticked: EvolveTick[];
  skipped: number;
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
  opts: { now: Date; trackOpens: boolean; skipRecent?: boolean },
): Promise<EvolutionStats> {
  const stats: EvolutionStats = { ticked: [], skipped: 0 };
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
  }
  for (const niche of changed) {
    const campaign = campaigns.get(niche);
    if (campaign) await refreshCampaign(db, campaign, opts.trackOpens, true);
  }
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
        }),
      delayAfter: () => delay,
      retryMs: delay,
    });
  });
}

export type Evolution = ReturnType<typeof makeEvolution>;
