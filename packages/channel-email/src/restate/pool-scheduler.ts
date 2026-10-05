/**
 * The pool-feeder: `PoolScheduler/{niche}` walks the research chain once per
 * pass — discover, verify, crawl, render, scan, extract, pick, applyPicks,
 * resolveMailboxes, verifyMailboxes, profiles — each stage one bounded call to its own object, journaled by
 * Restate. While any stage still finds work the next pass follows in a minute;
 * when every stage reports nothing the loop sleeps until the next local day and
 * looks again (new imports, new domains). Role inboxes it proves become leads,
 * which the queue-keeper (`ComposeScheduler`) enrolls on its next pass.
 *
 * Spend is opt-in by stage. `modelStages` names what may call the model:
 * "none" (default: free groundwork only; the pick reads addresses by rules, so a
 * jane.doe@ on a firm's page still becomes Jane Doe's), "pick" (a model call only
 * for companies with more than one address), "all" (extraction too: people and
 * titles from every stored page). The two mailbox
 * stages run only with a free verifier (`freeVerifier`): `resolveMailboxes` walks
 * the person guesses someone queued (`Resolution.queue`: who to reach stays a
 * person's call), `verifyMailboxes` asks the mail servers about the leads the picks
 * made, so compose sends to proven inboxes, and re-checks the stale addresses of
 * companies that may come back for another sequence (`recheck`, lead recycling). A
 * paid verifier resolves by hand.
 *
 * `profiles` (off unless `profiles` is given: WREN_POOL_PROFILES) reads the
 * LinkedIn pages of the people compose will reach next, a week of sends ahead,
 * from Exa's cache: metered, so opt-in like the model stages.
 *
 * `start({stages: [...]})` narrows one niche's loop to those stages (e.g. only the
 * two mailbox stages while the crawl stays off); `start({})` goes back to all.
 *
 * `PoolScheduler/<client>/<niche|all>` is a client's pool (designs/2026-10-04-outbound-per-client.md,
 * O1): the same chain on `Discovery`/`Enrichment` keyed alike, in the client's database,
 * sized by its `research.lead_sheet` block. Each pass reads the block from main; a client
 * gone, the demo, or the component uninstalled stops the loop. No profiles, no re-checks.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { findClient } from "@wren/core/clients";
import {
  clientOfKey,
  errorText,
  failuresInARow,
  loopSettings,
  makeLoopObject,
  type PassOutcome,
  retryDelayMs,
  setLastPass,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import {
  LEAD_SHEET,
  type LeadSheetSettings,
  leadSheetSettingsSchema,
} from "@wren/research/components";
import type { Discovery, Enrichment } from "@wren/research/restate";
import { and, count, gt, ne, sql } from "drizzle-orm";
import { nextToEnroll } from "../outreach/compose.js";
import type { RecontactPolicy } from "../recontact.js";
import { verifications } from "../schema.js";
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
  "profiles",
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
  /** People whose LinkedIn pages are read this pass; each is several site calls. */
  profiles: number;
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
  profiles: 5,
};

/**
 * Mail servers talked to at once: half the prober's in-flight cap (PROBE_MAX_IN_FLIGHT, 64).
 * Every pass goes through Resolution/default one at a time, so two niches never stack; the
 * other half absorbs probes a timed-out client left running on the server.
 * Each walk holds a DB connection: 32 of Postgres's 60.
 */
export const PROBE_WIDTH = 32;

/**
 * Guesses a domain may cost before its pattern is called unknown, with a free verifier:
 * the paid default (5) plus room for a second person's common guesses when the first
 * left. Each is a probe, not a credit; the cap only bounds the misses one server sees.
 */
export const FREE_DOMAIN_BUDGET = 8;

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
  profiles = false,
): Set<Stage> {
  const chosen = settings?.stages ? new Set(settings.stages) : null;
  return new Set(
    STAGES.filter(
      (s) => stageEnabled(s, modelStages, freeVerifier, profiles) && (!chosen || chosen.has(s)),
    ),
  );
}

/** What the `profiles` stage needs; absent = the stage is off. */
export interface ProfilesStage {
  /** Firms to stay ahead of the queue by: a week of the niche's daily opener capacity. */
  ahead: (niche: string, now: Date) => number | Promise<number>;
  /** Compose's verdict horizon, so the queue read is compose's own. */
  horizonDays: number;
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
  profiles?: ProfilesStage;
  /** Between passes that found work. */
  busyMs?: number;
  /** The longest delay after passes in which a stage failed (backoff cap). */
  retryMs?: number;
  /** A client's database, for `<client>/...` keys; absent, those keys refuse. */
  clientDb?: ((client: string) => Db) | null;
}

/** One client's pool this pass, or why it stops. */
type ClientPlan = { kind: "gone"; why: string } | { kind: "work"; settings: LeadSheetSettings };

async function clientPlan(main: Db, id: string): Promise<ClientPlan> {
  const client = await findClient(main, id);
  if (!client) return { kind: "gone", why: "no such client" };
  if (client.demo) return { kind: "gone", why: "the demo is never worked" };
  const block = (client.products as Record<string, unknown> | null)?.[LEAD_SHEET];
  if (block === undefined) return { kind: "gone", why: "the lead sheet is not installed" };
  const parsed = leadSheetSettingsSchema.safeParse(block);
  if (!parsed.success) return { kind: "gone", why: "the lead sheet settings do not parse" };
  return { kind: "work", settings: parsed.data };
}

/** Mail-server checks the client's walks asked for in the last 24 hours; main's shared verdicts cost none. */
async function checksToday(db: Db, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(verifications)
    .where(
      and(
        ne(verifications.verifier, "local"),
        gt(verifications.checkedAt, new Date(now.getTime() - 86_400_000)),
        sql`${verifications.raw}->>'shared' IS NULL`,
      ),
    );
  return row?.n ?? 0;
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
  // A person written to person_lookups leaves the selection; an error or a cap does not.
  profiles: (s) => (s.people_matched ?? 0) + (s.people_unresolved ?? 0),
};

const definedOnly = <T extends object>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };

export function stageEnabled(
  stage: Stage,
  modelStages: ModelStages,
  freeVerifier = false,
  profiles = false,
): boolean {
  if (stage === "extract") return modelStages === "all";
  if (stage === "profiles") return profiles;
  if (stage === "resolveMailboxes" || stage === "verifyMailboxes") return freeVerifier;
  return true;
}

export function makePoolScheduler(deps: PoolSchedulerDeps) {
  const base: StageLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const busyMs = deps.busyMs ?? DEFAULT_BUSY_MS;
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;

  return makeLoopObject("PoolScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const owner = clientOfKey(ctx.key);
    const client = owner?.client ?? null;
    // Wren's key is its niche; a client's is `<client>/<niche>`, "all" its whole pool.
    const niche = owner ? (owner.unit === "all" ? null : owner.unit) : ctx.key;
    let sheet: LeadSheetSettings | null = null;
    let db = deps.db;
    if (client !== null) {
      if (!deps.clientDb) throw new restate.TerminalError("no client databases here");
      const plan = await ctx.run("client", () => clientPlan(deps.db, client));
      if (plan.kind === "gone") {
        const outcome: PassOutcome<FeedStats> = {
          stats: {
            niche: ctx.key,
            model_stages: deps.modelStages,
            stages: [],
            progress: 0,
            failed: 0,
          },
          error: null,
          failures: 0,
          delayMs: busyMs,
          now: now.toISOString(),
          stopped: plan.why,
        };
        await setLastPass(ctx, outcome);
        return outcome;
      }
      sheet = plan.settings;
      db = deps.clientDb(client);
    }
    const limits: StageLimits = { ...base, ...definedOnly(sheet?.perPass ?? {}) };
    // A day's cap on mail-server checks: a pass may run past it by at most its own size.
    // ponytail: rolling count, not a reservation; a per-check budget if overshoot matters.
    if (sheet?.verificationsPerDay != null) {
      const cap = sheet.verificationsPerDay;
      const left = Math.max(0, cap - (await ctx.run("checks today", () => checksToday(db, now))));
      limits.resolveMailboxes = Math.min(limits.resolveMailboxes, left);
      limits.verifyMailboxes = Math.min(limits.verifyMailboxes, left);
    }
    const settings = await loopSettings<PoolSettings>(ctx);
    const runnable = stagesToRun(
      settings,
      deps.modelStages,
      deps.freeVerifier,
      client === null && deps.profiles !== undefined,
    );
    if (limits.resolveMailboxes === 0) runnable.delete("resolveMailboxes");
    if (limits.verifyMailboxes === 0) runnable.delete("verifyMailboxes");
    const discovery = ctx.objectClient<Discovery>({ name: "Discovery" }, ctx.key);
    const enrichment = ctx.objectClient<Enrichment>({ name: "Enrichment" }, ctx.key);
    const resolution = ctx.objectClient<Resolution>({ name: "Resolution" }, RESOLUTION_KEY);
    const words = sheet?.genericWords.length ? { genericWords: sheet.genericWords } : {};
    const hints = sheet?.crawlHints.length ? { extraHints: sheet.crawlHints } : {};
    // Absent niche = every niche's leads, which is a client's `all`.
    const on = { ...(client !== null ? { client } : {}), ...(niche !== null ? { niche } : {}) };
    const calls: Record<Stage, () => Promise<object>> = {
      discover: () => discovery.discover({ limit: limits.discover, ...words }),
      verify: () => discovery.verify({ limit: limits.verify, ...words }),
      crawl: () => enrichment.crawl({ limit: limits.crawl, ...hints }),
      render: () => enrichment.render({ limit: limits.render, ...hints }),
      scan: () => enrichment.scan({ limit: limits.scan }),
      extract: () => enrichment.extract({ limit: limits.extract }),
      pick: () => enrichment.pick({ limit: limits.pick, rules: deps.modelStages === "none" }),
      applyPicks: () => enrichment.applyPicks({}),
      resolveMailboxes: () =>
        resolution.resolveNewDomains({
          ...on,
          limitDomains: limits.resolveMailboxes,
          concurrency: PROBE_WIDTH,
          domainBudget: FREE_DOMAIN_BUDGET,
        }),
      verifyMailboxes: () => {
        const policy = client === null && niche !== null ? deps.recheck?.policy(niche) : undefined;
        return resolution.verifyLeads({
          ...on,
          limit: limits.verifyMailboxes,
          concurrency: PROBE_WIDTH,
          ...(deps.recheck && policy
            ? { recheckReturning: { policy, olderThanDays: deps.recheck.horizonDays } }
            : {}),
        });
      },
      profiles: async () => {
        const p = deps.profiles;
        if (!p || niche === null) throw new restate.TerminalError("profiles stage is off");
        const personIds = await ctx.run("profile queue", async () =>
          nextToEnroll(deps.db, {
            niche,
            verificationHorizonDays: p.horizonDays,
            companies: await p.ahead(niche, now),
          }),
        );
        return enrichment.profiles({
          personIds,
          limit: limits.profiles,
          timezone: deps.policy.timezone,
        });
      },
    };

    const runId = await ctx.run("open run", async () => {
      const run = await openRun(db, {
        command: POOL_COMMAND,
        argv: {
          daemon: true,
          niche,
          ...on,
          model_stages: deps.modelStages,
          free_verifier: deps.freeVerifier ?? false,
          profiles: deps.profiles !== undefined,
          stages: [...runnable],
          limits,
        },
        niche,
      });
      return run.id;
    });
    const stats: FeedStats = {
      niche: ctx.key,
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
    await ctx.run("finish run", () => finishRun(db, runId, stats));

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
    await setLastPass(ctx, outcome);
    return outcome;
  });
}
