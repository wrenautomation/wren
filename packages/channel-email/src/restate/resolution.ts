/**
 * Resolution as a Restate Virtual Object with one key: verifier credits are one
 * global budget, so spend never runs concurrently. Each domain's walk is one
 * journaled step over one transaction; a crash loses at most one domain's spend
 * and the promotions batch runs from journaled refs.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import type { Db } from "@wren/db";
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
}

export const RESOLUTION_KEY = "default";

export interface ResolveInput {
  domainBudget?: number;
  creditLimit?: number | null;
}

export interface VerifyLeadsInput {
  niche?: string;
  limit?: number;
  /** Days after which a `risky` verdict is tried again (default 2). */
  retryRiskyAfterDays?: number;
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

      resolve: async (
        ctx: restate.ObjectContext,
        input: ResolveInput = {},
      ): Promise<ResolutionStats> => {
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
            retryRiskyOlderThanMs: days * 86_400_000,
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
