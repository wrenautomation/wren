/**
 * Resolution as a Restate Virtual Object with one key: verifier credits are one
 * global budget, so paid spend never runs concurrently (free probes may, many
 * domains at once, in `resolveNewDomains` and `verifyLeads`). Each domain's walk is one
 * journaled step over one transaction; a crash loses at most one domain's spend
 * and the promotions batch runs from journaled refs.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import type { Db, DbHandle } from "@wren/db";
import { sql } from "drizzle-orm";
import { eachConcurrently } from "../concurrent.js";
import type { RecontactPolicy } from "../recontact.js";
import {
  addResolutionStats,
  buildCandidates,
  DEFAULT_DOMAIN_BUDGET,
  emptyResolutionStats,
  type PromotionRef,
  promoteCandidates,
  type QueueOptions,
  queueCandidates,
  type ResolutionStats,
  resolveDomainUnit,
  selectNewResolutionTargets,
  selectResolutionTargets,
  strandedPromotions,
} from "../resolution/service.js";
import type { LocalCheckerLike } from "../verification/local.js";
import { defaultLocalChecker } from "../verification/mailifier.js";
import { runVerification, type VerificationStats } from "../verification/service.js";
import type { EmailVerifier } from "../verification/verifier.js";

export interface ResolutionDeps {
  db: Db;
  verifier: EmailVerifier;
  /** Test seam: a stage-1 checker with a fake resolver. */
  checker?: LocalCheckerLike;
  /**
   * A pool of `max` connections for one `resolveNewDomains` pass, closed after it:
   * each domain walk holds a transaction while it probes, so the process's small
   * pool would cap the width. Absent = walk on `db`.
   */
  openPool?: (max: number) => DbHandle;
}

export const RESOLUTION_KEY = "default";

export interface ResolveInput {
  domainBudget?: number;
  creditLimit?: number | null;
}

export interface ResolveNewInput {
  niche?: string;
  /** Domains walked this pass. */
  limitDomains: number;
  /** Domain walks at once; each walk is sequential (a verdict decides the next guess). */
  concurrency?: number;
  domainBudget?: number;
}

export interface VerifyLeadsInput {
  niche?: string;
  limit?: number;
  /** Days after which a `risky` verdict is tried again (default 2). */
  retryRiskyAfterDays?: number;
  /** Leads checked at once; free verifiers only (default 1). */
  concurrency?: number;
  /**
   * Also re-check the proven addresses of companies that may come back for another
   * sequence (lead recycling), once their newest check is older than `olderThanDays`.
   */
  recheckReturning?: { policy: RecontactPolicy; olderThanDays: number };
}
export const DEFAULT_RETRY_RISKY_DAYS = 2;

export function makeResolution(deps: ResolutionDeps) {
  const checker = deps.checker ?? defaultLocalChecker();
  const open = (ctx: restate.ObjectContext, command: string, argv: Record<string, unknown>) =>
    ctx.run("open run", async () => {
      const run = await openRun(deps.db, { command, argv, model: deps.verifier.name });
      return run.id;
    });
  const close = (ctx: restate.ObjectContext, runId: string, stats: object) =>
    ctx.run("finish run", () => finishRun(deps.db, runId, stats));

  return restate.object({
    name: "Resolution",
    handlers: {
      build: async (ctx: restate.ObjectContext, input: { limitPeople?: number } = {}) => {
        const runId = await open(ctx, "resolve build", { ...input });
        const stats = await ctx.run("build", () =>
          deps.db.transaction((tx) => buildCandidates(tx, input)),
        );
        await close(ctx, runId, stats);
        return stats;
      },

      queue: async (ctx: restate.ObjectContext, input: QueueOptions = {}) => {
        const runId = await open(ctx, "resolve queue", { ...input });
        const stats = await ctx.run("queue", () =>
          deps.db.transaction((tx) => queueCandidates(tx, input)),
        );
        await close(ctx, runId, stats);
        return stats;
      },

      /** Paid verifier credits: never by hand (queue it), so never through the ingress. */
      resolve: restate.handlers.object.exclusive(
        { ingressPrivate: true },
        async (ctx: restate.ObjectContext, input: ResolveInput = {}): Promise<ResolutionStats> => {
          const domainBudget = input.domainBudget ?? DEFAULT_DOMAIN_BUDGET;
          const creditLimit = input.creditLimit ?? null;
          const runId = await open(ctx, "resolve run", { ...input });
          const promotions: PromotionRef[] = await ctx.run("stranded", () =>
            strandedPromotions(deps.db),
          );
          const domains = await ctx.run("select", () => selectResolutionTargets(deps.db));
          let stats = emptyResolutionStats();
          stats.stranded_repaired = promotions.length;
          let spent = 0;
          for (const domain of domains) {
            const alreadySpent = spent;
            const r = await ctx.run(`resolve ${domain}`, () =>
              deps.db.transaction((tx) =>
                resolveDomainUnit(tx, deps.verifier, domain, {
                  domainBudget,
                  checker,
                  alreadySpent,
                  retryRiskyAfterDays: DEFAULT_RETRY_RISKY_DAYS,
                  creditLimit,
                }),
              ),
            );
            stats = addResolutionStats(stats, r.stats);
            promotions.push(...r.promotions);
            spent += r.spent;
            if (stats.aborted) break;
          }
          if (promotions.length) {
            await ctx.run("promote", () =>
              deps.db.transaction((tx) => promoteCandidates(tx, promotions)),
            );
          }
          await close(ctx, runId, stats);
          return stats;
        },
      ),

      /**
       * One bounded pass over domains never walked, many walks at once: what the
       * pool-feeder calls with a free verifier. Each domain commits on its own, so the
       * pass is one journaled step; a retry re-selects only what is still new, and a
       * VALID whose promotion was lost is repaired by the next `resolve` (stranded).
       * No credit limit here: a paid verifier goes through `resolve`, one at a time.
       */
      resolveNewDomains: async (
        ctx: restate.ObjectContext,
        input: ResolveNewInput,
      ): Promise<ResolutionStats> => {
        if (deps.verifier.costsCredits)
          throw new restate.TerminalError(
            "resolveNewDomains spends without a limit: free verifiers only",
          );
        const domainBudget = input.domainBudget ?? DEFAULT_DOMAIN_BUDGET;
        const runId = await open(ctx, "resolve new domains", { ...input });
        const width = input.concurrency ?? 1;
        const { stats, promotions } = await ctx.run("walk", async () => {
          // One more connection than the walk's width: the lock holds it for the whole walk.
          const pool = deps.openPool?.(width + 1) ?? null;
          const db = pool?.db ?? deps.db;
          try {
            return await oneWalkAtATime(db, async () => {
              const domains = await selectNewResolutionTargets(db, {
                limit: input.limitDomains,
                retryRiskyAfterDays: DEFAULT_RETRY_RISKY_DAYS,
                domainBudget,
                ...(input.niche !== undefined ? { niche: input.niche } : {}),
              });
              let stats = emptyResolutionStats();
              const promotions: PromotionRef[] = [];
              await eachConcurrently(
                domains,
                width,
                async (domain) => {
                  const r = await db.transaction((tx) =>
                    resolveDomainUnit(tx, deps.verifier, domain, {
                      domainBudget,
                      checker,
                      alreadySpent: 0,
                      retryRiskyAfterDays: DEFAULT_RETRY_RISKY_DAYS,
                      creditLimit: null,
                    }),
                  );
                  stats = addResolutionStats(stats, r.stats);
                  promotions.push(...r.promotions);
                },
                () => stats.aborted !== null,
              );
              return { stats, promotions };
            });
          } finally {
            await pool?.close();
          }
        });
        if (promotions.length) {
          await ctx.run("promote", () =>
            deps.db.transaction((tx) => promoteCandidates(tx, promotions)),
          );
        }
        await close(ctx, runId, stats);
        // Nothing walked and the verifier down: that is the stage's failure, not a quiet pass.
        if (stats.aborted && stats.credits_spent === 0) {
          throw new restate.TerminalError(`verifier: ${stats.aborted}`);
        }
        return stats;
      },

      /**
       * The verification funnel over a niche's imported leads (role inboxes the picks
       * made, people from imports): one bounded pass, journaled as a whole. The
       * pool-feeder calls this only when the verifier is free; by hand it spends.
       */
      verifyLeads: async (
        ctx: restate.ObjectContext,
        input: VerifyLeadsInput = {},
      ): Promise<VerificationStats> => {
        const runId = await open(ctx, "verify leads", { ...input });
        const days = input.retryRiskyAfterDays ?? DEFAULT_RETRY_RISKY_DAYS;
        const stats = await ctx.run("verify", () =>
          runVerification(deps.db, deps.verifier, {
            checker,
            ...(input.niche !== undefined ? { niche: input.niche } : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
            concurrency: deps.verifier.costsCredits ? 1 : (input.concurrency ?? 1),
            retryRiskyOlderThanMs: days * 86_400_000,
            ...(input.recheckReturning
              ? {
                  recheckReturning: {
                    policy: input.recheckReturning.policy,
                    olderThanMs: input.recheckReturning.olderThanDays * 86_400_000,
                  },
                }
              : {}),
          }),
        );
        await close(ctx, runId, stats);
        // Nothing checked and the verifier down: that is the stage's failure, not a quiet pass.
        if (stats.aborted && verifiedRows(stats) === 0) {
          throw new restate.TerminalError(`verifier: ${stats.aborted}`);
        }
        return stats;
      },
    },
  });
}

/** Leads that got a verification row this pass. */
export const verifiedRows = (s: VerificationStats) =>
  s.local_invalid + s.valid + s.invalid + s.risky + s.catch_all;

export type Resolution = ReturnType<typeof makeResolution>;

/**
 * One mailbox walk at a time, across every worker. Restate can start a retry of
 * `resolveNewDomains` while the first attempt's walk still runs on another Lambda,
 * and each walk holds its own pool of connections: two at once ran Postgres out of
 * clients (2026-09-28 09:13 UTC). The second walk now fails fast, and Restate retries
 * it after the first ends. The lock is transaction-scoped, so a dead worker's
 * connection closing releases it.
 */
async function oneWalkAtATime<T>(db: Db, walk: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const [row] = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('resolution: new-domain walk')) AS ok`,
    )) as unknown as { ok: boolean }[];
    if (!row?.ok) throw new Error("another mailbox walk is still running; retrying after it ends");
    return walk();
  });
}
