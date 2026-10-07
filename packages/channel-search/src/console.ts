/**
 * Google Search Console over `fetch`: search analytics, URL inspection and the
 * sitemap list. Read-only (`webmasters.readonly`); the service account is a
 * site owner, so no delegation. There is no API to request indexing: that
 * stays a button in the console. The bearer never appears in an error.
 */
import { type FetchLike, type ServiceAccountKey, serviceAccountToken } from "@wren/channel-email";
import { INSPECTION_VERDICTS, type InspectionVerdict } from "./schema.js";

export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const API = "https://searchconsole.googleapis.com";
const WEBMASTERS = `${API}/webmasters/v3`;
/** Google's cap on rows per analytics request; `startRow` pages past it. */
export const PAGE_ROWS = 25_000;

export class SearchConsoleError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SearchConsoleError";
    this.status = status;
  }
}

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

export interface AnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Inspection {
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
  method: "GET" | "POST",
  url: string,
  body?: Json,
): Promise<Json> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await c.token()}` };
  if (body) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await c.fetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
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
  const res = await fetch(sitemap, { method: "GET" });
  if (!res.ok)
    throw new SearchConsoleError(res.status, `sitemap ${sitemap} answered ${res.status}`);
  return [...(await res.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(
    (m) => m[1] as string,
  );
}

/** A property the service account is on, and how: `siteOwner`, `siteFullUser`, `siteUnverifiedUser`… */
export interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

/** Every property the service account sees. One free read. */
export async function listSites(c: SearchConsoleClient): Promise<SiteEntry[]> {
  const out = await call(c, "GET", `${WEBMASTERS}/sites`);
  return (out.siteEntry as SiteEntry[] | undefined) ?? [];
}
