/**
 * Website discovery as a Virtual Object keyed by niche ("all" = every niche):
 * `discover` guesses and proves domains for companies that have none, `verify`
 * proves domains that were asserted at import. Each pass is bounded (default 10
 * companies) and every company is its own journaled unit, so a worker dying
 * mid-pass loses one company's guesses, not the pass. Call again until
 * `companies_scanned` is 0. Free throughout: DoH, one homepage fetch per
 * candidate, a deterministic ownership gate. No model, no credits.
 */
import * as restate from "@restatedev/restate-sdk";
import { type Company, companies, finishRun, openRun } from "@wren/core";
import type { Db } from "@wren/db";
import { eq } from "drizzle-orm";
import { politeHomepageFetcher } from "../discovery/homepage.js";
import {
  addDiscoveryStats,
  addVerificationStats,
  closeDiscoveryBatch,
  countDiscoveryNicheNullSkipped,
  countVerificationNicheNullSkipped,
  DISCOVERY_SOURCE_TYPE,
  type DiscoveryStats,
  type DiscoveryUnitOptions,
  type DomainVerificationStats,
  discoverCompany,
  emptyDiscoveryStats,
  emptyVerificationStats,
  type HomepageFetcher,
  openDiscoveryBatch,
  type Resolves,
  selectDiscoveryTargets,
  selectVerificationTargets,
  VERIFICATION_SOURCE_TYPE,
  verifyCompanyDomain,
} from "../discovery/service.js";
import type { Fetcher } from "../fetch/fetcher.js";
import { ALL_NICHES } from "./enrichment.js";

export const DEFAULT_DISCOVERY_LIMIT = 10;
/** Bounded retries per company; when exhausted the unit is skipped, not the pass. */
const UNIT_RETRY = { maxRetryAttempts: 3 } as const;

export interface DiscoveryDeps {
  db: Db;
  /** null until WREN_FETCH_CONTACT names a contact; every call then refuses. */
  fetcher: Fetcher | null;
  /**
   * Per key, the words a firm name shares with its whole industry ("advisors",
   * "agency"): the candidate generator drops them and the gate treats them as weak.
   * The niche registry owns the lists; this package never imports it.
   */
  genericWordsFor?: (niche: string | null) => ReadonlySet<string>;
  /** DNS seam for tests; DoH by default. */
  resolves?: Resolves;
  fetchHomepage?: HomepageFetcher;
}

export interface DiscoveryInput {
  limit?: number;
}

export function makeDiscovery(deps: DiscoveryDeps) {
  const fetchHomepage = (): HomepageFetcher => {
    if (deps.fetchHomepage) return deps.fetchHomepage;
    if (!deps.fetcher) throw new restate.TerminalError("WREN_FETCH_CONTACT is not set");
    return politeHomepageFetcher(deps.fetcher);
  };
  const nicheOf = (ctx: restate.ObjectContext) => (ctx.key === ALL_NICHES ? null : ctx.key);
  const companyById = async (id: number): Promise<Company> => {
    const [row] = await deps.db.select().from(companies).where(eq(companies.id, id));
    if (!row) throw new restate.TerminalError(`company ${id} vanished`);
    return row;
  };

  /**
   * The shared shape of both passes: ledger row + batch, select, one journaled
   * unit per company, close both. `unit` runs one company against the batch.
   */
  const pass = async <S extends { niche_null_skipped?: number }>(
    ctx: restate.ObjectContext,
    input: DiscoveryInput,
    shape: {
      command: string;
      sourceType: string;
      empty: () => S;
      add: (total: S, unit: S) => S;
      select: (opts: { limit: number; niche: string | null }) => Promise<Company[]>;
      nicheNullSkipped: () => Promise<number>;
      unit: (company: Company, opts: DiscoveryUnitOptions) => Promise<S>;
    },
  ): Promise<S> => {
    const niche = nicheOf(ctx);
    const limit = input.limit ?? DEFAULT_DISCOVERY_LIMIT;
    const genericWords = deps.genericWordsFor?.(niche) ?? new Set<string>();
    // No fetch contact = the whole pass refuses, up front, before a ledger row opens.
    const homepage = fetchHomepage();
    const opened = await ctx.run("open run", async () => {
      const run = await openRun(deps.db, { command: shape.command, argv: { limit, niche }, niche });
      const batch = await openDiscoveryBatch(deps.db, shape.sourceType, { limit, niche });
      return { runId: run.id, batchId: batch.id };
    });
    const ids = await ctx.run("select", async () =>
      (await shape.select({ limit, niche })).map((c) => c.id),
    );
    let stats = shape.empty();
    let rowNumber = 0;
    for (const id of ids) {
      rowNumber += 1;
      const row = rowNumber;
      try {
        const unit = await ctx.run(
          `${shape.command} company ${id}`,
          async () =>
            shape.unit(await companyById(id), {
              batchId: opened.batchId,
              rowNumber: row,
              genericWords,
              fetchHomepage: homepage,
              ...(deps.resolves ? { resolves: deps.resolves } : {}),
            }),
          UNIT_RETRY,
        );
        stats = shape.add(stats, unit);
      } catch (err) {
        // A unit out of retries is skipped: the pass still closes with what it has.
        if (!(err instanceof restate.TerminalError)) throw err;
      }
    }
    if (niche !== null) {
      stats.niche_null_skipped = await ctx.run("count niche-null", () => shape.nicheNullSkipped());
    }
    await ctx.run("finish run", async () => {
      await closeDiscoveryBatch(deps.db, opened.batchId, stats);
      await finishRun(deps.db, opened.runId, stats);
    });
    return stats;
  };

  return restate.object({
    name: "Discovery",
    handlers: {
      discover: async (
        ctx: restate.ObjectContext,
        input: DiscoveryInput = {},
      ): Promise<DiscoveryStats> =>
        pass<DiscoveryStats>(ctx, input, {
          command: "discover run",
          sourceType: DISCOVERY_SOURCE_TYPE,
          empty: emptyDiscoveryStats,
          add: addDiscoveryStats,
          select: (o) => selectDiscoveryTargets(deps.db, o),
          nicheNullSkipped: () => countDiscoveryNicheNullSkipped(deps.db),
          unit: (c, o) => discoverCompany(deps.db, c, o),
        }),

      verify: async (
        ctx: restate.ObjectContext,
        input: DiscoveryInput = {},
      ): Promise<DomainVerificationStats> =>
        pass<DomainVerificationStats>(ctx, input, {
          command: "discover verify",
          sourceType: VERIFICATION_SOURCE_TYPE,
          empty: emptyVerificationStats,
          add: addVerificationStats,
          select: (o) => selectVerificationTargets(deps.db, o),
          nicheNullSkipped: () => countVerificationNicheNullSkipped(deps.db),
          unit: (c, o) => verifyCompanyDomain(deps.db, c, o),
        }),
    },
  });
}

export type Discovery = ReturnType<typeof makeDiscovery>;
