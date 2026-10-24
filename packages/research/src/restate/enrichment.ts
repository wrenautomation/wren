/**
 * Enrichment as a Restate Virtual Object keyed by population: "all" or a niche.
 * One key → one writer, so the stages of one population serialize instead of
 * racing (this replaces the Python per-stage advisory locks). Every unit of work
 * (one company crawled, one document scanned or extracted, one company picked or
 * given its opener line) runs over its own transaction. Free units share a journaled
 * step in batches (`unitBatches`): a crash re-runs the batch it hit. A unit that buys
 * a model call or a metered read is its own step, so a completion is never bought
 * twice. Stats accumulate from journaled unit results, so replay is deterministic.
 *
 * Each handler is one ledger run: opened before the first unit, closed with stats.
 */
import * as restate from "@restatedev/restate-sdk";
import { type EnrichmentDeps, enrichmentContext } from "./enrichment-context.js";
import { crawlHandlers } from "./enrichment-crawl.js";
import { peopleHandlers } from "./enrichment-people.js";
import { picksHandlers } from "./enrichment-picks.js";
import { searchHandlers } from "./enrichment-search.js";
import { socialHandlers } from "./enrichment-social.js";

export {
  ALL_NICHES,
  type CrawlInput,
  clientBlock,
  type EnrichmentDeps,
  keyScope,
  type LimitInput,
} from "./enrichment-context.js";
export type { ExtractInput, RenderInput, ScanInput } from "./enrichment-crawl.js";
export type { ProfilesInput, SignalsInput, TeamInput } from "./enrichment-people.js";
export type { EmailPickInput, PickInput, TagInput } from "./enrichment-picks.js";

export function makeEnrichment(deps: EnrichmentDeps) {
  const enrich = enrichmentContext(deps);
  return restate.object({
    name: "Enrichment",
    handlers: {
      ...crawlHandlers(enrich),
      ...picksHandlers(enrich),
      ...peopleHandlers(enrich),
      ...socialHandlers(enrich),
      ...searchHandlers(enrich),
    },
  });
}

export type Enrichment = ReturnType<typeof makeEnrichment>;
