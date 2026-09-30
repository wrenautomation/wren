/**
 * The pool-feeder: `PoolScheduler/{niche}` walks the research chain once per
 * pass — discover, verify, crawl, render, scan, extract, pick, applyPicks,
 * resolveMailboxes, verifyMailboxes — each stage one bounded call to its own object, journaled by
 * Restate. While any stage still finds work the next pass follows in a minute;
 * when every stage reports nothing the loop sleeps until the next local day and
 * looks again (new imports, new domains). Role inboxes it proves become leads,
 * which the queue-keeper (`ComposeScheduler`) enrolls on its next pass.
 *
 * Spend is opt-in by stage. `modelStages` names what may call the model:
 * "none" (default: free groundwork only — no verdicts, so no new leads yet),
 * "pick" (a model call only for companies with more than one address), "all"
 * (extraction too: people and titles from every stored page). The two mailbox
 * stages run only with a free verifier (`freeVerifier`): `resolveMailboxes` walks
 * the person guesses someone queued (`Resolution.queue`: who to reach stays a
 * person's call), `verifyMailboxes` asks the mail servers about the leads the picks
 * made, so compose sends to proven inboxes, and re-checks the stale addresses of
 * companies that may come back for another sequence (`recheck`, lead recycling). A
 * paid verifier resolves by hand.
 *
 * `start({stages: [...]})` narrows one niche's loop to those stages (e.g. only the
 * two mailbox stages while the crawl stays off); `start({})` goes back to all.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import {
  errorText,
  failuresInARow,
  LAST,
  loopSettings,
  makeLoopObject,
  type PassOutcome,
  retryDelayMs,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { Discovery, Enrichment } from "@wren/research/restate";
import type { RecontactPolicy } from "../recontact.js";
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
  "resolveMailboxes",
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
  /** Domains whose person guesses are walked this pass. */
  resolveMailboxes: number;
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
  // Each probe is a live SMTP conversation, seconds apiece, run PROBE_WIDTH at once:
  // a pass stays a few minutes, well inside one Lambda invocation.
  resolveMailboxes: 192,
  verifyMailboxes: 192,
};

/**
 * Mail servers talked to at once: half the prober's in-flight cap (PROBE_MAX_IN_FLIGHT, 64).
 * Every pass goes through Resolution/default one at a time, so two niches never stack; the
 * other half absorbs probes a timed-out client left running on the server.
 * Each walk holds a DB connection: 32 of Postgres's 60.
 */
export const PROBE_WIDTH = 32;

/** What `PoolScheduler/{niche}/start` may be given. */
export interface PoolSettings {
  /** Only these stages run for this niche; absent = every enabled stage. */
  stages?: Stage[];
}

/** The stages a pass runs: enabled by config, then narrowed by the niche's settings. */
export function stagesToRun(
  settings: PoolSettings | null,
  modelStages: ModelStages,
  freeVerifier = false,
): Set<Stage> {
  const chosen = settings?.stages ? new Set(settings.stages) : null;
  return new Set(
    STAGES.filter((s) => stageEnabled(s, modelStages, freeVerifier) && (!chosen || chosen.has(s))),
  );
}

export interface PoolSchedulerDeps {
  db: Db;
  policy: SendPolicy;
  modelStages: ModelStages;
  /** The configured verifier charges nothing per check, so the chain may verify mailboxes itself. */
  freeVerifier?: boolean;
  /**
   * Re-check returning companies' addresses older than `horizonDays` (compose's send
   * horizon), under each niche's recontact policy. Absent = no re-checks.
   */
  recheck?: { horizonDays: number; policy: (niche: string) => RecontactPolicy | undefined };
  limits?: Partial<StageLimits>;
  /** Between passes that found work. */
  busyMs?: number;
  /** The longest delay after passes in which a stage failed (backoff cap). */
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
const DEFAULT_RETRY_MS = 8 * 60_000;

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
  // A domain that wrote a verdict row leaves the selection; resolver trouble does not.
  resolveMailboxes: (s) => (s.credits_spent ?? 0) + (s.dead_domains ?? 0),
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
  if (stage === "resolveMailboxes" || stage === "verifyMailboxes") return freeVerifier;
  return true;
}

export function makePoolScheduler(deps: PoolSchedulerDeps) {
  const limits: StageLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const busyMs = deps.busyMs ?? DEFAULT_BUSY_MS;
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;

  return makeLoopObject("PoolScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const niche = ctx.key;
    const settings = await loopSettings<PoolSettings>(ctx);
    const runnable = stagesToRun(settings, deps.modelStages, deps.freeVerifier);
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
      resolveMailboxes: () =>
        resolution.resolveNewDomains({
          niche,
          limitDomains: limits.resolveMailboxes,
          concurrency: PROBE_WIDTH,
        }),
      verifyMailboxes: () => {
        const policy = deps.recheck?.policy(niche);
        return resolution.verifyLeads({
          niche,
          limit: limits.verifyMailboxes,
          concurrency: PROBE_WIDTH,
          ...(deps.recheck && policy
            ? { recheckReturning: { policy, olderThanDays: deps.recheck.horizonDays } }
            : {}),
        });
      },
    };

    const runId = await ctx.run("open run", async () => {
      const run = await openRun(deps.db, {
        command: POOL_COMMAND,
        argv: {
          daemon: true,
          niche,
          model_stages: deps.modelStages,
          free_verifier: deps.freeVerifier ?? false,
          stages: [...runnable],
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
      if (!runnable.has(stage)) {
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

    const failures = await failuresInARow(ctx, stats.failed > 0);
    const delayMs =
      failures > 0
        ? retryDelayMs(failures, retryMs)
        : stats.progress > 0
          ? busyMs
          : untilNextLocalDay(deps.policy, now);
    const outcome: PassOutcome<FeedStats> = {
      stats,
      error: null,
      failures,
      delayMs,
      now: now.toISOString(),
    };
    ctx.set(LAST, outcome);
    return outcome;
  });
}
