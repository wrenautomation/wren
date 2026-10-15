/**
 * The daily read: Search Console's last `days` (upserted, since Google fills
 * them in late) and one URL inspection per sitemap page. Returns what changed
 * in the index since the last check, so the loop says it once, and the pages
 * seen for the first time, so the loop submits the sitemap. A new page that
 * Google hasn't read yet is no news; one still out after `STALE_DAYS` is.
 */
import type { Db } from "@wren/db";
import { and, desc, eq, lt, min, sql } from "drizzle-orm";
import { inspectUrl, type SearchConsoleClient, searchAnalytics } from "./console.js";
import { searchDays, searchPages } from "./schema.js";

const CHUNK = 1_000;
const DAY_MS = 86_400_000;
/** Days a new page may stay out of the index before it is worth a notice. */
export const STALE_DAYS = 14;

export interface SyncOptions {
  console: SearchConsoleClient;
  /** The property: `sc-domain:example.com` or `https://example.com/`. */
  site: string;
  /** The sitemap's page URLs to inspect. */
  urls: readonly string[];
  /** YYYY-MM-DD, the day of the pass. */
  today: string;
  /** How far back to re-read (default 7). */
  days?: number;
  runId: string | null;
}

export interface IndexChange {
  url: string;
  /** The coverage last time; null = first check. */
  was: string | null;
  now: string;
  indexed: boolean;
  /** Out since its first check, `STALE_DAYS` ago: Google has had time and still left it out. */
  stale?: boolean;
}

export interface SyncStats {
  rows: number;
  window: [string, string];
  inspected: number;
  indexed: number;
  /** Pages whose index state flipped since their last check, or new and still out `STALE_DAYS` on. */
  changes: IndexChange[];
  /** Sitemap pages checked for the first time. */
  added: string[];
}

const dayBefore = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);

export async function syncSearch(db: Db, o: SyncOptions): Promise<SyncStats> {
  const days = o.days ?? 7;
  const window: [string, string] = [dayBefore(o.today, days), dayBefore(o.today, 1)];
  const rows = await searchAnalytics(o.console, o.site, {
    startDate: window[0],
    endDate: window[1],
    dimensions: ["date", "query", "page"],
  });
  const values = rows.map((r) => ({
    day: r.keys[0] as string,
    query: r.keys[1] as string,
    page: r.keys[2] as string,
    clicks: Math.round(r.clicks),
    impressions: Math.round(r.impressions),
    position: r.position,
    runId: o.runId,
  }));
  for (let i = 0; i < values.length; i += CHUNK)
    await db
      .insert(searchDays)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [searchDays.day, searchDays.query, searchDays.page],
        set: {
          clicks: sql`excluded.clicks`,
          impressions: sql`excluded.impressions`,
          position: sql`excluded.position`,
          syncedAt: sql`now()`,
          runId: sql`excluded.run_id`,
        },
      });

  const changes: IndexChange[] = [];
  const added: string[] = [];
  let indexed = 0;
  for (const url of o.urls) {
    const r = await inspectUrl(o.console, o.site, url);
    const isIndexed = r.verdict === "PASS";
    if (isIndexed) indexed++;
    const coverage = r.coverageState ?? r.verdict;
    const [before] = await db
      .select({ verdict: searchPages.verdict, coverage: searchPages.coverage })
      .from(searchPages)
      .where(and(eq(searchPages.url, url), lt(searchPages.checkedOn, o.today)))
      .orderBy(desc(searchPages.checkedOn))
      .limit(1);
    if (!before) added.push(url);
    else if ((before.verdict === "PASS") !== isIndexed)
      changes.push({ url, was: before.coverage, now: coverage, indexed: isIndexed });
    else if (!isIndexed) {
      // Never in yet: one notice on the day it turns STALE_DAYS old.
      const [first] = await db
        .select({
          on: min(searchPages.checkedOn),
          ever: sql<boolean>`bool_or(${searchPages.verdict} = 'PASS')`,
        })
        .from(searchPages)
        .where(eq(searchPages.url, url));
      if (!first?.ever && first?.on === dayBefore(o.today, STALE_DAYS))
        changes.push({ url, was: before.coverage, now: coverage, indexed: false, stale: true });
    }
    const row = {
      verdict: r.verdict,
      coverage,
      lastCrawl: r.lastCrawlTime ? new Date(r.lastCrawlTime) : null,
      googleCanonical: r.googleCanonical ?? null,
      raw: r,
      runId: o.runId,
    };
    await db
      .insert(searchPages)
      .values({ url, checkedOn: o.today, ...row })
      .onConflictDoUpdate({ target: [searchPages.url, searchPages.checkedOn], set: row });
  }
  return { rows: values.length, window, inspected: o.urls.length, indexed, changes, added };
}

/** One line per change, for a notice: counts and paths, nothing else. */
export function formatChanges(changes: readonly IndexChange[]): string[] {
  return changes.map((c) => {
    const path = new URL(c.url).pathname;
    if (c.indexed) return `${path} is in the index`;
    return c.stale
      ? `${path} is still not indexed ${STALE_DAYS} days after it went up: ${c.now}`
      : `${path} left the index: ${c.now}`;
  });
}
