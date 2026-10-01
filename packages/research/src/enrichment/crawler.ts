/**
 * Site crawler (funnel L2): a bounded, polite visit to one firm's website, storing
 * team/about-flavored pages as documents. robots.txt is consulted per URL; what a
 * disallow DOES is the robots mode: "warn" fetches anyway and reports every
 * disallowed URL, "enforce" skips. Crawling never calls an LLM. Companies are
 * crawled once (any company with documents is skipped); delete its documents to
 * force a recrawl. Crawl order prefers verified domains.
 */
import { createHash } from "node:crypto";
import { type Company, companies, inPlay } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { FetchError, type Fetcher, type FetchResponse } from "../fetch/fetcher.js";
import { looksLikeJsShell, readPage } from "../fetch/htmltext.js";
import { canFetch, type RobotsCache } from "../fetch/robots.js";
import { documents } from "../schema.js";
import type { Shard } from "./shard.js";
import { PEOPLE_PAGE_HINTS, peoplePageCandidates } from "./urls.js";

export type RobotsMode = "warn" | "enforce";
export const HTTP_TIER = "httpx";
export const EMPTY_HASH = createHash("sha256").update("").digest("hex");
/** Postgres TEXT cannot hold NUL, and real sites serve it. */
export const stripNul = (s: string): string => s.replaceAll("\x00", "");

export interface CrawlStats {
  companies_crawled: number;
  pages_stored: number;
  fetch_errors: number;
  robots_blocked: number;
  homepage_unreachable: number;
  /** Disallowed URLs fetched anyway under warn mode. */
  robots_warned: number;
  /** Pages stored but flagged as JS shells: kept for provenance, skipped by scan/extraction. */
  shells_stored: number;
  /** NULL-niche companies a scoped run cannot see. */
  niche_null_skipped: number;
  /** Exactly which URLs robots.txt disallowed (skipped in enforce mode, fetched-with-warning in warn mode). */
  robots_disallowed_urls: string[];
}

export function emptyCrawlStats(): CrawlStats {
  return {
    companies_crawled: 0,
    pages_stored: 0,
    fetch_errors: 0,
    robots_blocked: 0,
    homepage_unreachable: 0,
    robots_warned: 0,
    shells_stored: 0,
    niche_null_skipped: 0,
    robots_disallowed_urls: [],
  };
}

/** Sum per-unit stats into a run total (list fields concatenate). */
export function addCrawlStats(total: CrawlStats, unit: CrawlStats): CrawlStats {
  return {
    companies_crawled: total.companies_crawled + unit.companies_crawled,
    pages_stored: total.pages_stored + unit.pages_stored,
    fetch_errors: total.fetch_errors + unit.fetch_errors,
    robots_blocked: total.robots_blocked + unit.robots_blocked,
    homepage_unreachable: total.homepage_unreachable + unit.homepage_unreachable,
    robots_warned: total.robots_warned + unit.robots_warned,
    shells_stored: total.shells_stored + unit.shells_stored,
    niche_null_skipped: total.niche_null_skipped + unit.niche_null_skipped,
    robots_disallowed_urls: [...total.robots_disallowed_urls, ...unit.robots_disallowed_urls],
  };
}

interface RobotsCounters {
  robots_blocked: number;
  robots_warned: number;
  robots_disallowed_urls: string[];
}

/**
 * The robots seam shared by crawl and render: (proceed, disallowed). enforce = hard
 * skip, warn = fetch anyway; every disallowed URL is recorded in stats AND stamped on
 * the stored document so the fetch-over-disallow is queryable later.
 */
export async function robotsAllows(
  fetcher: Fetcher,
  url: string,
  cache: RobotsCache,
  mode: RobotsMode,
  stats: RobotsCounters,
): Promise<{ proceed: boolean; disallowed: boolean }> {
  if (await canFetch(fetcher, url, cache)) return { proceed: true, disallowed: false };
  stats.robots_disallowed_urls.push(url);
  if (mode === "enforce") {
    stats.robots_blocked += 1;
    return { proceed: false, disallowed: true };
  }
  stats.robots_warned += 1;
  return { proceed: true, disallowed: true };
}

async function get(fetcher: Fetcher, url: string): Promise<FetchResponse | null> {
  let resp: FetchResponse;
  try {
    resp = await fetcher.get(url);
  } catch (err) {
    if (err instanceof FetchError) return null;
    throw err;
  }
  return resp.status < 400 ? resp : null;
}

export interface StoredPage {
  stored: boolean;
  shell: boolean;
}

/**
 * Store one fetched page as a document. Hash is over the wire text; dedupe by hash
 * within the company (same bytes under two URLs: / and /home).
 */
export async function storePage(
  db: Queryable,
  companyId: number,
  url: string,
  resp: FetchResponse,
  seenHashes: Set<string>,
  opts: { robotsDisallowed?: boolean } = {},
): Promise<StoredPage> {
  const contentHash = createHash("sha256").update(resp.text).digest("hex");
  if (seenHashes.has(contentHash)) return { stored: false, shell: false };
  seenHashes.add(contentHash);
  const html = stripNul(resp.text);
  const page = readPage(html, resp.url);
  const shell = looksLikeJsShell(html, page.text);
  await db.insert(documents).values({
    companyId,
    url,
    finalUrl: resp.url !== url ? resp.url : null,
    kind: "webpage",
    statusCode: resp.status,
    contentHash,
    title: page.title || null,
    text: page.text,
    html,
    fetchTier: HTTP_TIER,
    isShell: shell,
    robotsDisallowed: opts.robotsDisallowed ?? false,
  });
  return { stored: true, shell };
}

export interface CrawlCompanyOptions {
  pagesPerSite?: number;
  /** A niche's site vocabulary ("advisors", "our-clinicians") on top of PEOPLE_PAGE_HINTS. */
  extraHints?: Iterable<string>;
  robotsMode?: RobotsMode;
}

/** Crawl one company's site into documents. Returns the unit's stats. */
export async function crawlCompany(
  db: Queryable,
  fetcher: Fetcher,
  company: Pick<Company, "id" | "domain">,
  opts: CrawlCompanyOptions = {},
): Promise<CrawlStats> {
  const stats = emptyCrawlStats();
  const domain = company.domain;
  if (!domain) return stats;
  const pagesPerSite = opts.pagesPerSite ?? 5;
  const mode = opts.robotsMode ?? "warn";
  const hints = [...PEOPLE_PAGE_HINTS, ...(opts.extraHints ?? [])];
  const robots: RobotsCache = new Map();

  let homepage: FetchResponse | null = null;
  let homepageUrl = "";
  let homepageDisallowed = false;
  for (const url of [`https://${domain}`, `https://www.${domain}`, `http://${domain}`]) {
    const { proceed, disallowed } = await robotsAllows(fetcher, url, robots, mode, stats);
    if (!proceed) continue;
    homepage = await get(fetcher, url);
    if (homepage) {
      homepageUrl = url;
      homepageDisallowed = disallowed;
      break;
    }
  }
  if (!homepage) {
    stats.homepage_unreachable += 1;
    // Tombstone: an empty-text attempt marker so the crawl-once query skips this
    // company next run. Extraction skips empty text; delete the row to retry.
    await db.insert(documents).values({
      companyId: company.id,
      url: `https://${domain}`,
      kind: "webpage",
      statusCode: null,
      contentHash: EMPTY_HASH,
      title: null,
      text: "",
    });
    return stats;
  }

  const seen = new Set<string>();
  let stored = 0;
  const home = await storePage(db, company.id, homepageUrl, homepage, seen, {
    robotsDisallowed: homepageDisallowed,
  });
  if (home.stored) stored += 1;
  if (home.shell) stats.shells_stored += 1;

  const links = readPage(stripNul(homepage.text), homepage.url).links;
  const candidates = peoplePageCandidates(links, domain, hints);
  for (const url of candidates.slice(0, Math.max(0, pagesPerSite - 1))) {
    const { proceed, disallowed } = await robotsAllows(fetcher, url, robots, mode, stats);
    if (!proceed) continue;
    const resp = await get(fetcher, url);
    if (!resp) {
      stats.fetch_errors += 1;
      continue;
    }
    const page = await storePage(db, company.id, url, resp, seen, { robotsDisallowed: disallowed });
    if (page.stored) stored += 1;
    if (page.shell) stats.shells_stored += 1;
  }
  stats.pages_stored += stored;
  stats.companies_crawled += 1;
  return stats;
}

export interface CrawlSelectOptions {
  limit?: number | undefined;
  niche?: string | null | undefined;
  shard?: Shard | null | undefined;
}

/** NOT EXISTS, not NOT IN: Postgres cannot hash a NOT IN over a big documents table and goes quadratic. */
const uncrawled = sql`NOT EXISTS (SELECT 1 FROM ${documents} WHERE ${documents.companyId} = ${companies.id})`;

/** Companies with a domain and no documents yet, verified domains first. */
export async function selectCrawlTargets(
  db: Queryable,
  opts: CrawlSelectOptions = {},
): Promise<Company[]> {
  const conditions = [isNotNull(companies.domain), inPlay, uncrawled];
  if (opts.niche != null) conditions.push(eq(companies.niche, opts.niche));
  if (opts.shard) conditions.push(opts.shard.where(companies.id));
  const q = db
    .select()
    .from(companies)
    .where(and(...conditions))
    .orderBy(sql`${companies.domainVerifiedAt} DESC NULLS LAST`, asc(companies.id));
  return opts.limit === undefined ? q : q.limit(opts.limit);
}

/** How many NULL-niche companies a niche-scoped crawl cannot see. */
export async function countCrawlNicheNullSkipped(db: Queryable): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(companies)
    .where(and(isNotNull(companies.domain), uncrawled, isNull(companies.niche)));
  return r?.n ?? 0;
}

export interface CrawlRunOptions extends CrawlSelectOptions, CrawlCompanyOptions {
  /** Called after each company's transaction commits. */
  checkpoint?: (company: Company) => void | Promise<void>;
}

/**
 * Crawl companies that have a domain and no documents yet (crawl-once). Each company
 * is one transaction, so a crash loses at most one company's work on re-run.
 */
export async function runCrawl(
  db: Queryable,
  fetcher: Fetcher,
  opts: CrawlRunOptions = {},
): Promise<CrawlStats> {
  const targets = await selectCrawlTargets(db, {
    limit: opts.limit ?? 10,
    niche: opts.niche,
    shard: opts.shard,
  });
  let stats = emptyCrawlStats();
  if (opts.niche != null) stats.niche_null_skipped = await countCrawlNicheNullSkipped(db);
  for (const company of targets) {
    const unit = await db.transaction((tx) => crawlCompany(tx, fetcher, company, opts));
    stats = addCrawlStats(stats, unit);
    if (opts.checkpoint) await opts.checkpoint(company);
  }
  return stats;
}
