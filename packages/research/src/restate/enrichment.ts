/**
 * Enrichment as a Restate Virtual Object keyed by population: "all" or a niche.
 * One key → one writer, so the stages of one population serialize instead of
 * racing (this replaces the Python per-stage advisory locks). Every unit of work
 * (one company crawled, one document scanned or extracted, one company picked or
 * given its opener line) is its own journaled step over its own transaction, so a
 * crash resumes after the last finished unit and never buys a completion twice. Stats accumulate from
 * journaled unit results, so replay is deterministic.
 *
 * Each handler is one ledger run: opened before the first unit, closed with stats.
 */
import * as restate from "@restatedev/restate-sdk";
import { type Company, companies, finishRun, openRun } from "@wren/core";
import type { Db } from "@wren/db";
import { type LlmClient, NULL_TRACER, type Tracer } from "@wren/llm";
import { eq } from "drizzle-orm";
import { backfillCallRecords } from "../enrichment/audit-backfill.js";
import {
  addCrawlStats,
  type CrawlStats,
  countCrawlNicheNullSkipped,
  crawlCompany,
  emptyCrawlStats,
  type RobotsMode,
  selectCrawlTargets,
} from "../enrichment/crawler.js";
import { PICK_VERSION } from "../enrichment/email-pick/graph.js";
import {
  applyPicks,
  type EmailPickStats,
  pickCompany,
  selectPickTargets,
} from "../enrichment/email-pick/run.js";
import {
  loadScanTarget,
  SCAN_MODEL,
  type ScanStats,
  scanDocument,
  selectScanTargets,
} from "../enrichment/email-scan.js";
import {
  applyExtractions,
  DEFAULT_EXTRACTION_SPEC,
  type ExtractionSpec,
  type ExtractionStats,
  extractDocument,
  loadExtractionTarget,
  selectExtractionTargets,
} from "../enrichment/extraction.js";
import {
  countOpener,
  emptyOpenerStats,
  OPENER_VERSION,
  type OpenerStats,
  selectOpenerTargets,
  writeOpener,
} from "../enrichment/opener.js";
import {
  addRenderStats,
  type BrowserRenderer,
  countRenderNicheNullSkipped,
  emptyRenderStats,
  type RenderStats,
  renderCompany,
  selectRenderTargets,
} from "../enrichment/render.js";
import { Shard } from "../enrichment/shard.js";
import { tagTestimonials } from "../enrichment/testimonials.js";
import type { Fetcher } from "../fetch/fetcher.js";
import type { RobotsCache } from "../fetch/robots.js";
import type { PageStore } from "../pages.js";

export interface EnrichmentDeps {
  db: Db;
  /** null when WREN_FETCH_CONTACT is unset: crawl and render then refuse instead of the worker refusing to start. */
  fetcher: Fetcher | null;
  llm: LlmClient;
  /** Lazily launched per render run and closed after it (Playwright). */
  renderer?: (() => Promise<BrowserRenderer>) | null;
  tracer?: Tracer;
  robotsMode?: RobotsMode;
  /** The extraction prompt to run under; a niche registry can swap it later. */
  extractionSpec?: ExtractionSpec;
  /** Seconds of pause before each browser render; tests zero it. */
  renderJitter?: readonly [number, number];
  /** How long an idle browser stays open between render units before it closes. */
  renderIdleMs?: number;
  /**
   * Per key, the link words a niche's sites use for the pages worth fetching
   * ("our advisors", "team"); on top of the crawler's base hints when a call
   * names none of its own. The niche registry owns the lists.
   */
  crawlHintsFor?: (niche: string | null) => ReadonlySet<string>;
  /** Where archived page HTML is; the scan reads it back for pages `PageArchive` moved. */
  pages?: PageStore | null;
}

/**
 * One browser shared by consecutive render units, closed after it sits idle.
 * Scoped to a unit's ctx.run body rather than the handler, because a replayed
 * handler is a fresh closure: anything opened outside a journaled step leaks.
 */
function browserPool(launch: () => Promise<BrowserRenderer>, idleMs: number) {
  let browser: Promise<BrowserRenderer> | null = null;
  let users = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const closeIdle = () => {
    const open = browser;
    browser = null;
    if (open) void open.then((b) => b.close()).catch(() => undefined);
  };
  return async <T>(fn: (b: BrowserRenderer) => Promise<T>): Promise<T> => {
    if (idle) clearTimeout(idle);
    idle = null;
    users += 1;
    try {
      browser ??= launch().catch((err: unknown) => {
        browser = null;
        throw err;
      });
      return await fn(await browser);
    } finally {
      users -= 1;
      if (users === 0) {
        idle = setTimeout(closeIdle, idleMs);
        idle.unref?.();
      }
    }
  };
}

/** The key that means "every niche". */
export const ALL_NICHES = "all";
/**
 * A key is a niche, or `niche@i/n` for one shard of it: each key runs one handler at
 * a time, so shard keys are how a backlog crawls side by side.
 */
const nicheOf = (ctx: restate.ObjectContext): string | null => {
  const niche = ctx.key.split("@")[0] as string;
  return niche === ALL_NICHES ? null : niche;
};
const keyShard = (ctx: restate.ObjectContext): string | undefined => ctx.key.split("@")[1];

export interface CrawlInput {
  limit?: number;
  /** "i/n" */
  shard?: string;
  pagesPerSite?: number;
  extraHints?: string[];
}
export interface RenderInput extends CrawlInput {}
export interface ScanInput {
  limit?: number;
}
export interface ExtractInput {
  limit?: number;
  shard?: string;
  reextract?: boolean;
}
export interface LimitInput {
  limit?: number;
}
export interface PickInput {
  limit?: number;
  shard?: string;
}
export interface TagInput {
  limit?: number;
  dryRun?: boolean;
}

const parseShard = (text: string | undefined): Shard | null => {
  if (text === undefined) return null;
  try {
    return Shard.parse(text);
  } catch (err) {
    throw new restate.TerminalError(err instanceof Error ? err.message : String(err));
  }
};

/** Bounded retries per unit; when exhausted the run records the abort and stops. */
const UNIT_RETRY = { maxRetryAttempts: 3 } as const;

export function makeEnrichment(deps: EnrichmentDeps) {
  const tracer = deps.tracer ?? NULL_TRACER;
  const robotsMode = deps.robotsMode ?? "warn";
  const spec = deps.extractionSpec ?? DEFAULT_EXTRACTION_SPEC;
  const withBrowser = deps.renderer ? browserPool(deps.renderer, deps.renderIdleMs ?? 5_000) : null;
  const fetcher = (): Fetcher => {
    if (!deps.fetcher) throw new restate.TerminalError("WREN_FETCH_CONTACT is not set");
    return deps.fetcher;
  };
  const hintsFor = (niche: string | null, input: CrawlInput): string[] =>
    input.extraHints ?? [...(deps.crawlHintsFor?.(niche) ?? [])];
  const companyRef = async (id: number): Promise<Pick<Company, "id" | "domain">> => {
    const [row] = await deps.db
      .select({ id: companies.id, domain: companies.domain })
      .from(companies)
      .where(eq(companies.id, id));
    if (!row) throw new restate.TerminalError(`company ${id} vanished`);
    return row;
  };
  const open = (
    ctx: restate.ObjectContext,
    command: string,
    argv: Record<string, unknown>,
    model: string | null = null,
  ) =>
    ctx.run("open run", async () => {
      const run = await openRun(deps.db, { command, argv, niche: nicheOf(ctx), model });
      return run.id;
    });
  const close = (ctx: restate.ObjectContext, runId: string, stats: object) =>
    ctx.run("finish run", () => finishRun(deps.db, runId, stats));
  /** A unit that exhausted its retries aborts the run with its reason instead of failing the handler. */
  const unit = async <T>(ctx: restate.ObjectContext, name: string, fn: () => Promise<T>) => {
    try {
      return { ok: true as const, value: await ctx.run(name, fn, UNIT_RETRY) };
    } catch (err) {
      if (err instanceof restate.TerminalError) return { ok: false as const, reason: err.message };
      throw err;
    }
  };

  return restate.object({
    name: "Enrichment",
    handlers: {
      crawl: async (ctx: restate.ObjectContext, input: CrawlInput = {}): Promise<CrawlStats> => {
        const niche = nicheOf(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(ctx, "enrich crawl", { ...input, niche });
        const ids = await ctx.run("select", async () =>
          (await selectCrawlTargets(deps.db, { limit: input.limit ?? 10, niche, shard })).map(
            (c) => c.id,
          ),
        );
        let stats = emptyCrawlStats();
        for (const id of ids) {
          const r = await unit(ctx, `crawl company ${id}`, async () => {
            const company = await companyRef(id);
            return deps.db.transaction((tx) =>
              crawlCompany(tx, fetcher(), company, {
                pagesPerSite: input.pagesPerSite ?? 5,
                extraHints: hintsFor(niche, input),
                robotsMode,
              }),
            );
          });
          if (!r.ok) break;
          stats = addCrawlStats(stats, r.value);
        }
        if (niche !== null) {
          stats.niche_null_skipped = await ctx.run("count niche-null", () =>
            countCrawlNicheNullSkipped(deps.db),
          );
        }
        await close(ctx, runId, stats);
        return stats;
      },

      render: async (ctx: restate.ObjectContext, input: RenderInput = {}): Promise<RenderStats> => {
        if (!withBrowser) throw new restate.TerminalError("no browser renderer configured");
        const niche = nicheOf(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(ctx, "enrich render", { ...input, niche });
        const ids = await ctx.run("select", async () =>
          (await selectRenderTargets(deps.db, { limit: input.limit ?? 10, niche, shard })).map(
            (c) => c.id,
          ),
        );
        let stats = emptyRenderStats();
        const robots: RobotsCache = new Map();
        for (const id of ids) {
          const r = await unit(ctx, `render company ${id}`, async () => {
            const company = await companyRef(id);
            return withBrowser((browser) =>
              deps.db.transaction((tx) =>
                renderCompany(tx, browser.render, fetcher(), company, robots, {
                  pagesPerSite: input.pagesPerSite ?? 5,
                  extraHints: hintsFor(niche, input),
                  robotsMode,
                  ...(deps.renderJitter ? { jitter: deps.renderJitter } : {}),
                }),
              ),
            );
          });
          if (!r.ok) break;
          stats = addRenderStats(stats, r.value);
        }
        if (niche !== null) {
          stats.niche_null_skipped = await ctx.run("count niche-null", () =>
            countRenderNicheNullSkipped(deps.db),
          );
        }
        await close(ctx, runId, stats);
        return stats;
      },

      scan: async (ctx: restate.ObjectContext, input: ScanInput = {}): Promise<ScanStats> => {
        const niche = nicheOf(ctx);
        const runId = await open(ctx, "enrich scan", { ...input, niche }, SCAN_MODEL);
        const ids = await ctx.run("select", async () =>
          (await selectScanTargets(deps.db, { limit: input.limit, niche })).map((d) => d.id),
        );
        const stats: ScanStats = {
          selected: ids.length,
          scanned: 0,
          signals: 0,
          pages_with_signals: 0,
        };
        for (const id of ids) {
          const signals = await ctx.run(`scan document ${id}`, async () => {
            const doc = await loadScanTarget(deps.db, id);
            if (!doc) return 0;
            return (
              await deps.db.transaction((tx) => scanDocument(tx, doc, runId, deps.pages ?? null))
            ).length;
          });
          stats.scanned += 1;
          stats.signals += signals;
          if (signals) stats.pages_with_signals += 1;
        }
        await close(ctx, runId, stats);
        return stats;
      },

      extract: async (
        ctx: restate.ObjectContext,
        input: ExtractInput = {},
      ): Promise<ExtractionStats> => {
        const niche = nicheOf(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(ctx, "enrich extract", { ...input, niche }, deps.llm.name);
        const selected = await ctx.run("select", async () => {
          const { targets, skippedOlderVersion } = await selectExtractionTargets(
            deps.db,
            deps.llm,
            {
              limit: input.limit,
              niche,
              shard,
              reextract: input.reextract,
              spec,
            },
          );
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
        for (const id of selected.ids) {
          const r = await unit(ctx, `extract document ${id}`, async () => {
            const doc = await loadExtractionTarget(deps.db, id);
            if (!doc) return null;
            return deps.db.transaction((tx) =>
              extractDocument(tx, deps.llm, doc, { runId, tracer, spec }),
            );
          });
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

      applyExtractions: async (ctx: restate.ObjectContext, input: LimitInput = {}) => {
        const runId = await open(ctx, "enrich apply-extractions", { ...input });
        const stats = await ctx.run("apply", () =>
          deps.db.transaction((tx) => applyExtractions(tx, { ...input, spec })),
        );
        await close(ctx, runId, stats);
        return stats;
      },

      pick: async (ctx: restate.ObjectContext, input: PickInput = {}): Promise<EmailPickStats> => {
        const niche = nicheOf(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(
          ctx,
          "enrich pick",
          { ...input, niche, version: PICK_VERSION },
          deps.llm.name,
        );
        const ids = await ctx.run("select", async () =>
          (await selectPickTargets(deps.db, deps.llm, { limit: input.limit, niche, shard })).map(
            (c) => c.id,
          ),
        );
        const stats: EmailPickStats = {
          selected: ids.length,
          picked: 0,
          auto_accepted: 0,
          no_signals: 0,
          no_content: 0,
          classified: 0,
          parse_errors: 0,
          provider_rejected: 0,
          ungrounded_emails: 0,
          ungrounded_names: 0,
          aborted: null,
        };
        for (const id of ids) {
          const r = await unit(ctx, `pick company ${id}`, async () => {
            const [company] = await deps.db.select().from(companies).where(eq(companies.id, id));
            if (!company) return null;
            return deps.db.transaction((tx) =>
              pickCompany(tx, deps.llm, company, { runId, tracer }),
            );
          });
          if (!r.ok) {
            stats.aborted = r.reason;
            break;
          }
          if (!r.value) continue;
          const method = r.value.pick.method;
          if (method === "auto_accept") stats.auto_accepted += 1;
          else if (method === "no_signals") stats.no_signals += 1;
          else if (method === "no_scannable_content") stats.no_content += 1;
          else stats.classified += 1;
          if (r.value.parse_error) stats.parse_errors += 1;
          if (r.value.provider_rejected) stats.provider_rejected += 1;
          stats.ungrounded_emails += r.value.pick.ungrounded?.length ?? 0;
          stats.ungrounded_names += r.value.pick.ungrounded_names?.length ?? 0;
          stats.picked += 1;
        }
        await close(ctx, runId, stats);
        return stats;
      },

      opener: async (ctx: restate.ObjectContext, input: PickInput = {}): Promise<OpenerStats> => {
        const niche = nicheOf(ctx);
        const shard = parseShard(input.shard ?? keyShard(ctx));
        const runId = await open(
          ctx,
          "enrich opener",
          { ...input, niche, version: OPENER_VERSION },
          deps.llm.name,
        );
        const ids = await ctx.run("select", () =>
          selectOpenerTargets(deps.db, deps.llm, { limit: input.limit, niche, shard }),
        );
        const stats = emptyOpenerStats(ids.length);
        for (const id of ids) {
          const r = await unit(ctx, `opener company ${id}`, () =>
            deps.db.transaction((tx) => writeOpener(tx, deps.llm, id, { runId, tracer })),
          );
          if (!r.ok) {
            stats.aborted = r.reason;
            break;
          }
          countOpener(stats, r.value);
        }
        await close(ctx, runId, stats);
        return stats;
      },

      applyPicks: async (ctx: restate.ObjectContext, input: LimitInput = {}) => {
        const runId = await open(ctx, "enrich apply-picks", { ...input });
        const stats = await ctx.run("apply", () =>
          deps.db.transaction((tx) => applyPicks(tx, input)),
        );
        await close(ctx, runId, stats);
        return stats;
      },

      tagTestimonials: async (ctx: restate.ObjectContext, input: TagInput = {}) => {
        const niche = nicheOf(ctx);
        if (niche === null) throw new restate.TerminalError("tagTestimonials needs a niche key");
        const runId = await open(ctx, "enrich tag-testimonials", { ...input, niche });
        const stats = await ctx.run("tag", () =>
          deps.db.transaction((tx) =>
            tagTestimonials(tx, {
              niche,
              runId,
              dryRun: input.dryRun ?? false,
              ...(input.limit !== undefined ? { limit: input.limit } : {}),
            }),
          ),
        );
        await close(ctx, runId, stats);
        return stats;
      },

      backfillCallRecords: async (ctx: restate.ObjectContext, input: LimitInput = {}) => {
        const runId = await open(ctx, "audit backfill", { ...input });
        const stats = await ctx.run("backfill", () =>
          deps.db.transaction((tx) => backfillCallRecords(tx, input)),
        );
        await close(ctx, runId, stats);
        return stats;
      },
    },
  });
}

export type Enrichment = ReturnType<typeof makeEnrichment>;
