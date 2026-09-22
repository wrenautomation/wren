/**
 * The pool-feeder: `PoolScheduler/{niche}` walks the research chain once per
 * pass — discover, verify, crawl, render, scan, extract, pick, applyPicks,
 * verifyMailboxes — each stage one bounded call to its own object, journaled by
 * Restate. While any stage still finds work the next pass follows in a minute;
 * when every stage reports nothing the loop sleeps until the next local day and
 * looks again (new imports, new domains). Role inboxes it proves become leads,
 * which the queue-keeper (`ComposeScheduler`) enrolls on its next pass.
 *
 * Spend is opt-in by stage. `modelStages` names what may call the model:
 * "none" (default: free groundwork only — no verdicts, so no new leads yet),
 * "pick" (a model call only for companies with more than one address), "all"
 * (extraction too: people and titles from every stored page). `verifyMailboxes`
 * runs only with a free verifier (`freeVerifier`): it asks the mail servers about
 * the leads the picks made, so compose sends to proven inboxes. Person guesses
 * go to Resolution by hand.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { errorText, LAST, makeLoopObject, type PassOutcome } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { Discovery, Enrichment } from "@wren/research/restate";
import type { SendPolicy } from "../send/policy.js";
import { untilNextLocalDay } from "./postmaster-scheduler.js";
import { RESOLUTION_KEY, type Resolution } from "./resolution.js";

export const POOL_COMMAND = "pool feed";
export type ModelStages = "none" | "pick" | "all";
export const STAGES = [
  "discover",
  "verify",
  "crawl",
  "render",
  "scan",
  "extract",
  "pick",
  "applyPicks",
  "verifyMailboxes",
] as const;
export type Stage = (typeof STAGES)[number];

/** How many units one pass hands each stage; the chain's per-pass ceiling. */
export interface StageLimits {
  discover: number;
  verify: number;
  crawl: number;
  render: number;
  scan: number;
  extract: number;
  pick: number;
  verifyMailboxes: number;
}
export const DEFAULT_LIMITS: StageLimits = {
  discover: 10,
  verify: 10,
  crawl: 10,
  render: 5,
  scan: 200,
  extract: 20,
  pick: 50,
  // Each probe is a live SMTP conversation, seconds apiece: keep one pass short.
  verifyMailboxes: 10,
};

export interface PoolSchedulerDeps {
  db: Db;
  policy: SendPolicy;
  modelStages: ModelStages;
  /** The configured verifier charges nothing per check, so the chain may verify mailboxes itself. */
  freeVerifier?: boolean;
  limits?: Partial<StageLimits>;
  /** Between passes that found work. */
  busyMs?: number;
  /** After a pass in which a stage failed. */
  retryMs?: number;
}

export interface StageOutcome {
  stage: Stage;
  /** Units the stage moved forward; 0 = nothing left for it. */
  progress: number;
  stats: Record<string, unknown> | null;
  error: string | null;
  skipped: boolean;
}

export interface FeedStats {
  niche: string;
  model_stages: ModelStages;
  stages: StageOutcome[];
  /** Sum of every stage's progress: 0 = the chain is idle for this niche. */
  progress: number;
  failed: number;
}

const DEFAULT_BUSY_MS = 60_000;
const DEFAULT_RETRY_MS = 60 * 60_000;

/** A stage's "did work" number: units whose selection no longer matches after this pass. */
export const progressOf: Record<Stage, (s: Record<string, number>) => number> = {
  discover: (s) => s.companies_scanned ?? 0,
  verify: (s) => s.companies_scanned ?? 0,
  // Unreachable and robots-blocked homepages leave an empty document, so they count.
  crawl: (s) =>
    (s.companies_crawled ?? 0) + (s.homepage_unreachable ?? 0) + (s.robots_blocked ?? 0),
  // A render that fails stays a shell and is picked again; only a stored page moves the pool.
  render: (s) => s.companies_rendered ?? 0,
  scan: (s) => s.scanned ?? 0,
  extract: (s) => s.extracted ?? 0,
  pick: (s) => s.picked ?? 0,
  applyPicks: (s) => s.picks_applied ?? 0,
  // A lead with a verdict row (any result) leaves the selection; local errors do not.
  verifyMailboxes: (s) =>
    (s.local_invalid ?? 0) +
    (s.valid ?? 0) +
    (s.invalid ?? 0) +
    (s.risky ?? 0) +
    (s.catch_all ?? 0),
};

export function stageEnabled(
  stage: Stage,
  modelStages: ModelStages,
  freeVerifier = false,
): boolean {
  if (stage === "extract") return modelStages === "all";
  if (stage === "pick" || stage === "applyPicks") return modelStages !== "none";
  if (stage === "verifyMailboxes") return freeVerifier;
  return true;
}

export function makePoolScheduler(deps: PoolSchedulerDeps) {
  const limits: StageLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const busyMs = deps.busyMs ?? DEFAULT_BUSY_MS;
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;

  return makeLoopObject("PoolScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const niche = ctx.key;
    const discovery = ctx.objectClient<Discovery>({ name: "Discovery" }, niche);
    const enrichment = ctx.objectClient<Enrichment>({ name: "Enrichment" }, niche);
    const resolution = ctx.objectClient<Resolution>({ name: "Resolution" }, RESOLUTION_KEY);
    const calls: Record<Stage, () => Promise<object>> = {
      discover: () => discovery.discover({ limit: limits.discover }),
      verify: () => discovery.verify({ limit: limits.verify }),
      crawl: () => enrichment.crawl({ limit: limits.crawl }),
      render: () => enrichment.render({ limit: limits.render }),
      scan: () => enrichment.scan({ limit: limits.scan }),
      extract: () => enrichment.extract({ limit: limits.extract }),
      pick: () => enrichment.pick({ limit: limits.pick }),
      applyPicks: () => enrichment.applyPicks({}),
      verifyMailboxes: () => resolution.verifyLeads({ niche, limit: limits.verifyMailboxes }),
    };

    const runId = await ctx.run("open run", async () => {
      const run = await openRun(deps.db, {
        command: POOL_COMMAND,
        argv: {
          daemon: true,
          niche,
          model_stages: deps.modelStages,
          free_verifier: deps.freeVerifier ?? false,
          limits,
        },
        niche,
      });
      return run.id;
    });
    const stats: FeedStats = {
      niche,
      model_stages: deps.modelStages,
      stages: [],
      progress: 0,
      failed: 0,
    };
    for (const stage of STAGES) {
      if (!stageEnabled(stage, deps.modelStages, deps.freeVerifier)) {
        stats.stages.push({ stage, progress: 0, stats: null, error: null, skipped: true });
        continue;
      }
      // A stage that refuses (TerminalError: no fetch contact, no render tier) is that
      // stage's problem: recorded, the chain moves on, the pass retries later.
      try {
        const result = (await calls[stage]()) as Record<string, number>;
        const progress = progressOf[stage](result);
        stats.stages.push({ stage, progress, stats: result, error: null, skipped: false });
        stats.progress += progress;
      } catch (err) {
        if (!(err instanceof restate.TerminalError)) throw err;
        stats.stages.push({
          stage,
          progress: 0,
          stats: null,
          error: errorText(err),
          skipped: false,
        });
        stats.failed += 1;
      }
    }
    await ctx.run("finish run", () => finishRun(deps.db, runId, stats));

    const delayMs =
      stats.failed > 0
        ? retryMs
        : stats.progress > 0
          ? busyMs
          : untilNextLocalDay(deps.policy, now);
    const outcome: PassOutcome<FeedStats> = {
      stats,
      error: null,
      delayMs,
      now: now.toISOString(),
    };
    ctx.set(LAST, outcome);
    return outcome;
  });
}
