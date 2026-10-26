/**
 * Site crawler (funnel L2): a bounded, polite visit to one firm's website, storing
 * team/about-flavored pages as documents. robots.txt is consulted per URL and is a
 * warning, never a stop: a disallowed URL is fetched anyway and reported. Crawling never calls an LLM. Companies are
 * crawled once (any company with documents is skipped); delete its documents to
 * force a recrawl. Crawl order prefers verified domains.
 */
import { createHash } from "node:crypto";
import { type Company, companies, inPlay } from "@wren/core";
import { atomic, type Queryable } from "@wren/db";
import {
  canFetch,
  FetchError,
  type Fetcher,
  type FetchResponse,
  looksLikeJsShell,
  type RobotsCache,
  readPage,
} from "@wrenautomation/scribe/fetch";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { domainOf, type TierMemory } from "../fetch/tier-memory.js";
import { documents } from "../schema.js";
import type { Shard } from "./shard.js";
import { PEOPLE_PAGE_HINTS, peoplePageCandidates } from "./urls.js";

export const HTTP_TIER = "httpx";
export const EMPTY_HASH = createHash("sha256").update("").digest("hex");
/** Postgres TEXT cannot hold NUL, and real sites serve it. */
export const stripNul = (s: string): string => s.replaceAll("\x00", "");

export interface CrawlStats {
  companies_crawled: number;
  pages_stored: number;
  fetch_errors: number;
  homepage_unreachable: number;
  /** Disallowed URLs fetched anyway. */
  robots_warned: number;
  /** Pages stored but flagged as JS shells: kept for provenance, skipped by scan/extraction. */
  shells_stored: number;
  /** NULL-niche companies a scoped run cannot see. */
  niche_null_skipped: number;
  /** Not fetched: the domain's memory says nothing works (`dead`). */
  dead_skipped: number;
  /** Not fetched: the domain's memory says it needs a browser; the render pass takes it. */
  remembered_skipped: number;
  /** Exactly which URLs robots.txt disallowed (each fetched anyway, with a warning). */
  robots_disallowed_urls: string[];
}

export function emptyCrawlStats(): CrawlStats {
  return {
    companies_crawled: 0,
    pages_stored: 0,
    fetch_errors: 0,
    homepage_unreachable: 0,
    robots_warned: 0,
    shells_stored: 0,
    niche_null_skipped: 0,
    dead_skipped: 0,
    remembered_skipped: 0,
    robots_disallowed_urls: [],
  };
}

/** Sum per-unit stats into a run total (list fields concatenate). */
export function addCrawlStats(total: CrawlStats, unit: CrawlStats): CrawlStats {
  return {
    companies_crawled: total.companies_crawled + unit.companies_crawled,
    pages_stored: total.pages_stored + unit.pages_stored,
    fetch_errors: total.fetch_errors + unit.fetch_errors,
    homepage_unreachable: total.homepage_unreachable + unit.homepage_unreachable,
    robots_warned: total.robots_warned + unit.robots_warned,
    shells_stored: total.shells_stored + unit.shells_stored,
    niche_null_skipped: total.niche_null_skipped + unit.niche_null_skipped,
    dead_skipped: total.dead_skipped + unit.dead_skipped,
    remembered_skipped: total.remembered_skipped + unit.remembered_skipped,
    robots_disallowed_urls: [...total.robots_disallowed_urls, ...unit.robots_disallowed_urls],
  };
}

interface RobotsCounters {
  robots_warned: number;
  robots_disallowed_urls: string[];
}

/**
 * The robots seam shared by crawl and render: robots.txt is a warning, never a stop. A
 * disallowed URL is fetched anyway, recorded in stats AND stamped on the stored document
 * so the fetch-over-disallow is queryable later. Returns whether it was disallowed.
 */
export async function robotsDisallows(
  fetcher: Fetcher,
  url: string,
  cache: RobotsCache,
  stats: RobotsCounters,
): Promise<boolean> {
  if (await canFetch(fetcher, url, cache)) return false;
  stats.robots_disallowed_urls.push(url);
  stats.robots_warned += 1;
  return true;
}

/** A page under 400, else null; `refused` keeps the status that turned it away (403, 429). */
async function get(
  fetcher: Fetcher,
  url: string,
  refused?: { status: number | null },
): Promise<FetchResponse | null> {
  let resp: FetchResponse;
  try {
    resp = await fetcher.get(url);
  } catch (err) {
    if (!(err instanceof FetchError)) throw err;
    if (refused && err.status !== null) refused.status = err.status;
    return null;
  }
  if (resp.status < 400) return resp;
  if (refused) refused.status = resp.status;
  return null;
}

interface StoredPage {
  stored: boolean;
  shell: boolean;
}

/**
 * Store one fetched page as a document. Hash is over the wire text; dedupe by hash
 * within the company (same bytes under two URLs: / and /home).
 */
async function storePage(
  db: Queryable,
  companyId: number,
  url: string,
  resp: FetchResponse,
  seenHashes: Set<string>,
  opts: { robotsDisallowed?: boolean } = {},
): Promise<StoredPage> {
  const row = pageRow(companyId, url, resp, opts);
  if (seenHashes.has(row.contentHash)) return { stored: false, shell: false };
  seenHashes.add(row.contentHash);
  await db.insert(documents).values(row);
  return { stored: true, shell: row.isShell };
}

/** One fetched page as a `documents` row; `companyId` null is a page kept for anyone (the shared cache). */
export function pageRow(
  companyId: number | null,
  url: string,
  resp: FetchResponse,
  opts: { robotsDisallowed?: boolean } = {},
) {
  const html = stripNul(resp.text);
  const page = readPage(html, resp.url);
  return {
    companyId,
    url,
    finalUrl: resp.url !== url ? resp.url : null,
    kind: "webpage" as const,
    statusCode: resp.status,
    contentHash: createHash("sha256").update(resp.text).digest("hex"),
    title: page.title || null,
    text: page.text,
    html,
    fetchTier: resp.tier ?? HTTP_TIER,
    isShell: looksLikeJsShell(html, page.text),
    robotsDisallowed: opts.robotsDisallowed ?? false,
  };
}

interface CrawlCompanyOptions {
  pagesPerSite?: number;
  /** A niche's site vocabulary ("advisors", "our-clinicians") on top of PEOPLE_PAGE_HINTS. */
  extraHints?: Iterable<string>;
  /** The fetch ladder's memory (main's). A domain it marks is not fetched. Absent: fetch as is. */
  memory?: TierMemory;
}

/** The statuses that are a block: the render pass takes a company whose homepage met one. */
const BLOCK_STATUSES: ReadonlySet<number> = new Set([403, 429, 503]);

/**
 * An empty-text attempt marker so the crawl-once query skips this company next run. Extraction
 * skips empty text; delete the row to retry. `status` is the last refusal or null when nothing
 * answered. `blockReason` says why the render pass should take it (`status-403`), or why it
 * must not (`dead`).
 */
async function tombstone(
  db: Queryable,
  companyId: number,
  domain: string,
  status: number | null,
  blockReason: string | null,
): Promise<void> {
  await db.insert(documents).values({
    companyId,
    url: `https://${domain}`,
    kind: "webpage",
    statusCode: status,
    contentHash: EMPTY_HASH,
    title: null,
    text: "",
    blockReason,
  });
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
  const hints = [...PEOPLE_PAGE_HINTS, ...(opts.extraHints ?? [])];
  const robots: RobotsCache = new Map();

  // A domain the render pass learned about is not fetched: a tombstone says why, and a remembered
  // one waits for the render pass. `browser` is fetched as today: its shell goes to the box renderer.
  const known = opts.memory ? await opts.memory.get(domainOf(`https://${domain}`) ?? domain) : null;
  if (known && known !== "browser") {
    const skip = known === "dead" ? "dead" : "remembered";
    stats[`${skip}_skipped`] += 1;
    await tombstone(db, company.id, domain, null, skip);
    return stats;
  }

  let homepage: FetchResponse | null = null;
  let homepageUrl = "";
  let homepageDisallowed = false;
  const refused: { status: number | null } = { status: null };
  for (const url of [`https://${domain}`, `https://www.${domain}`, `http://${domain}`]) {
    const disallowed = await robotsDisallows(fetcher, url, robots, stats);
    homepage = await get(fetcher, url, refused);
    if (homepage) {
      homepageUrl = url;
      homepageDisallowed = disallowed;
      break;
    }
  }
  if (!homepage) {
    stats.homepage_unreachable += 1;
    await tombstone(
      db,
      company.id,
      domain,
      refused.status,
      refused.status !== null && BLOCK_STATUSES.has(refused.status)
        ? `status-${refused.status}`
        : null,
    );
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
    const disallowed = await robotsDisallows(fetcher, url, robots, stats);
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

interface CrawlSelectOptions {
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

interface CrawlRunOptions extends CrawlSelectOptions, CrawlCompanyOptions {
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
    const unit = await atomic(db, (tx) => crawlCompany(tx, fetcher, company, opts));
    stats = addCrawlStats(stats, unit);
    if (opts.checkpoint) await opts.checkpoint(company);
  }
  return stats;
}
