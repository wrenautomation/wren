/** The enrichment object's context, built once: the scope a unit runs in, the run journal, the browser pool and the model and key lookups every group shares. */
import * as restate from "@restatedev/restate-sdk";
import { type Company, type CompanyScreen, companies, finishRun, openRun } from "@wren/core";
import { findClient } from "@wren/core/clients";
import type { SiteClient } from "@wren/core/content";
import type { KeyStore } from "@wren/core/keys";
import { clientOfKey } from "@wren/core/restate";
import { vendorKeys } from "@wren/core/vendor-keys";
import type { Db, Queryable } from "@wren/db";
import { type LlmClient, NULL_TRACER, type Tracer } from "@wren/llm";
import type { Fetcher } from "@wrenautomation/read/fetch";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_EXTRACTION_SPEC, type ExtractionSpec } from "../enrichment/extraction.js";
import type { BrowserRenderer } from "../enrichment/render.js";
import { Shard } from "../enrichment/shard.js";
import { sharedPages } from "../enrichment/shared-pages.js";
import { clientYouTube, type YouTubeGet, youtubeKeyApi } from "../enrichment/youtube.js";
import { tierMemory } from "../fetch/tier-memory.js";
import type { PageStore } from "../pages.js";
import { holdFailed, isStopReason, landed, type StageHolds, stopsAtOnce } from "./units.js";

export interface EnrichmentDeps {
  db: Db;
  /** A client's database, for `<client>/...` keys; absent, those keys refuse. */
  clientDb?: ((client: string) => Db) | null;
  /** null when WREN_FETCH_CONTACT is unset: crawl and render then refuse instead of the worker refusing to start. */
  fetcher: Fetcher | null;
  llm: LlmClient;
  /**
   * A client's model for one stage: its own models key, or Wren's gateway gated and metered on
   * its share (`meteredModel`). Unset: client keys run on `llm`, unmetered.
   */
  clientLlm?: ((client: string, part: string, runId: string | null) => LlmClient) | null;
  /** Lazily launched per render run and closed after it (Playwright). */
  renderer?: (() => Promise<BrowserRenderer>) | null;
  tracer?: Tracer;
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
  /** Clients' own keys: a client's YouTube reads run on its own key when it saved one. */
  keys?: KeyStore | null;
  /** autobrowse's `meta` site, for the `instagram` reads; null = `instagram` refuses. */
  instagram?: SiteClient | null;
  /**
   * autobrowse's `web GET /fetch`, the fetch ladder: the render pass sends the companies the crawl
   * could not fetch (403, 429, 503, or a domain the memory marks) up impersonate, render and exit
   * on the Mac. null = those companies wait.
   */
  ladder?: SiteClient | null;
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
  /** A niche's trigger words ("staffing agency") and its screen: the `triggers` stage's news searches. */
  triggersFor?: (niche: string) => {
    words: readonly string[];
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

export const keyShard = (ctx: restate.ObjectContext): string | undefined => ctx.key.split("@")[1];

/**
 * The client a key names, with its `component` block, or null for Wren's keys. Refuses when the
 * client is gone, is the demo, or doesn't have the part installed.
 */
export async function clientBlock(
  main: Queryable,
  key: string,
  component: string,
): Promise<{ client: string; block: unknown; accounts: Record<string, string> } | null> {
  const owner = clientOfKey(key.split("@")[0] as string);
  if (!owner) return null;
  const client = await findClient(main, owner.client);
  if (!client || client.demo) throw new restate.TerminalError(`no such client: ${owner.client}`);
  const block = (client.products as Record<string, unknown> | null)?.[component];
  if (block === undefined) throw new restate.TerminalError(`${component} is not installed`);
  return { client: owner.client, block, accounts: client.accounts };
}

export interface CrawlInput {
  limit?: number;
  /** "i/n" */
  shard?: string;
  pagesPerSite?: number;
  extraHints?: string[];
}

export interface LimitInput {
  limit?: number;
}

export const LIMIT_FIELD = z.number().nullish().describe("Units this pass");

export const SHARD = z.string().nullish().describe('"i/n": this worker\'s slice');

export const LIMIT = z.looseObject({ limit: LIMIT_FIELD }).nullish();

export const parseShard = (text: string | undefined): Shard | null => {
  if (text === undefined) return null;
  try {
    return Shard.parse(text);
  } catch (err) {
    throw new restate.TerminalError(err instanceof Error ? err.message : String(err));
  }
};

/** Bounded retries per unit; when exhausted the run records the abort and stops. */
export const UNIT_RETRY = { maxRetryAttempts: 3 } as const;

/**
 * Each loop's stage in `unit_holds`: a unit out of retries is held there 7 days, then tried once
 * more, so one bad row never stops a stage (designs/2026-10-05-checks.md).
 */
export const HELD = {
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
  triggers: "research.triggers",
  youtubeSearch: "research.youtube-search",
  groups: "research.fb-groups",
} as const;

export function enrichmentContext(deps: EnrichmentDeps) {
  /**
   * A client's YouTube for one invocation: its own key or Wren's service account, gated and
   * metered on its share (designs/2026-10-07-vendor-keys.md). No mode: Wren's, metered.
   */
  const youtubeFor = (client: string, wren: YouTubeGet, part: string, runId: string | null) =>
    clientYouTube({
      client,
      keys: vendorKeys({ main: deps.db, keys: deps.keys ?? null, unset: "managed" }),
      wren,
      own: (key) => youtubeKeyApi(key),
      part,
      runId,
    });
  /** The model a stage runs on: a client key's own (metered), else Wren's. */
  const llmOf = (ctx: restate.ObjectContext, part: string, runId: string | null): LlmClient => {
    const owner = clientOfKey(ctx.key.split("@")[0] as string);
    return owner && deps.clientLlm ? deps.clientLlm(owner.client, part, runId) : deps.llm;
  };
  const tracer = deps.tracer ?? NULL_TRACER;
  const spec = deps.extractionSpec ?? DEFAULT_EXTRACTION_SPEC;
  // The fetch ladder's memory is main's: a domain is the same fact for every client.
  const memory = tierMemory(deps.db);
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
        const value = await stopsAtOnce(fn);
        await landed(at.holds, at.id);
        return value;
      };
      return { ok: true as const, value: await ctx.run(name, run, UNIT_RETRY) };
    } catch (err) {
      if (!(err instanceof restate.TerminalError)) throw err;
      if (!isStopReason(err.message)) await holdFailed(ctx, at.holds, at.id, err.message);
      return { ok: false as const, reason: err.message };
    }
  };
  return {
    deps,
    youtubeFor,
    llmOf,
    tracer,
    spec,
    memory,
    withBrowser,
    fetcher,
    hintsFor,
    scope,
    companyRef,
    open,
    close,
    unit,
  };
}

export type EnrichmentContext = ReturnType<typeof enrichmentContext>;
