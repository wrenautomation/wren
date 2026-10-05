/**
 * Resolution as a Restate Virtual Object with one key: verifier credits are one
 * global budget, so paid spend never runs concurrently (free probes may, many
 * domains at once, in `resolveNewDomains` and `verifyLeads`). Each domain's walk is one
 * journaled step over one transaction; a crash loses at most one domain's spend
 * and the promotions batch runs from journaled refs.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { exclusiveHandler } from "@wren/core/restate";
import type { Db, DbHandle } from "@wren/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
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
import { sharedVerdicts } from "../verification/shared.js";
import type { EmailVerifier } from "../verification/verifier.js";

export interface ResolutionDeps {
  db: Db;
  verifier: EmailVerifier;
  /** Test seam: a stage-1 checker with a fake resolver. */
  checker?: LocalCheckerLike;
  /**
   * A pool of `max` connections for one `resolveNewDomains` pass, closed after it:
   * each domain walk holds a transaction while it probes, so the process's small
   * pool would cap the width. Absent = walk on `db`. `client` names whose database.
   */
  openPool?: (max: number, client?: string) => DbHandle;
  /** A client's database, for calls that name `client`; absent, those calls refuse. */
  clientDb?: ((client: string) => Db) | null;
}

/** Any call may name a client: its work then runs in that client's database, its verdicts shared on main. */
export interface ClientInput {
  client?: string | null;
}

export const RESOLUTION_KEY = "default";

export interface ResolveInput extends ClientInput {
  domainBudget?: number;
  creditLimit?: number | null;
}

export interface ResolveNewInput extends ClientInput {
  niche?: string;
  /** Domains walked this pass. */
  limitDomains: number;
  /** Domain walks at once; each walk is sequential (a verdict decides the next guess). */
  concurrency?: number;
  domainBudget?: number;
}

export interface VerifyLeadsInput extends ClientInput {
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

const NICHE = z.string().nullish().describe("One campaign's leads, e.g. agencies");
const CLIENT = z.string().nullish().describe("A client's id: work in its database");
const QUEUE = z
  .looseObject({
    domain: z.string().nullish(),
    companySourceKey: z.string().nullish(),
    companyDomain: z.string().nullish().describe("A keyless niche's firm, by its website domain"),
    niche: NICHE,
    limitPeople: z.number().nullish(),
    client: CLIENT,
  })
  .nullish();
const RESOLVE = z
  .looseObject({
    domainBudget: z.number().nullish(),
    creditLimit: z.number().nullish(),
    client: CLIENT,
  })
  .nullish();
const RESOLVE_NEW = z.looseObject({
  niche: NICHE,
  client: CLIENT,
  limitDomains: z.number().describe("Domains walked this pass"),
  concurrency: z.number().nullish().describe("Domain walks at once"),
  domainBudget: z.number().nullish(),
});
const VERIFY = z
  .looseObject({
    niche: NICHE,
    client: CLIENT,
    limit: z.number().nullish(),
    retryRiskyAfterDays: z
      .number()
      .nullish()
      .describe("Days before a risky verdict is tried again (2)"),
    concurrency: z.number().nullish().describe("Leads checked at once; free verifiers only (1)"),
    recheckReturning: z
      .looseObject({ policy: z.looseObject({}), olderThanDays: z.number() })
      .nullish()
      .describe("Also re-check proven addresses of companies due another sequence"),
  })
  .nullish();

export function makeResolution(deps: ResolutionDeps) {
  const checker = deps.checker ?? defaultLocalChecker();
  const shared = sharedVerdicts(deps.db, deps.verifier);
  /** Where a call works and what it asks: Wren's on main, a client's in its database through main's verdicts. */
  const scope = (input: ClientInput | null | undefined) => {
    const client = input?.client ?? null;
    if (client === null) return { db: deps.db, verifier: deps.verifier, client };
    if (!deps.clientDb) throw new restate.TerminalError("no client databases here");
    return { db: deps.clientDb(client), verifier: shared, client };
  };
  const open = (
    ctx: restate.ObjectContext,
    db: Db,
    command: string,
    argv: Record<string, unknown>,
  ) =>
    ctx.run("open run", async () => {
      const run = await openRun(db, { command, argv, model: deps.verifier.name });
      return run.id;
    });
  const close = (ctx: restate.ObjectContext, db: Db, runId: string, stats: object) =>
    ctx.run("finish run", () => finishRun(db, runId, stats));

  return restate.object({
    name: "Resolution",
    handlers: {
      build: exclusiveHandler(
        { input: z.looseObject({ limitPeople: z.number().nullish(), client: CLIENT }).nullish() },
        async (ctx: restate.ObjectContext, input: { limitPeople?: number } & ClientInput = {}) => {
          const { db } = scope(input);
          const runId = await open(ctx, db, "resolve build", { ...input });
          const stats = await ctx.run("build", () =>
            db.transaction((tx) => buildCandidates(tx, input)),
          );
          await close(ctx, db, runId, stats);
          return stats;
        },
      ),

      queue: exclusiveHandler(
        { input: QUEUE },
        async (ctx: restate.ObjectContext, input: QueueOptions & ClientInput = {}) => {
          const { db } = scope(input);
          const runId = await open(ctx, db, "resolve queue", { ...input });
          const stats = await ctx.run("queue", () =>
            db.transaction((tx) => queueCandidates(tx, input)),
          );
          await close(ctx, db, runId, stats);
          return stats;
        },
      ),

      /** Paid verifier credits: never by hand (queue it), so never through the ingress. */
      resolve: exclusiveHandler(
        { input: RESOLVE, effect: "spends", ingressPrivate: true },
        async (ctx: restate.ObjectContext, input: ResolveInput = {}): Promise<ResolutionStats> => {
          const domainBudget = input.domainBudget ?? DEFAULT_DOMAIN_BUDGET;
          const creditLimit = input.creditLimit ?? null;
          const { db, verifier } = scope(input);
          const runId = await open(ctx, db, "resolve run", { ...input });
          const promotions: PromotionRef[] = await ctx.run("stranded", () =>
            strandedPromotions(db),
          );
          const domains = await ctx.run("select", () => selectResolutionTargets(db));
          let stats = emptyResolutionStats();
          stats.stranded_repaired = promotions.length;
          let spent = 0;
          for (const domain of domains) {
            const alreadySpent = spent;
            const r = await ctx.run(`resolve ${domain}`, () =>
              db.transaction((tx) =>
                resolveDomainUnit(tx, verifier, domain, {
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
              db.transaction((tx) => promoteCandidates(tx, promotions)),
            );
          }
          await close(ctx, db, runId, stats);
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
      resolveNewDomains: exclusiveHandler(
        { input: RESOLVE_NEW },
        async (ctx: restate.ObjectContext, input: ResolveNewInput): Promise<ResolutionStats> => {
          if (deps.verifier.costsCredits)
            throw new restate.TerminalError(
              "resolveNewDomains spends without a limit: free verifiers only",
            );
          const domainBudget = input.domainBudget ?? DEFAULT_DOMAIN_BUDGET;
          const { db: home, verifier, client } = scope(input);
          const runId = await open(ctx, home, "resolve new domains", { ...input });
          const width = input.concurrency ?? 1;
          const { stats, promotions } = await ctx.run("walk", async () => {
            // One more connection than the walk's width: the lock holds it for the whole walk.
            const pool = deps.openPool?.(width + 1, client ?? undefined) ?? null;
            const db = pool?.db ?? home;
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
                      resolveDomainUnit(tx, verifier, domain, {
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
              home.transaction((tx) => promoteCandidates(tx, promotions)),
            );
          }
          await close(ctx, home, runId, stats);
          // Nothing walked and the verifier down: that is the stage's failure, not a quiet pass.
          if (stats.aborted && stats.credits_spent === 0) {
            throw new restate.TerminalError(`verifier: ${stats.aborted}`);
          }
          return stats;
        },
      ),

      /**
       * The verification funnel over a niche's imported leads (role inboxes the picks
       * made, people from imports): one bounded pass, journaled as a whole. The
       * pool-feeder calls this only when the verifier is free; by hand it spends.
       */
      verifyLeads: exclusiveHandler(
        { input: VERIFY, effect: "spends" },
        async (
          ctx: restate.ObjectContext,
          input: VerifyLeadsInput = {},
        ): Promise<VerificationStats> => {
          const { db, verifier } = scope(input);
          const runId = await open(ctx, db, "verify leads", { ...input });
          const days = input.retryRiskyAfterDays ?? DEFAULT_RETRY_RISKY_DAYS;
          const stats = await ctx.run("verify", () =>
            runVerification(db, verifier, {
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
          await close(ctx, db, runId, stats);
          // Nothing checked and the verifier down: that is the stage's failure, not a quiet pass.
          if (stats.aborted && verifiedRows(stats) === 0) {
            throw new restate.TerminalError(`verifier: ${stats.aborted}`);
          }
          return stats;
        },
      ),
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
