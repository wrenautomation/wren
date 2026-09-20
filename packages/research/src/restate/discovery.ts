/**
 * Website discovery as a Virtual Object keyed by niche ("all" = every niche):
 * `discover` guesses and proves domains for companies that have none, `verify`
 * proves domains that were asserted at import. Both are bounded passes (default
 * 25 companies) so one call stays well inside a Lambda invocation; call again
 * until `companies_scanned` is 0. Free throughout: DoH, one homepage fetch per
 * candidate, a deterministic ownership gate. No model, no credits.
 *
 * One journaled step per pass: the run writes its own imports row and a
 * sighting per attached domain, so a replay after a crash re-runs the batch
 * against companies that are no longer domainless — nothing is attached twice.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import type { Db } from "@wren/db";
import { politeHomepageFetcher } from "../discovery/homepage.js";
import {
  type DiscoveryStats,
  type DomainVerificationStats,
  type HomepageFetcher,
  type Resolves,
  runDomainDiscovery,
  runDomainVerification,
} from "../discovery/service.js";
import type { Fetcher } from "../fetch/fetcher.js";
import { ALL_NICHES } from "./enrichment.js";

export const DEFAULT_DISCOVERY_LIMIT = 25;

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
  const pass = async <S extends object>(
    ctx: restate.ObjectContext,
    command: string,
    input: DiscoveryInput,
    body: (opts: {
      limit: number;
      niche: string | null;
      genericWords: ReadonlySet<string>;
    }) => Promise<{ stats: S }>,
  ): Promise<S> => {
    const niche = nicheOf(ctx);
    const limit = input.limit ?? DEFAULT_DISCOVERY_LIMIT;
    const genericWords = deps.genericWordsFor?.(niche) ?? new Set<string>();
    const runId = await ctx.run("open run", async () => {
      const run = await openRun(deps.db, { command, argv: { limit, niche }, niche });
      return run.id;
    });
    const stats = await ctx.run(
      command,
      async () => (await body({ limit, niche, genericWords })).stats,
    );
    await ctx.run("finish run", () => finishRun(deps.db, runId, stats));
    return stats;
  };

  return restate.object({
    name: "Discovery",
    handlers: {
      discover: async (
        ctx: restate.ObjectContext,
        input: DiscoveryInput = {},
      ): Promise<DiscoveryStats> =>
        pass(ctx, "discover run", input, (opts) =>
          runDomainDiscovery(deps.db, {
            ...opts,
            fetchHomepage: fetchHomepage(),
            ...(deps.resolves ? { resolves: deps.resolves } : {}),
          }),
        ),

      verify: async (
        ctx: restate.ObjectContext,
        input: DiscoveryInput = {},
      ): Promise<DomainVerificationStats> =>
        pass(ctx, "discover verify", input, (opts) =>
          runDomainVerification(deps.db, {
            ...opts,
            fetchHomepage: fetchHomepage(),
          }),
        ),
    },
  });
}

export type Discovery = ReturnType<typeof makeDiscovery>;
