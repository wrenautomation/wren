/** Enrichment handlers that crawl, render and scan sites and extract from them. */
import * as restate from "@restatedev/restate-sdk";
import { exclusiveHandler } from "@wren/core/restate";
import { atomic } from "@wren/db";
import { z } from "zod";
import {
  CONTACTS_MODEL,
  type ContactsStats,
  loadContactTarget,
  scanContacts,
  selectContactTargets,
} from "../enrichment/contacts.js";
import {
  addCrawlStats,
  type CrawlStats,
  countCrawlNicheNullSkipped,
  crawlCompany,
  emptyCrawlStats,
  selectCrawlTargets,
} from "../enrichment/crawler.js";
import {
  loadScanTarget,
  SCAN_MODEL,
  type ScanStats,
  scanDocument,
  selectScanTargets,
} from "../enrichment/email-scan.js";
import {
  applyExtractions,
  type ExtractionStats,
  extractDocument,
  loadExtractionTarget,
  selectExtractionTargets,
} from "../enrichment/extraction.js";
import {
  addRenderStats,
  climbCompany,
  countRenderNicheNullSkipped,
  DEFAULT_LADDER_LIMIT,
  emptyRenderStats,
  type RenderStats,
  renderCompany,
  selectRenderTargets,
} from "../enrichment/render.js";
import type { RobotsCache } from "../fetch/robots.js";
import {
  type CrawlInput,
  type EnrichmentContext,
  HELD,
  keyShard,
  LIMIT,
  LIMIT_FIELD,
  type LimitInput,
  parseShard,
  SHARD,
  UNIT_RETRY,
} from "./enrichment-context.js";
import { notHeld, stageHolds, unitBatches } from "./units.js";

export interface RenderInput extends CrawlInput {
  /** `web GET /fetch` calls this run may make; each call takes one. Default 40. */
  ladderLimit?: number;
}

export interface ScanInput {
  limit?: number;
}

export interface ExtractInput {
  limit?: number;
  shard?: string;
  reextract?: boolean;
}

const CRAWL_FIELDS = {
  limit: LIMIT_FIELD,
  shard: SHARD,
  pagesPerSite: z.number().nullish(),
  extraHints: z.array(z.string()).nullish().describe("More words that mark a people page"),
};

const CRAWL = z.looseObject(CRAWL_FIELDS).nullish();

const RENDER = z
  .looseObject({
    ...CRAWL_FIELDS,
    ladderLimit: z.number().nullish().describe("Fetch ladder calls this run may make (default 40)"),
  })
  .nullish();

const EXTRACT = z
  .looseObject({ limit: LIMIT_FIELD, shard: SHARD, reextract: z.boolean().nullish() })
  .nullish();

export function crawlHandlers(enrich: EnrichmentContext) {
  const {
    deps,
    llmOf,
    tracer,
    spec,
    memory,
    withBrowser,
    hintsFor,
    scope,
    companyRef,
    open,
    close,
    unit,
  } = enrich;
  return {
    crawl: exclusiveHandler(
      { input: CRAWL },
      async (ctx: restate.ObjectContext, input: CrawlInput = {}): Promise<CrawlStats> => {
        const { db, niche, fetch } = scope(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(ctx, "enrich crawl", { ...input, niche });
        const ids = await ctx.run("select", async () =>
          (await selectCrawlTargets(db, { limit: input.limit ?? 10, niche, shard })).map(
            (c) => c.id,
          ),
        );
        let stats = emptyCrawlStats();
        const holds = await stageHolds(ctx, db, HELD.crawl);
        const units = unitBatches(
          ctx,
          "crawl company",
          notHeld(holds, ids),
          async (id) => {
            const company = await companyRef(db, id);
            return atomic(db, (tx) =>
              crawlCompany(tx, fetch(), company, {
                pagesPerSite: input.pagesPerSite ?? 5,
                extraHints: hintsFor(niche, input),
                memory,
              }),
            );
          },
          { retry: UNIT_RETRY, holds },
        );
        for await (const r of units) {
          if (!r.ok) break;
          stats = addCrawlStats(stats, r.value);
        }
        if (niche !== null) {
          stats.niche_null_skipped = await ctx.run("count niche-null", () =>
            countCrawlNicheNullSkipped(db),
          );
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    render: exclusiveHandler(
      { input: RENDER },
      async (ctx: restate.ObjectContext, input: RenderInput = {}): Promise<RenderStats> => {
        if (!withBrowser && !deps.ladder)
          throw new restate.TerminalError("no browser renderer or fetch ladder configured");
        const { db, niche, fetch } = scope(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(ctx, "enrich render", { ...input, niche });
        const targets = await ctx.run("select", async () => {
          const found = await selectRenderTargets(db, {
            limit: input.limit ?? 10,
            niche,
            shard,
            shells: withBrowser !== null,
            blocked: Boolean(deps.ladder),
            deadDomains: deps.ladder ? await memory.dead() : [],
          });
          return {
            shells: found.shells.map((c) => c.id),
            blocked: found.blocked.map((c) => c.id),
          };
        });
        const blocked = new Set(targets.blocked);
        let stats = emptyRenderStats();
        const robots: RobotsCache = new Map();
        // Shared by the run's units. Replayed units do not run again, so it is reset from the stats.
        const budget = { left: input.ladderLimit ?? DEFAULT_LADDER_LIMIT };
        const holds = await stageHolds(ctx, db, HELD.render);
        const options = {
          pagesPerSite: input.pagesPerSite ?? 5,
          extraHints: hintsFor(niche, input),
          memory,
        };
        const units = unitBatches(
          ctx,
          "render company",
          notHeld(holds, [...targets.shells, ...targets.blocked]),
          async (id) => {
            const company = await companyRef(db, id);
            if (blocked.has(id) && deps.ladder) {
              const ladder = { sites: deps.ladder, budget };
              return atomic(db, (tx) =>
                climbCompany(tx, ladder, fetch(), company, robots, options),
              );
            }
            if (!withBrowser) throw new restate.TerminalError("no browser renderer configured");
            return withBrowser((browser) =>
              atomic(db, (tx) =>
                renderCompany(tx, browser.render, fetch(), company, robots, {
                  ...options,
                  ...(deps.renderJitter ? { jitter: deps.renderJitter } : {}),
                }),
              ),
            );
          },
          { retry: UNIT_RETRY, holds },
        );
        for await (const r of units) {
          if (!r.ok) break;
          stats = addRenderStats(stats, r.value);
          budget.left = Math.min(
            budget.left,
            (input.ladderLimit ?? DEFAULT_LADDER_LIMIT) - stats.ladder_requests,
          );
        }
        if (niche !== null) {
          stats.niche_null_skipped = await ctx.run("count niche-null", () =>
            countRenderNicheNullSkipped(db),
          );
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    scan: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: ScanInput = {}): Promise<ScanStats> => {
        const { db, niche } = scope(ctx);
        const runId = await open(ctx, "enrich scan", { ...input, niche }, SCAN_MODEL);
        const ids = await ctx.run("select", async () =>
          (await selectScanTargets(db, { limit: input.limit, niche })).map((d) => d.id),
        );
        const stats: ScanStats = {
          selected: ids.length,
          scanned: 0,
          signals: 0,
          pages_with_signals: 0,
        };
        const holds = await stageHolds(ctx, db, HELD.scan);
        const units = unitBatches(
          ctx,
          "scan document",
          notHeld(holds, ids),
          async (id) => {
            const doc = await loadScanTarget(db, id);
            if (!doc) return 0;
            return (await atomic(db, (tx) => scanDocument(tx, doc, runId, deps.pages ?? null)))
              .length;
          },
          { retry: UNIT_RETRY, holds },
        );
        for await (const r of units) {
          const signals = r.ok ? r.value : 0;
          stats.scanned += 1;
          stats.signals += signals;
          if (signals) stats.pages_with_signals += 1;
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    /** Phones, LinkedIn and socials off every page not read yet (free; archived pages from the bucket). */
    contacts: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: ScanInput = {}): Promise<ContactsStats> => {
        const { db, niche } = scope(ctx);
        const runId = await open(ctx, "enrich contacts", { ...input, niche }, CONTACTS_MODEL);
        const ids = await ctx.run("select", () =>
          selectContactTargets(db, { limit: input.limit, niche }),
        );
        const stats: ContactsStats = {
          selected: ids.length,
          scanned: 0,
          points: 0,
          pages_with_points: 0,
        };
        const holds = await stageHolds(ctx, db, HELD.contacts);
        const units = unitBatches(
          ctx,
          "read contacts",
          notHeld(holds, ids),
          async (id) => {
            const doc = await loadContactTarget(db, id);
            if (!doc) return 0;
            return (await atomic(db, (tx) => scanContacts(tx, doc, runId, deps.pages ?? null)))
              .length;
          },
          { retry: UNIT_RETRY, holds },
        );
        for await (const r of units) {
          const points = r.ok ? r.value : 0;
          stats.scanned += 1;
          stats.points += points;
          if (points) stats.pages_with_points += 1;
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    extract: exclusiveHandler(
      { input: EXTRACT },
      async (ctx: restate.ObjectContext, input: ExtractInput = {}): Promise<ExtractionStats> => {
        const { db, niche } = scope(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(ctx, "enrich extract", { ...input, niche }, deps.llm.name);
        const llm = llmOf(ctx, HELD.extract, runId);
        const selected = await ctx.run("select", async () => {
          const { targets, skippedOlderVersion } = await selectExtractionTargets(db, deps.llm, {
            limit: input.limit,
            niche,
            shard,
            reextract: input.reextract,
            spec,
          });
          return { ids: targets.map((d) => d.id), skippedOlderVersion };
        });
        const stats: ExtractionStats = {
          selected: selected.ids.length,
          extracted: 0,
          parse_errors: 0,
          provider_rejected: 0,
          ungrounded_emails: 0,
          skipped_older_version: selected.skippedOlderVersion,
          aborted: null,
        };
        const holds = await stageHolds(ctx, db, HELD.extract);
        for (const id of notHeld(holds, selected.ids)) {
          const r = await unit(
            ctx,
            `extract document ${id}`,
            async () => {
              const doc = await loadExtractionTarget(db, id);
              if (!doc) return null;
              return atomic(db, (tx) => extractDocument(tx, llm, doc, { runId, tracer, spec }));
            },
            { holds, id },
          );
          if (!r.ok) {
            stats.aborted = r.reason;
            break;
          }
          if (!r.value) continue;
          stats.ungrounded_emails += r.value.ungrounded.length;
          if (r.value.outcome === "provider_rejected") stats.provider_rejected += 1;
          else if (r.value.outcome === "parse_error") stats.parse_errors += 1;
          else stats.extracted += 1;
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    applyExtractions: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}) => {
        const { db } = scope(ctx);
        const runId = await open(ctx, "enrich apply-extractions", { ...input });
        const stats = await ctx.run("apply", () =>
          atomic(db, (tx) => applyExtractions(tx, { ...input, spec })),
        );
        await close(ctx, runId, stats);
        return stats;
      },
    ),
  };
}
