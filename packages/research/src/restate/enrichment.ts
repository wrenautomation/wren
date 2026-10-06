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
import {
  type Company,
  type CompanyScreen,
  companies,
  finishRun,
  openRun,
  runScreen,
} from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import { clientOfKey, exclusiveHandler } from "@wren/core/restate";
import { atomic, type Db, type Queryable } from "@wren/db";
import { type LlmClient, NULL_TRACER, type Tracer } from "@wren/llm";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  AD_LIBRARY_COMMAND,
  type AdLibraryStats,
  adKeywordsDue,
  adLibraryRoom,
  adLibraryUnit,
  countAdLibraryUnit,
  emptyAdLibraryStats,
} from "../enrichment/ad-library.js";
import { backfillCallRecords } from "../enrichment/audit-backfill.js";
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
  type RobotsMode,
  selectCrawlTargets,
} from "../enrichment/crawler.js";
import { PICK_VERSION, RULES_PICKER } from "../enrichment/email-pick/graph.js";
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
  countExaSearchUnit,
  EXA_SEARCH_COMMAND,
  type ExaSearchStats,
  emptyExaSearchStats,
  exaSearches,
  exaSearchesDue,
  exaSearchRoom,
  exaSearchUnit,
} from "../enrichment/exa-search.js";
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
  countFbGroupsUnit,
  emptyFbGroupsStats,
  FB_GROUPS_COMMAND,
  type FbGroupsStats,
  groupAboutUnit,
  groupKeywordsDue,
  groupPostUnit,
  groupReadRoom,
  groupReadsDue,
  groupSearchRoom,
  groupSearchUnit,
  mapPosts,
} from "../enrichment/fb-groups.js";
import {
  countInstagramUnit,
  emptyInstagramStats,
  INSTAGRAM_COMMAND,
  INSTAGRAM_MIN_BATCH,
  type InstagramStats,
  instagramRoom,
  instagramUnit,
  instagramWork,
} from "../enrichment/instagram.js";
import {
  countOpener,
  emptyOpenerStats,
  OPENER_VERSION,
  type OpenerStats,
  selectOpenerTargets,
  writeOpener,
} from "../enrichment/opener.js";
import {
  countProfileUnit,
  emptyProfileStats,
  googleLeft,
  linkedinParkedUntil,
  PROFILES_COMMAND,
  type ProfileStats,
  profilesParkedUntil,
  profileUnit,
  profileWork,
} from "../enrichment/profiles.js";
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
import { sharedPages } from "../enrichment/shared-pages.js";
import {
  countTeamUnit,
  emptyTeamStats,
  TEAM_COMMAND,
  type TeamStats,
  teamParkedUntil,
  teamRoom,
  teamUnit,
  teamWork,
} from "../enrichment/team.js";
import { tagTestimonials } from "../enrichment/testimonials.js";
import {
  countYouTubeUnit,
  emptyYouTubeStats,
  YOUTUBE_COMMAND,
  YOUTUBE_MIN_BATCH,
  type YouTubeGet,
  type YouTubeStats,
  youtubeRoom,
  youtubeUnit,
  youtubeWork,
} from "../enrichment/youtube.js";
import {
  countYouTubeSearchUnit,
  emptyYouTubeSearchStats,
  YOUTUBE_SEARCH_COMMAND,
  type YouTubeSearchStats,
  youtubeSearchesDue,
  youtubeSearchRoom,
  youtubeSearchUnit,
} from "../enrichment/youtube-search.js";
import type { Fetcher } from "../fetch/fetcher.js";
import type { RobotsCache } from "../fetch/robots.js";
import { keepingAnswers } from "../findings.js";
import type { PageStore } from "../pages.js";
import {
  type BaseDeps,
  COLLECTORS,
  countSignalUnit,
  emptySignalsStats,
  passOf,
  planStats,
  readAccount,
  SIGNALS_COMMAND,
  SIGNALS_HELD,
  type SignalsStats,
  signalPlan,
  signalSettings,
  signalUnit,
} from "../signals/collectors.js";
import {
  holdFailed,
  landed,
  notHeld,
  type StageHolds,
  stageHolds,
  UNITS_PER_RUN,
  unitBatches,
} from "./units.js";

export interface EnrichmentDeps {
  db: Db;
  /** A client's database, for `<client>/...` keys; absent, those keys refuse. */
  clientDb?: ((client: string) => Db) | null;
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
  /** autobrowse's sites, for `profiles` (Exa's cache, Google); null = that stage refuses. */
  sites?: SiteClient | null;
  /** The LinkedIn account `profiles` reads logged in as (`WREN_POOL_LINKEDIN`); null = never. */
  linkedin?: string | null;
  /**
   * Recompute a firm's lead cross-checks after `profiles` reads its person and
   * page (channel-email's `recheckLeads`, injected: research never imports it).
   */
  recheck?: (db: Queryable, companyIds: number[]) => Promise<unknown>;
  /** The YouTube Data API as Wren's service account; null = `youtube` refuses. */
  youtube?: YouTubeGet | null;
  /** autobrowse's `meta` site, for the `instagram` reads; null = `instagram` refuses. */
  instagram?: SiteClient | null;
  /** autobrowse on the Mac (`desk`), for the signed-out `fb-public` reads; null = `adLibrary` refuses. */
  desk?: SiteClient | null;
  /** A niche's Ad Library keywords, its platform hosts and its screen (the niche registry's). */
  adsFor?: (niche: string) => {
    keywords: readonly string[];
    platforms: Iterable<string>;
    screen: CompanyScreen | null;
  } | null;
  /** A niche's Facebook group searches (the niche registry's); the same `desk` reads them. */
  groupsFor?: (niche: string) => { keywords: readonly string[] } | null;
  /** autobrowse's `sites` service (`web GET /exa/companies`, Exa's company index); null = `exaSearch` refuses. */
  exaSites?: SiteClient | null;
  /** A niche's Exa queries (`{city}` slots), their cities, its platform hosts and its screen. */
  exaFor?: (niche: string) => {
    queries: readonly string[];
    cities: readonly string[];
    platforms: Iterable<string>;
    screen: CompanyScreen | null;
  } | null;
  /** A niche's YouTube channel searches, its platform hosts and its screen; read with `youtube`. */
  youtubeSearchFor?: (niche: string) => {
    queries: readonly string[];
    platforms: Iterable<string>;
    screen: CompanyScreen | null;
  } | null;
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
 * a time, so shard keys are how a backlog crawls side by side. `<client>/<niche>` (and
 * `<client>/all`) is the same in that client's database; a bare key is Wren's, on main.
 */
export function keyScope(
  key: string,
  main: Db,
  clientDb?: ((client: string) => Db) | null,
): { db: Db; niche: string | null } {
  const base = key.split("@")[0] as string;
  const owner = clientOfKey(base);
  if (owner && !clientDb) throw new restate.TerminalError(`no client databases here: ${key}`);
  const unit = owner?.unit ?? base;
  return {
    db: owner && clientDb ? clientDb(owner.client) : main,
    niche: unit === ALL_NICHES ? null : unit,
  };
}
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
export interface EmailPickInput extends PickInput {
  /** Pick without the model (byRules), under model "deterministic": free. */
  rules?: boolean;
}
export interface TagInput {
  limit?: number;
  dryRun?: boolean;
}

export interface ProfilesInput {
  /** People in the order they will be emailed; the due ones are looked up. */
  personIds: number[];
  /** People this call; each is a few site calls, so a pass stays well inside one Lambda. */
  limit?: number;
  /** The zone Google's day and hours are kept in. */
  timezone: string;
}

export interface TeamInput {
  /** Firms in the order they should be searched; the due ones are. */
  companyIds: number[];
  /** Firms this call; each is one metered search. */
  limit?: number;
}

const LIMIT_FIELD = z.number().nullish().describe("Units this pass");
const SHARD = z.string().nullish().describe('"i/n": this worker\'s slice');
const LIMIT = z.looseObject({ limit: LIMIT_FIELD }).nullish();
const SHARDED = z.looseObject({ limit: LIMIT_FIELD, shard: SHARD }).nullish();
const CRAWL = z
  .looseObject({
    limit: LIMIT_FIELD,
    shard: SHARD,
    pagesPerSite: z.number().nullish(),
    extraHints: z.array(z.string()).nullish().describe("More words that mark a people page"),
  })
  .nullish();
const EXTRACT = z
  .looseObject({ limit: LIMIT_FIELD, shard: SHARD, reextract: z.boolean().nullish() })
  .nullish();
const PICK = z
  .looseObject({
    limit: LIMIT_FIELD,
    shard: SHARD,
    rules: z.boolean().nullish().describe("Pick without the model: free"),
  })
  .nullish();
const TAG = z.looseObject({ limit: LIMIT_FIELD, dryRun: z.boolean().nullish() }).nullish();
const PROFILES = z.looseObject({
  personIds: z.array(z.number()).describe("People in send order; the due ones are looked up"),
  limit: z.number().nullish().describe("People this call"),
  timezone: z.string().describe("The zone Google's day and hours are kept in"),
});

export interface SignalsInput {
  /** People in send order; their firms follow. */
  personIds: number[];
  /** More firms to read. */
  companyIds?: number[];
  /** Subjects per collector this call. */
  limit?: number;
  /** The zone Google's day and hours are kept in. */
  timezone: string;
  /** Only this collector. */
  collector?: string;
}
const SIGNALS = z.looseObject({
  personIds: z.array(z.number()).describe("People in send order; their firms follow"),
  companyIds: z.array(z.number()).nullish().describe("More firms to read"),
  limit: z.number().nullish().describe("Subjects per collector this call"),
  timezone: z.string().describe("The zone Google's day and hours are kept in"),
  collector: z.string().nullish().describe("Only this collector"),
});

const TEAM = z.looseObject({
  companyIds: z.array(z.number()).describe("Firms in search order; the due ones are searched"),
  limit: z.number().nullish().describe("Firms this call"),
});

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
/**
 * Each loop's stage in `unit_holds`: a unit out of retries is held there 7 days, then tried once
 * more, so one bad row never stops a stage (designs/2026-10-05-checks.md).
 */
const HELD = {
  crawl: "research.crawl",
  render: "research.render",
  scan: "research.scan",
  contacts: "research.contacts",
  extract: "research.extract",
  pick: "research.pick",
  opener: "research.opener",
  profiles: "research.profiles",
  team: "research.team",
  youtube: "research.youtube",
  instagram: "research.instagram",
  ads: "research.ads",
  exa: "research.exa-search",
  youtubeSearch: "research.youtube-search",
  groups: "research.fb-groups",
} as const;

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
  const scope = (ctx: restate.ObjectContext) => {
    const at = keyScope(ctx.key, deps.db, deps.clientDb);
    // A client's crawl reads and feeds main's shared pages; Wren's crawl is main's already.
    const fetch = () =>
      at.db === deps.db ? fetcher() : sharedPages(deps.db, fetcher(), deps.pages ?? null);
    return { ...at, fetch };
  };
  const companyRef = async (db: Db, id: number): Promise<Pick<Company, "id" | "domain">> => {
    const [row] = await db
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
      const { db, niche } = scope(ctx);
      const run = await openRun(db, { command, argv, niche, model });
      return run.id;
    });
  const close = (ctx: restate.ObjectContext, runId: string, stats: object) =>
    ctx.run("finish run", () => finishRun(scope(ctx).db, runId, stats));
  /**
   * A unit that exhausted its retries aborts the run with its reason instead of failing the
   * handler, and is held so the next run goes past it.
   */
  const unit = async <T>(
    ctx: restate.ObjectContext,
    name: string,
    fn: () => Promise<T>,
    at: { holds: StageHolds; id: unknown },
  ) => {
    try {
      const run = async () => {
        const value = await fn();
        await landed(at.holds, at.id);
        return value;
      };
      return { ok: true as const, value: await ctx.run(name, run, UNIT_RETRY) };
    } catch (err) {
      if (!(err instanceof restate.TerminalError)) throw err;
      await holdFailed(ctx, at.holds, at.id, err.message);
      return { ok: false as const, reason: err.message };
    }
  };

  return restate.object({
    name: "Enrichment",
    handlers: {
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
                  robotsMode,
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
        { input: CRAWL },
        async (ctx: restate.ObjectContext, input: RenderInput = {}): Promise<RenderStats> => {
          if (!withBrowser) throw new restate.TerminalError("no browser renderer configured");
          const { db, niche, fetch } = scope(ctx);
          const shard = parseShard(input.shard ?? keyShard(ctx));
          const runId = await open(ctx, "enrich render", { ...input, niche });
          const ids = await ctx.run("select", async () =>
            (await selectRenderTargets(db, { limit: input.limit ?? 10, niche, shard })).map(
              (c) => c.id,
            ),
          );
          let stats = emptyRenderStats();
          const robots: RobotsCache = new Map();
          const holds = await stageHolds(ctx, db, HELD.render);
          const units = unitBatches(
            ctx,
            "render company",
            notHeld(holds, ids),
            async (id) => {
              const company = await companyRef(db, id);
              return withBrowser((browser) =>
                atomic(db, (tx) =>
                  renderCompany(tx, browser.render, fetch(), company, robots, {
                    pagesPerSite: input.pagesPerSite ?? 5,
                    extraHints: hintsFor(niche, input),
                    robotsMode,
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
                return atomic(db, (tx) =>
                  extractDocument(tx, deps.llm, doc, { runId, tracer, spec }),
                );
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

      pick: exclusiveHandler(
        { input: PICK },
        async (ctx: restate.ObjectContext, input: EmailPickInput = {}): Promise<EmailPickStats> => {
          const { db, niche } = scope(ctx);
          const shard = parseShard(input.shard ?? keyShard(ctx));
          const llm = input.rules ? null : deps.llm;
          const runId = await open(
            ctx,
            "enrich pick",
            { ...input, niche, version: PICK_VERSION },
            llm?.name ?? RULES_PICKER,
          );
          const ids = await ctx.run("select", async () =>
            (await selectPickTargets(db, llm, { limit: input.limit, niche, shard })).map(
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
          const holds = await stageHolds(ctx, db, HELD.pick);
          const units = unitBatches(
            ctx,
            "pick company",
            notHeld(holds, ids),
            async (id) => {
              const [company] = await db.select().from(companies).where(eq(companies.id, id));
              if (!company) return null;
              return atomic(db, (tx) => pickCompany(tx, llm, company, { runId, tracer }));
            },
            // A model pick is bought once: one unit per step. Rules picks are free and batch.
            { retry: UNIT_RETRY, perRun: llm ? 1 : UNITS_PER_RUN, holds },
          );
          for await (const r of units) {
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
      ),

      opener: exclusiveHandler(
        { input: SHARDED },
        async (ctx: restate.ObjectContext, input: PickInput = {}): Promise<OpenerStats> => {
          const { db, niche } = scope(ctx);
          const shard = parseShard(input.shard ?? keyShard(ctx));
          const runId = await open(
            ctx,
            "enrich opener",
            { ...input, niche, version: OPENER_VERSION },
            deps.llm.name,
          );
          const ids = await ctx.run("select", () =>
            selectOpenerTargets(db, deps.llm, { limit: input.limit, niche, shard }),
          );
          const stats = emptyOpenerStats(ids.length);
          const holds = await stageHolds(ctx, db, HELD.opener);
          for (const id of notHeld(holds, ids)) {
            const r = await unit(
              ctx,
              `opener company ${id}`,
              () => atomic(db, (tx) => writeOpener(tx, deps.llm, id, { runId, tracer })),
              { holds, id },
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
      ),

      profiles: exclusiveHandler(
        { input: PROFILES },
        async (ctx: restate.ObjectContext, input: ProfilesInput): Promise<ProfileStats> => {
          // Exa is metered and its cache is main's: a client's people wait for compose (O2).
          if (clientOfKey(ctx.key.split("@")[0] as string))
            throw new restate.TerminalError("profiles run on Wren's niches only");
          if (!deps.sites) throw new restate.TerminalError("no site client for profiles");
          const { db, niche } = scope(ctx);
          const sites = keepingAnswers(deps.sites, db);
          const { personIds, ...rest } = input;
          const runId = await open(ctx, PROFILES_COMMAND, {
            ...rest,
            people: personIds.length,
            niche,
          });
          const now = new Date(await ctx.date.now());
          const plan = await ctx.run("select", async () => {
            const parked = await profilesParkedUntil(db);
            if (parked)
              return { parked: parked.toISOString(), work: [], google: 0, linkedin: null };
            const work = await profileWork(db, personIds, {
              limit: input.limit ?? 5,
              pages: deps.pages ?? null,
            });
            return {
              parked: null,
              work,
              google: await googleLeft(db, { now, timezone: input.timezone }),
              linkedin: (await linkedinParkedUntil(db))?.toISOString() ?? null,
            };
          });
          const stats = emptyProfileStats();
          stats.selected = plan.work.length;
          if (plan.parked) stats.stopped = `parked by a cap until ${plan.parked}`;
          let left = plan.google;
          let linkedinUntil = plan.linkedin;
          const streak = { errors: 0 };
          const holds = await stageHolds(ctx, db, HELD.profiles);
          for (const w of plan.work) {
            const id = w.person.personId;
            if (holds.held.has(String(id))) continue;
            // profileUnit returns site errors as data: a metered read is never retried.
            const r = await unit(
              ctx,
              `profile person ${id}`,
              () =>
                profileUnit(db, sites, w, {
                  googleLeft: left,
                  linkedin: deps.linkedin ?? null,
                  linkedinCappedUntil: linkedinUntil ? new Date(linkedinUntil) : null,
                  runId,
                }),
              { holds, id },
            );
            if (!r.ok) {
              stats.stopped = r.reason;
              break;
            }
            const recheck = deps.recheck;
            if (recheck)
              await ctx.run(`recheck firm ${w.company.companyId}`, async () => {
                await recheck(db, [w.company.companyId]);
              });
            left = r.value.googleStopped ? 0 : Math.max(0, left - r.value.google);
            linkedinUntil = r.value.linkedinCappedUntil ?? linkedinUntil;
            stats.stopped = countProfileUnit(stats, r.value, streak);
            if (stats.stopped) break;
          }
          await close(ctx, runId, stats);
          return stats;
        },
      ),

      team: exclusiveHandler(
        { input: TEAM },
        async (ctx: restate.ObjectContext, input: TeamInput): Promise<TeamStats> => {
          // Metered, and the people land on main: Wren's niches only (O2).
          if (clientOfKey(ctx.key.split("@")[0] as string))
            throw new restate.TerminalError("team search runs on Wren's niches only");
          if (!deps.sites) throw new restate.TerminalError("no site client for team search");
          const { db, niche } = scope(ctx);
          const sites = keepingAnswers(deps.sites, db);
          const { companyIds, ...rest } = input;
          const runId = await open(ctx, TEAM_COMMAND, {
            ...rest,
            firms: companyIds.length,
            niche,
          });
          const plan = await ctx.run("select", async () => {
            const parked = await teamParkedUntil(db);
            if (parked) return { why: `parked by a cap until ${parked.toISOString()}`, work: [] };
            const { room, nextInMs } = await teamRoom(db, new Date());
            if (room === 0)
              return {
                why: `bucket empty: next search in ${Math.ceil(nextInMs / 1000)}s`,
                work: [],
              };
            const limit = Math.min(input.limit ?? 10, room);
            return { why: null, work: await teamWork(db, companyIds, { limit }) };
          });
          const stats = emptyTeamStats();
          stats.selected = plan.work.length;
          stats.stopped = plan.why;
          const streak = { errors: 0 };
          const holds = await stageHolds(ctx, db, HELD.team);
          for (const w of plan.work) {
            const id = w.companyId;
            if (holds.held.has(String(id))) continue;
            // teamUnit returns site errors as data: a metered search is never retried.
            const r = await unit(ctx, `team firm ${id}`, () => teamUnit(db, sites, w, { runId }), {
              holds,
              id,
            });
            if (!r.ok) {
              stats.stopped = r.reason;
              break;
            }
            stats.stopped = countTeamUnit(stats, r.value, streak);
            if (stats.stopped) break;
          }
          await close(ctx, runId, stats);
          return stats;
        },
      ),

      signals: exclusiveHandler(
        { input: SIGNALS },
        async (ctx: restate.ObjectContext, input: SignalsInput): Promise<SignalsStats> => {
          // The findings land on main: Wren's niches only.
          if (clientOfKey(ctx.key.split("@")[0] as string))
            throw new restate.TerminalError("signals run on Wren's niches only");
          const { db, niche } = scope(ctx);
          const { personIds, companyIds, ...rest } = input;
          const runId = await open(ctx, SIGNALS_COMMAND, {
            ...rest,
            people: personIds.length,
            niche,
          });
          const now = new Date(await ctx.date.now());
          const plan = await ctx.run("select", async () =>
            signalPlan(
              db,
              COLLECTORS,
              await signalSettings(db),
              await passOf(db, niche, personIds, companyIds ?? []),
              { now, limit: input.limit ?? undefined, only: input.collector ?? null },
            ),
          );
          const base: BaseDeps = {
            db,
            sites: deps.sites ? keepingAnswers(deps.sites, db) : null,
            desk: deps.desk ? keepingAnswers(deps.desk, db) : null,
            fetcher: deps.fetcher,
            pages: deps.pages ?? null,
            youtube: deps.youtube ?? null,
            llm: deps.llm,
            linkedin: readAccount(deps.linkedin),
          };
          const stats = emptySignalsStats();
          // A unit's hold subject is `<collector>:<subject>`.
          const holds = await stageHolds(ctx, db, SIGNALS_HELD);
          for (const p of plan) {
            const line = planStats(stats, p);
            const c = COLLECTORS.find((x) => x.name === p.name);
            if (!c) continue;
            const ids = notHeld(
              holds,
              p.subjects.map((s) => `${c.name}:${s}`),
            );
            // Free reads batch; a metered one is its own step, never bought twice.
            for await (const r of unitBatches(
              ctx,
              `signals ${c.name}`,
              ids,
              (id) =>
                signalUnit(c, id.slice(c.name.length + 1), p.settings, base, {
                  timezone: input.timezone,
                  runId,
                }),
              { retry: UNIT_RETRY, holds, perRun: c.metered ? 1 : UNITS_PER_RUN },
            )) {
              if (countSignalUnit(stats, line, r.ok ? r.value : r)) break;
            }
          }
          await close(ctx, runId, stats);
          return stats;
        },
      ),

      youtube: exclusiveHandler(
        { input: LIMIT },
        async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<YouTubeStats> => {
          // The findings land on main: Wren's niches only.
          if (clientOfKey(ctx.key.split("@")[0] as string))
            throw new restate.TerminalError("YouTube reads run on Wren's niches only");
          const get = deps.youtube;
          if (!get)
            throw new restate.TerminalError("no YouTube reader (WREN_GOOGLE_SERVICE_ACCOUNT)");
          const { db, niche } = scope(ctx);
          if (niche === null) throw new restate.TerminalError("YouTube reads need a niche key");
          const limit = input?.limit ?? 20;
          const runId = await open(ctx, YOUTUBE_COMMAND, { limit, niche });
          const plan = await ctx.run("select", async () => {
            const { room, nextInMs } = await youtubeRoom(db, new Date());
            if (room < Math.min(limit, YOUTUBE_MIN_BATCH))
              return {
                why: `bucket low (${room} reads): next in ${Math.ceil(nextInMs / 1000)}s`,
                work: [],
              };
            return {
              why: null,
              work: await youtubeWork(db, { niche, limit: Math.min(limit, room) }),
            };
          });
          const stats = emptyYouTubeStats();
          stats.selected = plan.work.length;
          stats.stopped = plan.why;
          const byId = new Map(plan.work.map((w) => [w.companyId, w]));
          const streak = { errors: 0 };
          // Free reads, so they batch: a crash re-reads at most one batch. A unit that throws
          // the same way every time counts as an error after its retries, never blocks the pool.
          const holds = await stageHolds(ctx, db, HELD.youtube);
          for await (const r of unitBatches(
            ctx,
            "youtube",
            notHeld(holds, [...byId.keys()]),
            (id) => youtubeUnit(db, get, byId.get(id) as (typeof plan.work)[number]),
            { retry: UNIT_RETRY, holds },
          )) {
            const u = r.ok
              ? r.value
              : { companyId: r.id, outcome: "error" as const, uploads: 0, error: r.reason };
            stats.stopped = countYouTubeUnit(stats, u, streak);
            if (stats.stopped) break;
          }
          await close(ctx, runId, stats);
          return stats;
        },
      ),

      instagram: exclusiveHandler(
        { input: LIMIT },
        async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<InstagramStats> => {
          // The findings land on main: Wren's niches only.
          if (clientOfKey(ctx.key.split("@")[0] as string))
            throw new restate.TerminalError("Instagram reads run on Wren's niches only");
          const sites = deps.instagram;
          if (!sites) throw new restate.TerminalError("no sites client for Instagram");
          const { db, niche } = scope(ctx);
          if (niche === null) throw new restate.TerminalError("Instagram reads need a niche key");
          const limit = input?.limit ?? 30;
          const runId = await open(ctx, INSTAGRAM_COMMAND, { limit, niche });
          const plan = await ctx.run("select", async () => {
            const { room, nextInMs } = await instagramRoom(db, new Date());
            if (room < Math.min(limit, INSTAGRAM_MIN_BATCH))
              return {
                why: `bucket low (${room} reads): next in ${Math.ceil(nextInMs / 1000)}s`,
                work: [],
              };
            return {
              why: null,
              work: await instagramWork(db, { niche, limit: Math.min(limit, room) }),
            };
          });
          const stats = emptyInstagramStats();
          stats.selected = plan.work.length;
          stats.stopped = plan.why;
          const byId = new Map(plan.work.map((w) => [w.companyId, w]));
          const streak = { errors: 0 };
          // A read is spent whether it worked or not, so a unit never throws (it answers an error
          // as data); a crash re-reads at most one batch.
          const holds = await stageHolds(ctx, db, HELD.instagram);
          for await (const r of unitBatches(
            ctx,
            "instagram",
            notHeld(holds, [...byId.keys()]),
            (id) => instagramUnit(db, sites, byId.get(id) as (typeof plan.work)[number]),
            { retry: UNIT_RETRY, holds },
          )) {
            const u = r.ok
              ? r.value
              : { companyId: r.id, outcome: "error" as const, posts: 0, error: r.reason };
            stats.stopped = countInstagramUnit(stats, u, streak);
            if (stats.stopped) break;
          }
          await close(ctx, runId, stats);
          return stats;
        },
      ),

      adLibrary: exclusiveHandler(
        { input: LIMIT },
        async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<AdLibraryStats> => {
          // The firms land on main: Wren's niches only.
          if (clientOfKey(ctx.key.split("@")[0] as string))
            throw new restate.TerminalError("Ad Library reads run on Wren's niches only");
          const desk = deps.desk;
          if (!desk) throw new restate.TerminalError("no desk client for fb-public");
          const { db, niche } = scope(ctx);
          if (niche === null) throw new restate.TerminalError("Ad Library reads need a niche key");
          const ads = deps.adsFor?.(niche) ?? null;
          const limit = input?.limit ?? 3;
          const runId = await open(ctx, AD_LIBRARY_COMMAND, { limit, niche });
          const plan = await ctx.run("select", async () => {
            const now = new Date();
            const { room, nextInMs } = await adLibraryRoom(db, now);
            if (room === 0)
              return { why: `bucket empty: next read in ${Math.ceil(nextInMs / 1000)}s`, work: [] };
            const keywords = ads?.keywords ?? [];
            return {
              why: null,
              work: await adKeywordsDue(db, keywords, { now, limit: Math.min(limit, room) }),
            };
          });
          const stats = emptyAdLibraryStats();
          stats.selected = plan.work.length;
          stats.stopped = plan.why;
          const holds = await stageHolds(ctx, db, HELD.ads);
          for (const q of notHeld(holds, plan.work)) {
            const r = await unit(
              ctx,
              `ads ${q}`,
              () => adLibraryUnit(db, desk, { q, niche, platforms: ads?.platforms ?? [] }),
              { holds, id: q },
            );
            if (!r.ok) {
              stats.stopped = r.reason;
              break;
            }
            stats.stopped = countAdLibraryUnit(stats, r.value);
            if (stats.stopped) break;
          }
          // New firms get the niche's screen (chains, foreign, its own rule) before any stage reads them.
          const screen = ads?.screen;
          if (stats.created > 0 && screen)
            await ctx.run("screen", async () => {
              await runScreen(db, niche, screen);
            });
          await close(ctx, runId, stats);
          return stats;
        },
      ),

      exaSearch: exclusiveHandler(
        { input: LIMIT },
        async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<ExaSearchStats> => {
          // The firms land on main: Wren's niches only.
          if (clientOfKey(ctx.key.split("@")[0] as string))
            throw new restate.TerminalError("Exa searches run on Wren's niches only");
          const sites = deps.exaSites;
          if (!sites) throw new restate.TerminalError("no sites client for Exa search");
          const { db, niche } = scope(ctx);
          if (niche === null) throw new restate.TerminalError("Exa searches need a niche key");
          const exa = deps.exaFor?.(niche) ?? null;
          const limit = input?.limit ?? 3;
          const runId = await open(ctx, EXA_SEARCH_COMMAND, { limit, niche });
          const plan = await ctx.run("select", async () => {
            const now = new Date();
            const { room, nextInMs } = await exaSearchRoom(db, now);
            if (room === 0)
              return {
                why: `bucket empty: next search in ${Math.ceil(nextInMs / 1000)}s`,
                work: [],
              };
            const searches = exaSearches(exa?.queries ?? [], exa?.cities ?? []);
            return {
              why: null,
              work: await exaSearchesDue(db, searches, { now, limit: Math.min(limit, room) }),
            };
          });
          const stats = emptyExaSearchStats();
          stats.selected = plan.work.length;
          stats.stopped = plan.why;
          const holds = await stageHolds(ctx, db, HELD.exa);
          for (const q of notHeld(holds, plan.work)) {
            const r = await unit(
              ctx,
              `exa ${q}`,
              () => exaSearchUnit(db, sites, { q, niche, platforms: exa?.platforms ?? [] }),
              { holds, id: q },
            );
            if (!r.ok) {
              stats.stopped = r.reason;
              break;
            }
            stats.stopped = countExaSearchUnit(stats, r.value);
            if (stats.stopped) break;
          }
          // New firms get the niche's screen (chains, foreign, its own rule) before any stage reads them.
          const screen = exa?.screen;
          if (stats.created > 0 && screen)
            await ctx.run("screen", async () => {
              await runScreen(db, niche, screen);
            });
          await close(ctx, runId, stats);
          return stats;
        },
      ),
      youtubeSearch: exclusiveHandler(
        { input: LIMIT },
        async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<YouTubeSearchStats> => {
          // The firms land on main: Wren's niches only.
          if (clientOfKey(ctx.key.split("@")[0] as string))
            throw new restate.TerminalError("YouTube searches run on Wren's niches only");
          const get = deps.youtube;
          if (!get) throw new restate.TerminalError("no YouTube reader for channel search");
          const { db, niche } = scope(ctx);
          if (niche === null) throw new restate.TerminalError("YouTube searches need a niche key");
          const yt = deps.youtubeSearchFor?.(niche) ?? null;
          const limit = input?.limit ?? 2;
          const runId = await open(ctx, YOUTUBE_SEARCH_COMMAND, { limit, niche });
          const plan = await ctx.run("select", async () => {
            const now = new Date();
            const { room, nextInMs } = await youtubeSearchRoom(db, now);
            if (room === 0)
              return {
                why: `bucket empty: next search in ${Math.ceil(nextInMs / 1000)}s`,
                work: [],
              };
            return {
              why: null,
              work: await youtubeSearchesDue(db, yt?.queries ?? [], {
                now,
                limit: Math.min(limit, room),
              }),
            };
          });
          const stats = emptyYouTubeSearchStats();
          stats.selected = plan.work.length;
          stats.stopped = plan.why;
          const holds = await stageHolds(ctx, db, HELD.youtubeSearch);
          for (const q of notHeld(holds, plan.work)) {
            const r = await unit(
              ctx,
              `youtube search ${q}`,
              () => youtubeSearchUnit(db, get, { q, niche, platforms: yt?.platforms ?? [] }),
              { holds, id: q },
            );
            if (!r.ok) {
              stats.stopped = r.reason;
              break;
            }
            stats.stopped = countYouTubeSearchUnit(stats, r.value);
            if (stats.stopped) break;
          }
          // New firms get the niche's screen (chains, foreign, its own rule) before any stage reads them.
          const screen = yt?.screen;
          if (stats.created > 0 && screen)
            await ctx.run("screen", async () => {
              await runScreen(db, niche, screen);
            });
          await close(ctx, runId, stats);
          return stats;
        },
      ),
      fbGroups: exclusiveHandler(
        { input: LIMIT },
        async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<FbGroupsStats> => {
          // The posts become findings on main: Wren's niches only.
          if (clientOfKey(ctx.key.split("@")[0] as string))
            throw new restate.TerminalError("Facebook group reads run on Wren's niches only");
          const desk = deps.desk;
          if (!desk) throw new restate.TerminalError("no desk client for fb-public");
          const { db, niche } = scope(ctx);
          if (niche === null)
            throw new restate.TerminalError("Facebook group reads need a niche key");
          const keywords = deps.groupsFor?.(niche)?.keywords ?? [];
          const limit = input?.limit ?? 10;
          const runId = await open(ctx, FB_GROUPS_COMMAND, { limit, niche });
          const stats = emptyFbGroupsStats();
          // Searches first, so their groups and posts are in the queue the reads draw on.
          const searches = await ctx.run("select searches", async () => {
            const now = new Date();
            const { room } = await groupSearchRoom(db, now);
            return groupKeywordsDue(db, niche, keywords, { now, limit: Math.min(limit, room) });
          });
          stats.selected = searches.length;
          const holds = await stageHolds(ctx, db, HELD.groups);
          for (const q of searches.filter((x) => !holds.held.has(`search ${x}`))) {
            const r = await unit(
              ctx,
              `group search ${q}`,
              () => groupSearchUnit(db, desk, { q, niche }),
              { holds, id: `search ${q}` },
            );
            if (!r.ok) {
              stats.stopped = r.reason;
              break;
            }
            stats.stopped = countFbGroupsUnit(stats, r.value);
            if (stats.stopped) break;
          }
          if (!stats.stopped) {
            const plan = await ctx.run("select reads", async () => {
              const now = new Date();
              const { room, nextInMs } = await groupReadRoom(db, now);
              const budget = Math.min(limit - stats.selected, room);
              return {
                why:
                  room === 0 && stats.selected === 0
                    ? `read bucket empty: next read in ${Math.ceil(nextInMs / 1000)}s`
                    : null,
                work: await groupReadsDue(db, niche, { now, limit: budget }),
              };
            });
            stats.stopped = plan.why;
            stats.selected += plan.work.length;
            for (const w of plan.work) {
              const id = w.kind === "about" ? `about ${w.group}` : `post ${w.post}`;
              if (holds.held.has(id)) continue;
              const r = await unit(
                ctx,
                `group ${id}`,
                () =>
                  w.kind === "about" ? groupAboutUnit(db, desk, w) : groupPostUnit(db, desk, w),
                { holds, id },
              );
              if (!r.ok) {
                stats.stopped = r.reason;
                break;
              }
              stats.stopped = countFbGroupsUnit(stats, r.value);
              if (stats.stopped) break;
            }
          }
          // Posts read before a firm was known, or new firms: map again, whatever stopped the reads.
          const map = await ctx.run("map posts", () => mapPosts(db, niche, new Date()));
          stats.mapped = map.mapped;
          await close(ctx, runId, stats);
          return stats;
        },
      ),

      applyPicks: exclusiveHandler(
        { input: LIMIT },
        async (ctx: restate.ObjectContext, input: LimitInput = {}) => {
          const { db } = scope(ctx);
          const runId = await open(ctx, "enrich apply-picks", { ...input });
          const stats = await ctx.run("apply", () => atomic(db, (tx) => applyPicks(tx, input)));
          await close(ctx, runId, stats);
          return stats;
        },
      ),

      tagTestimonials: exclusiveHandler(
        { input: TAG },
        async (ctx: restate.ObjectContext, input: TagInput = {}) => {
          const { db, niche } = scope(ctx);
          if (niche === null) throw new restate.TerminalError("tagTestimonials needs a niche key");
          const runId = await open(ctx, "enrich tag-testimonials", { ...input, niche });
          const stats = await ctx.run("tag", () =>
            atomic(db, (tx) =>
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
      ),

      backfillCallRecords: exclusiveHandler(
        { input: LIMIT },
        async (ctx: restate.ObjectContext, input: LimitInput = {}) => {
          const { db } = scope(ctx);
          const runId = await open(ctx, "audit backfill", { ...input });
          const stats = await ctx.run("backfill", () =>
            atomic(db, (tx) => backfillCallRecords(tx, input)),
          );
          await close(ctx, runId, stats);
          return stats;
        },
      ),
    },
  });
}

export type Enrichment = ReturnType<typeof makeEnrichment>;
