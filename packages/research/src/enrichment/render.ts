/**
 * Tier-2 rendered fetch: Playwright chromium for JS-shell sites. Runs ONLY for
 * companies whose tier-1 crawl stored shells. Same posture as tier 1: the declared
 * User-Agent, robots.txt re-checked per URL, sequential with jitter, no stealth
 * patches. Rendering is capability, not evasion.
 *
 * Playwright loads lazily; everything else is plain orchestration testable with a
 * fake renderer. Browser-tier rows are appended next to the shell rows; a site whose
 * render still comes back empty gets an empty browser-tier tombstone so the pass
 * never retries it forever (delete the tombstone to retry).
 *
 * The pass also takes blocked companies (the crawl met 403, 429 or 503, or the domain's
 * memory sent it here): one `web GET /fetch` each through the fetch ladder, capped per run
 * (designs/2026-10-18-fetch-ladder.md). What it learns goes to the domain's memory.
 */
import { createHash } from "node:crypto";
import { type Company, companies, inPlay } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import { atomic, type Queryable } from "@wren/db";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Fetcher } from "../fetch/fetcher.js";
import { looksLikeJsShell, readPage } from "../fetch/htmltext.js";
import { type FetchStep, fetchLadder } from "../fetch/ladder.js";
import type { RobotsCache } from "../fetch/robots.js";
import { domainOf, isLadderTier, LADDER_TIERS, type TierMemory } from "../fetch/tier-memory.js";
import { documents } from "../schema.js";
import { EMPTY_HASH, robotsDisallows, stripNul } from "./crawler.js";
import type { Shard } from "./shard.js";
import { PEOPLE_PAGE_HINTS, peoplePageCandidates } from "./urls.js";

const BROWSER_TIER = "browser";
/** A document at one of these is rendered: the company is done with the pass. */
const RENDERED_TIERS = [BROWSER_TIER, ...LADDER_TIERS];
/** A tombstone the crawl left for the ladder: it met a block (`status-403`), or the memory sent it. */
const blockedDoc = or(
  like(documents.blockReason, "status-%"),
  eq(documents.blockReason, "remembered"),
);
/** `ladderLimit` default: `web GET /fetch` calls per render run. */
export const DEFAULT_LADDER_LIMIT = 40;
const SETTLE_MS = 1200;
const PAGE_TIMEOUT_MS = 20_000;
const DEFAULT_JITTER: readonly [number, number] = [1.0, 3.0];

export interface RenderedPage {
  html: string;
  finalUrl: string;
  statusCode: number | null;
}

/** Takes a URL and returns the rendered page, or throws. */
export type Renderer = (url: string) => Promise<RenderedPage>;

export class RenderUnavailable extends Error {
  override name = "RenderUnavailable";
}

export interface BrowserRenderer {
  render: Renderer;
  close(): Promise<void>;
}

/**
 * A real chromium-backed Renderer; images/media/fonts blocked (the words are the
 * payload). Fresh context per URL so cookies/storage never carry between companies.
 */
export async function browserRenderer(userAgent: string): Promise<BrowserRenderer> {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch (err) {
    throw new RenderUnavailable(
      "the render tier needs Playwright: `pnpm install && pnpm exec playwright install chromium`",
      { cause: err },
    );
  }
  let browser: Awaited<ReturnType<typeof playwright.chromium.launch>>;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new RenderUnavailable(
      `chromium failed to launch (${reason}); run \`pnpm exec playwright install chromium\``,
      { cause: err },
    );
  }
  const render: Renderer = async (url) => {
    const context = await browser.newContext({ userAgent });
    try {
      await context.route("**/*", (route) =>
        ["image", "media", "font"].includes(route.request().resourceType())
          ? route.abort()
          : route.continue(),
      );
      const page = await context.newPage();
      let statusCode: number | null = null;
      try {
        const resp = await page.goto(url, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
        statusCode = resp?.status() ?? null;
        await page.waitForTimeout(SETTLE_MS);
      } catch (err) {
        if (!(err instanceof playwright.errors.TimeoutError)) throw err;
        // slow site: take whatever has rendered so far
      }
      return { html: await page.content(), finalUrl: page.url(), statusCode };
    } finally {
      await context.close();
    }
  };
  return { render, close: () => browser.close() };
}

export interface RenderStats {
  companies_rendered: number;
  pages_stored: number;
  still_shell: number;
  render_errors: number;
  robots_warned: number;
  homepage_unrendered: number;
  niche_null_skipped: number;
  /** `web GET /fetch` calls: each takes one from `ladderLimit`. */
  ladder_requests: number;
  /** Pages the ladder got and the pass stored. */
  ladder_pages: number;
  /** Companies the ladder got nothing for; their domain is now `dead`. */
  ladder_dead: number;
  robots_disallowed_urls: string[];
}

export function emptyRenderStats(): RenderStats {
  return {
    companies_rendered: 0,
    pages_stored: 0,
    still_shell: 0,
    render_errors: 0,
    robots_warned: 0,
    homepage_unrendered: 0,
    niche_null_skipped: 0,
    ladder_requests: 0,
    ladder_pages: 0,
    ladder_dead: 0,
    robots_disallowed_urls: [],
  };
}

export function addRenderStats(total: RenderStats, unit: RenderStats): RenderStats {
  return {
    companies_rendered: total.companies_rendered + unit.companies_rendered,
    pages_stored: total.pages_stored + unit.pages_stored,
    still_shell: total.still_shell + unit.still_shell,
    render_errors: total.render_errors + unit.render_errors,
    robots_warned: total.robots_warned + unit.robots_warned,
    homepage_unrendered: total.homepage_unrendered + unit.homepage_unrendered,
    niche_null_skipped: total.niche_null_skipped + unit.niche_null_skipped,
    ladder_requests: total.ladder_requests + unit.ladder_requests,
    ladder_pages: total.ladder_pages + unit.ladder_pages,
    ladder_dead: total.ladder_dead + unit.ladder_dead,
    robots_disallowed_urls: [...total.robots_disallowed_urls, ...unit.robots_disallowed_urls],
  };
}

type Seen = Set<string>;
const seenKey = (url: string, hash: string) => `${url} ${hash}`;

/** Where a stored page came from: the box browser (default) or the fetch ladder. */
interface Provenance {
  tier: string;
  blockReason: string | null;
  fetchSteps: FetchStep[] | null;
}
const BOX: Provenance = { tier: BROWSER_TIER, blockReason: null, fetchSteps: null };

async function storeRendered(
  db: Queryable,
  companyId: number,
  url: string,
  rendered: RenderedPage,
  seen: Seen,
  stats: RenderStats,
  robotsDisallowed: boolean,
  from: Provenance = BOX,
): Promise<boolean> {
  const contentHash = createHash("sha256").update(rendered.html).digest("hex");
  if (seen.has(seenKey(url, contentHash))) return false; // identical bytes already stored under this URL
  seen.add(seenKey(url, contentHash));
  const html = stripNul(rendered.html);
  const page = readPage(html, rendered.finalUrl);
  const shell = looksLikeJsShell(html, page.text);
  if (shell) stats.still_shell += 1;
  await db.insert(documents).values({
    companyId,
    url,
    finalUrl: rendered.finalUrl !== url ? rendered.finalUrl : null,
    kind: "webpage",
    statusCode: rendered.statusCode,
    contentHash,
    title: page.title || null,
    text: page.text,
    html,
    fetchTier: from.tier,
    isShell: shell,
    robotsDisallowed,
    blockReason: from.blockReason,
    fetchSteps: from.fetchSteps,
  });
  return true;
}

/** An empty browser-tier row: marks the company render-done; delete the row to retry. */
async function tombstone(db: Queryable, companyId: number, url: string, seen: Seen): Promise<void> {
  if (seen.has(seenKey(url, EMPTY_HASH))) return;
  seen.add(seenKey(url, EMPTY_HASH));
  await db.insert(documents).values({
    companyId,
    url,
    kind: "webpage",
    statusCode: null,
    contentHash: EMPTY_HASH,
    title: null,
    text: "",
    html: null,
    fetchTier: BROWSER_TIER,
    isShell: true,
  });
}

interface RenderCompanyOptions {
  pagesPerSite?: number;
  extraHints?: Iterable<string>;
  /** Seconds of uniform pause before each render. */
  jitter?: readonly [number, number];
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** The fetch ladder's memory (main's): a render that gave a page learns `browser`, else `dead`. */
  memory?: TierMemory;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Render one shelled company: homepage (the shell's final URL) plus its people pages. */
export async function renderCompany(
  db: Queryable,
  renderer: Renderer,
  robotsFetcher: Fetcher,
  company: Pick<Company, "id" | "domain">,
  robots: RobotsCache,
  opts: RenderCompanyOptions = {},
): Promise<RenderStats> {
  const stats = emptyRenderStats();
  const pagesPerSite = opts.pagesPerSite ?? 5;
  const hints = [...PEOPLE_PAGE_HINTS, ...(opts.extraHints ?? [])];
  const jitter = opts.jitter ?? DEFAULT_JITTER;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const pause = () => sleep((jitter[0] + (jitter[1] - jitter[0]) * random()) * 1000);
  const domainKey = company.domain ? domainOf(`https://${company.domain}`) : null;
  const learn = async (tier: "browser" | "dead") => {
    if (domainKey) await opts.memory?.learn(domainKey, tier, "shell");
  };

  // The URL the shell arrived at is the proven entry point.
  const [shellDoc] = await db
    .select({ url: documents.url, finalUrl: documents.finalUrl })
    .from(documents)
    .where(and(eq(documents.companyId, company.id), eq(documents.isShell, true)))
    .orderBy(asc(documents.id))
    .limit(1);
  if (!shellDoc) return stats;
  const homepageUrl = shellDoc.finalUrl ?? shellDoc.url;

  const seen: Seen = new Set();
  const existing = await db
    .select({ url: documents.url, hash: documents.contentHash })
    .from(documents)
    .where(eq(documents.companyId, company.id));
  for (const row of existing) seen.add(seenKey(row.url, row.hash));

  const homeDisallowed = await robotsDisallows(robotsFetcher, homepageUrl, robots, stats);
  await pause();
  let homepage: RenderedPage;
  try {
    homepage = await renderer(homepageUrl);
  } catch {
    stats.render_errors += 1;
    stats.homepage_unrendered += 1;
    await tombstone(db, company.id, homepageUrl, seen);
    await learn("dead");
    return stats;
  }

  let stored = 0;
  if (await storeRendered(db, company.id, homepageUrl, homepage, seen, stats, homeDisallowed))
    stored += 1;

  const domain = company.domain ?? "";
  const candidates = domain
    ? peoplePageCandidates(
        readPage(stripNul(homepage.html), homepage.finalUrl).links,
        domain,
        hints,
      )
    : [];
  for (const url of candidates.slice(0, Math.max(0, pagesPerSite - 1))) {
    const disallowed = await robotsDisallows(robotsFetcher, url, robots, stats);
    await pause();
    let page: RenderedPage;
    try {
      page = await renderer(url);
    } catch {
      stats.render_errors += 1;
      continue;
    }
    if (await storeRendered(db, company.id, url, page, seen, stats, disallowed)) stored += 1;
  }
  // Every rendered page collided with already-stored content: without a browser-tier
  // row the render-once query re-selects this company forever.
  if (stored === 0) await tombstone(db, company.id, homepageUrl, seen);
  stats.pages_stored += stored;
  stats.companies_rendered += 1;
  // A page that is still a shell is no use: the domain has nothing a browser can read.
  await learn(stored - stats.still_shell > 0 ? "browser" : "dead");
  return stats;
}

/** What a blocked company's pass needs from the ladder side: autobrowse, and this run's budget. */
interface LadderRun {
  sites: SiteClient;
  /** `web GET /fetch` calls left this run. Every unit of the run shares one object. */
  budget: { left: number };
}

/**
 * Fetch one blocked company through the fetch ladder: its homepage once, from the remembered
 * rung (else `impersonate`), then its people pages at the rung that answered. A page learns
 * its rung. No page: the domain is `dead` and the tombstone moves to the last rung tried, so
 * the pass never selects the company again. A spent cap, or a failed call, leaves it for the
 * next run.
 */
export async function climbCompany(
  db: Queryable,
  ladder: LadderRun,
  robotsFetcher: Fetcher,
  company: Pick<Company, "id" | "domain">,
  robots: RobotsCache,
  opts: RenderCompanyOptions = {},
): Promise<RenderStats> {
  const stats = emptyRenderStats();
  if (ladder.budget.left <= 0 || !company.domain) return stats;
  const hints = [...PEOPLE_PAGE_HINTS, ...(opts.extraHints ?? [])];
  const domain = domainOf(`https://${company.domain}`);

  // The crawl's tombstone: the homepage URL, and the block that sent the company here.
  const [marker] = await db
    .select({ id: documents.id, url: documents.url, block: documents.blockReason })
    .from(documents)
    .where(and(eq(documents.companyId, company.id), blockedDoc))
    .orderBy(asc(documents.id))
    .limit(1);
  if (!marker) return stats;
  const sentBy = marker.block;

  const seen: Seen = new Set();
  const existing = await db
    .select({ url: documents.url, hash: documents.contentHash })
    .from(documents)
    .where(eq(documents.companyId, company.id));
  for (const row of existing) seen.add(seenKey(row.url, row.hash));

  const remembered = domain ? await opts.memory?.get(domain) : null;
  const from = isLadderTier(remembered) ? remembered : "impersonate";
  // The marker stands for the company: it leaves the pass's queue when it moves to a rendered tier.
  const settle = (tier: string, blockReason: string | null, fetchSteps: FetchStep[] | null) =>
    db
      .update(documents)
      .set({ fetchTier: tier, blockReason, fetchSteps })
      .where(eq(documents.id, marker.id));

  const homeDisallowed = await robotsDisallows(robotsFetcher, marker.url, robots, stats);

  const call = async (url: string, tier: typeof from) => {
    ladder.budget.left -= 1;
    stats.ladder_requests += 1;
    const got = await fetchLadder(ladder.sites, url, tier);
    if ("failed" in got) {
      if (got.failed === "cap") ladder.budget.left = 0;
      stats.render_errors += 1;
    }
    return got;
  };

  const first = await call(marker.url, from);
  if ("failed" in first) return stats;
  const top = first.fetched;
  if (top.block) {
    stats.ladder_dead += 1;
    await settle(top.tier, top.block, top.tries);
    if (domain) await opts.memory?.learn(domain, "dead", sentBy);
    return stats;
  }

  const trailOf = (f: typeof top): Provenance => ({
    tier: f.tier,
    blockReason: sentBy,
    fetchSteps: f.tries,
  });
  const pageOf = (f: typeof top): RenderedPage => ({
    html: f.html,
    finalUrl: f.finalUrl,
    statusCode: f.status,
  });
  let stored = 0;
  if (
    await storeRendered(
      db,
      company.id,
      marker.url,
      pageOf(top),
      seen,
      stats,
      homeDisallowed,
      trailOf(top),
    )
  ) {
    stored += 1;
    stats.ladder_pages += 1;
  }
  if (domain) await opts.memory?.learn(domain, top.tier, sentBy);

  const candidates = peoplePageCandidates(
    readPage(stripNul(top.html), top.finalUrl).links,
    company.domain,
    hints,
  );
  for (const url of candidates.slice(0, Math.max(0, (opts.pagesPerSite ?? 5) - 1))) {
    if (ladder.budget.left <= 0) break;
    const disallowed = await robotsDisallows(robotsFetcher, url, robots, stats);
    const got = await call(url, top.tier);
    if ("failed" in got) break;
    if (got.fetched.block) continue;
    if (
      await storeRendered(
        db,
        company.id,
        url,
        pageOf(got.fetched),
        seen,
        stats,
        disallowed,
        trailOf(got.fetched),
      )
    ) {
      stored += 1;
      stats.ladder_pages += 1;
    }
  }
  // The page was already stored: the marker must still leave the queue.
  if (stored === 0) await settle(top.tier, sentBy, top.tries);
  stats.pages_stored += stored;
  stats.companies_rendered += 1;
  return stats;
}

interface RenderSelectOptions {
  limit?: number | undefined;
  niche?: string | null | undefined;
  shard?: Shard | null | undefined;
  /** Take shells, for the box renderer. Default true. */
  shells?: boolean | undefined;
  /** Take blocked companies, for the ladder. Default false. */
  blocked?: boolean | undefined;
  /** Domains the memory calls `dead`: their blocked companies are not taken. */
  deadDomains?: readonly string[] | undefined;
}

interface RenderTargets {
  shells: Company[];
  blocked: Company[];
}

const shelled = (db: Queryable) =>
  db
    .select({ id: documents.companyId })
    .from(documents)
    .where(and(eq(documents.isShell, true), isNotNull(documents.companyId)));
const renderedAlready = (db: Queryable) =>
  db
    .select({ id: documents.companyId })
    .from(documents)
    .where(and(inArray(documents.fetchTier, RENDERED_TIERS), isNotNull(documents.companyId)));
const blockedAlready = (db: Queryable) =>
  db
    .select({ id: documents.companyId })
    .from(documents)
    .where(and(blockedDoc, isNotNull(documents.companyId)));

/** The company's domain as the memory keeps it: lowercase, no leading `www.`. */
const companyDomain = sql<string>`regexp_replace(lower(${companies.domain}), '^www\\.', '')`;

/**
 * Shells: companies with at least one shell document and no rendered document. Blocked:
 * companies with a blocked tombstone, no rendered document and a domain that is not `dead`.
 * Shells come first; `limit` counts both.
 */
export async function selectRenderTargets(
  db: Queryable,
  opts: RenderSelectOptions = {},
): Promise<RenderTargets> {
  const scope = [notInArray(companies.id, renderedAlready(db)), inPlay];
  if (opts.niche != null) scope.push(eq(companies.niche, opts.niche));
  if (opts.shard) scope.push(opts.shard.where(companies.id));
  const take = async (where: SQL[], limit: number | undefined) => {
    const q = db
      .select()
      .from(companies)
      .where(and(...where))
      .orderBy(asc(companies.id));
    return limit === undefined ? q : q.limit(limit);
  };
  const shells =
    opts.shells === false
      ? []
      : await take([inArray(companies.id, shelled(db)), ...scope], opts.limit);
  if (!opts.blocked) return { shells, blocked: [] };
  const where = [
    inArray(companies.id, blockedAlready(db)),
    notInArray(companies.id, shelled(db)),
    ...scope,
  ];
  if (opts.deadDomains?.length) where.push(notInArray(companyDomain, [...opts.deadDomains]));
  const left = opts.limit === undefined ? undefined : Math.max(0, opts.limit - shells.length);
  return { shells, blocked: left === 0 ? [] : await take(where, left) };
}

export async function countRenderNicheNullSkipped(db: Queryable): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(companies)
    .where(
      and(
        inArray(companies.id, shelled(db)),
        notInArray(companies.id, renderedAlready(db)),
        isNull(companies.niche),
      ),
    );
  return r?.n ?? 0;
}

interface RenderRunOptions extends RenderSelectOptions, RenderCompanyOptions {
  checkpoint?: (company: Company) => void | Promise<void>;
}

/** Render companies whose tier-1 crawl found only shells; one transaction per company. */
export async function runRender(
  db: Queryable,
  renderer: Renderer,
  robotsFetcher: Fetcher,
  opts: RenderRunOptions = {},
): Promise<RenderStats> {
  const targets = await selectRenderTargets(db, {
    limit: opts.limit ?? 10,
    niche: opts.niche,
    shard: opts.shard,
  });
  let stats = emptyRenderStats();
  const robots: RobotsCache = new Map();
  for (const company of targets.shells) {
    const unit = await atomic(db, (tx) =>
      renderCompany(tx, renderer, robotsFetcher, company, robots, opts),
    );
    stats = addRenderStats(stats, unit);
    if (opts.checkpoint) await opts.checkpoint(company);
  }
  if (opts.niche != null) stats.niche_null_skipped = await countRenderNicheNullSkipped(db);
  return stats;
}
