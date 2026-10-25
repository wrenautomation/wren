/**
 * Google Search Console over `fetch`: search analytics, URL inspection, the
 * sitemap list and one write, submitting the sitemap (`webmasters`); the
 * service account is a site owner, so no delegation. There is no API to
 * request indexing one page: a submitted sitemap is how Google hears of a new
 * one. The bearer never appears in an error.
 */
import {
  type FetchLike,
  type ServiceAccountKey,
  serviceAccountToken,
} from "@wrenautomation/autobrowse/google";
import { INSPECTION_VERDICTS, type InspectionVerdict } from "./schema.js";

const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const API = "https://searchconsole.googleapis.com";
const WEBMASTERS = `${API}/webmasters/v3`;
/** Google's cap on rows per analytics request; `startRow` pages past it. */
const PAGE_ROWS = 25_000;

class SearchConsoleError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SearchConsoleError";
    this.status = status;
  }
}

/** One Search Console call: an analytics query or a URL inspection. */
const SEARCH_CONSOLE_LIMIT_MS = 60_000;
/** One page of our own site (the sitemap, a page head, llms.txt). */
export const PAGE_LIMIT_MS = 30_000;

export interface SearchConsoleClient {
  fetch: FetchLike;
  /** A bearer supplier (`serviceAccountToken`); a long pass outlives one token. */
  token: () => Promise<string>;
}

/** The service account as a site owner: its own identity, no subject to impersonate. */
export function searchConsoleClient(
  key: ServiceAccountKey,
  fetch: FetchLike = (u, i) => globalThis.fetch(u, i),
): SearchConsoleClient {
  return { fetch, token: serviceAccountToken(key, { scopes: [SEARCH_CONSOLE_SCOPE], fetch }) };
}

interface AnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Inspection {
  verdict: InspectionVerdict;
  coverageState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  googleCanonical?: string;
  userCanonical?: string;
  [k: string]: unknown;
}

type Json = Record<string, unknown>;

async function call(
  c: SearchConsoleClient,
  method: "GET" | "POST" | "PUT",
  url: string,
  body?: Json,
): Promise<Json> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await c.token()}` };
  if (body) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await c.fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(SEARCH_CONSOLE_LIMIT_MS),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new SearchConsoleError(0, `Search Console unreachable: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (res.ok) return text ? (JSON.parse(text) as Json) : {};
  let detail = text.slice(0, 300);
  try {
    const e = (JSON.parse(text) as { error?: { message?: string; status?: string } }).error;
    detail = [e?.status, e?.message].filter(Boolean).join(": ") || detail;
  } catch {}
  if (/SERVICE_DISABLED|has not been used/.test(detail))
    throw new SearchConsoleError(
      res.status,
      `the Search Console API is off on the key's Cloud project: ${detail}`,
    );
  if (res.status === 403)
    throw new SearchConsoleError(
      403,
      `Search Console refused: the service account must be an owner or user of the property. ${detail}`,
    );
  throw new SearchConsoleError(res.status, `Search Console answered ${res.status}: ${detail}`);
}

/** Every row for `dimensions` between two days (inclusive), paged past Google's per-request cap. */
export async function searchAnalytics(
  c: SearchConsoleClient,
  site: string,
  q: { startDate: string; endDate: string; dimensions: readonly string[] },
): Promise<AnalyticsRow[]> {
  const url = `${WEBMASTERS}/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const rows: AnalyticsRow[] = [];
  for (let startRow = 0; ; startRow += PAGE_ROWS) {
    const page = await call(c, "POST", url, {
      ...q,
      dimensions: [...q.dimensions],
      rowLimit: PAGE_ROWS,
      startRow,
      dataState: "all",
    });
    const got = (page.rows as AnalyticsRow[] | undefined) ?? [];
    rows.push(...got);
    if (got.length < PAGE_ROWS) return rows;
  }
}

/** How Google's index sees one URL. */
export async function inspectUrl(
  c: SearchConsoleClient,
  site: string,
  url: string,
): Promise<Inspection> {
  const out = await call(c, "POST", `${API}/v1/urlInspection/index:inspect`, {
    inspectionUrl: url,
    siteUrl: site,
  });
  const r = (out.inspectionResult as Json | undefined)?.indexStatusResult as Inspection | undefined;
  // A verdict Google adds later reads as unspecified; the stored `raw` keeps what it said.
  if (!r || !(INSPECTION_VERDICTS as readonly string[]).includes(r.verdict))
    return { ...r, verdict: "VERDICT_UNSPECIFIED" };
  return r;
}

/** The URLs a sitemap lists (`<loc>`), read from the live site. */
export async function sitemapUrls(fetch: FetchLike, sitemap: string): Promise<string[]> {
  const res = await fetch(sitemap, { method: "GET", signal: AbortSignal.timeout(PAGE_LIMIT_MS) });
  if (!res.ok)
    throw new SearchConsoleError(res.status, `sitemap ${sitemap} answered ${res.status}`);
  return [...(await res.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(
    (m) => m[1] as string,
  );
}

/**
 * Tells Google to read the sitemap again: how it hears of pages it has never seen ("URL is
 * unknown to Google"). Bing and the IndexNow engines hear from the lander's deploy instead.
 */
export async function submitSitemap(
  c: SearchConsoleClient,
  site: string,
  sitemap: string,
): Promise<void> {
  await call(
    c,
    "PUT",
    `${WEBMASTERS}/sites/${encodeURIComponent(site)}/sitemaps/${encodeURIComponent(sitemap)}`,
  );
}

/** A property the service account is on, and how: `siteOwner`, `siteFullUser`, `siteUnverifiedUser`… */
interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

/** Every property the service account sees. One free read. */
export async function listSites(c: SearchConsoleClient): Promise<SiteEntry[]> {
  const out = await call(c, "GET", `${WEBMASTERS}/sites`);
  return (out.siteEntry as SiteEntry[] | undefined) ?? [];
}
