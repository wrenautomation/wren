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
 */
import { createHash } from "node:crypto";
import { type Company, companies, inPlay } from "@wren/core";
import { atomic, type Queryable } from "@wren/db";
import { and, asc, count, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import type { Fetcher } from "../fetch/fetcher.js";
import { looksLikeJsShell, readPage } from "../fetch/htmltext.js";
import type { RobotsCache } from "../fetch/robots.js";
import { documents } from "../schema.js";
import { EMPTY_HASH, type RobotsMode, robotsAllows, stripNul } from "./crawler.js";
import type { Shard } from "./shard.js";
import { PEOPLE_PAGE_HINTS, peoplePageCandidates } from "./urls.js";

export const BROWSER_TIER = "browser";
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
  robots_blocked: number;
  robots_warned: number;
  homepage_unrendered: number;
  niche_null_skipped: number;
  robots_disallowed_urls: string[];
}

export function emptyRenderStats(): RenderStats {
  return {
    companies_rendered: 0,
    pages_stored: 0,
    still_shell: 0,
    render_errors: 0,
    robots_blocked: 0,
    robots_warned: 0,
    homepage_unrendered: 0,
    niche_null_skipped: 0,
    robots_disallowed_urls: [],
  };
}

export function addRenderStats(total: RenderStats, unit: RenderStats): RenderStats {
  return {
    companies_rendered: total.companies_rendered + unit.companies_rendered,
    pages_stored: total.pages_stored + unit.pages_stored,
    still_shell: total.still_shell + unit.still_shell,
    render_errors: total.render_errors + unit.render_errors,
    robots_blocked: total.robots_blocked + unit.robots_blocked,
    robots_warned: total.robots_warned + unit.robots_warned,
    homepage_unrendered: total.homepage_unrendered + unit.homepage_unrendered,
    niche_null_skipped: total.niche_null_skipped + unit.niche_null_skipped,
    robots_disallowed_urls: [...total.robots_disallowed_urls, ...unit.robots_disallowed_urls],
  };
}

type Seen = Set<string>;
const seenKey = (url: string, hash: string) => `${url} ${hash}`;

async function storeRendered(
  db: Queryable,
  companyId: number,
  url: string,
  rendered: RenderedPage,
  seen: Seen,
  stats: RenderStats,
  robotsDisallowed: boolean,
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
    fetchTier: BROWSER_TIER,
    isShell: shell,
    robotsDisallowed,
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

export interface RenderCompanyOptions {
  pagesPerSite?: number;
  extraHints?: Iterable<string>;
  robotsMode?: RobotsMode;
  /** Seconds of uniform pause before each render. */
  jitter?: readonly [number, number];
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
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
  const mode = opts.robotsMode ?? "warn";
  const pagesPerSite = opts.pagesPerSite ?? 5;
  const hints = [...PEOPLE_PAGE_HINTS, ...(opts.extraHints ?? [])];
  const jitter = opts.jitter ?? DEFAULT_JITTER;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const pause = () => sleep((jitter[0] + (jitter[1] - jitter[0]) * random()) * 1000);

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

  const home = await robotsAllows(robotsFetcher, homepageUrl, robots, mode, stats);
  if (!home.proceed) {
    // Enforce mode only: without a browser row the company would be re-selected forever.
    await tombstone(db, company.id, homepageUrl, seen);
    return stats;
  }
  await pause();
  let homepage: RenderedPage;
  try {
    homepage = await renderer(homepageUrl);
  } catch {
    stats.render_errors += 1;
    stats.homepage_unrendered += 1;
    await tombstone(db, company.id, homepageUrl, seen);
    return stats;
  }

  let stored = 0;
  if (await storeRendered(db, company.id, homepageUrl, homepage, seen, stats, home.disallowed))
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
    const { proceed, disallowed } = await robotsAllows(robotsFetcher, url, robots, mode, stats);
    if (!proceed) continue;
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
  return stats;
}

export interface RenderSelectOptions {
  limit?: number | undefined;
  niche?: string | null | undefined;
  shard?: Shard | null | undefined;
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
    .where(and(eq(documents.fetchTier, BROWSER_TIER), isNotNull(documents.companyId)));

/** Companies with at least one shell document and no browser-tier document yet. */
export async function selectRenderTargets(
  db: Queryable,
  opts: RenderSelectOptions = {},
): Promise<Company[]> {
  const conditions = [
    inArray(companies.id, shelled(db)),
    notInArray(companies.id, renderedAlready(db)),
    inPlay,
  ];
  if (opts.niche != null) conditions.push(eq(companies.niche, opts.niche));
  if (opts.shard) conditions.push(opts.shard.where(companies.id));
  const q = db
    .select()
    .from(companies)
    .where(and(...conditions))
    .orderBy(asc(companies.id));
  return opts.limit === undefined ? q : q.limit(opts.limit);
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

export interface RenderRunOptions extends RenderSelectOptions, RenderCompanyOptions {
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
  for (const company of targets) {
    const unit = await atomic(db, (tx) =>
      renderCompany(tx, renderer, robotsFetcher, company, robots, opts),
    );
    stats = addRenderStats(stats, unit);
    if (opts.checkpoint) await opts.checkpoint(company);
  }
  if (opts.niche != null) stats.niche_null_skipped = await countRenderNicheNullSkipped(db);
  return stats;
}
