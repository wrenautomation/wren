/**
 * Crawled pages are public facts, kept on main for every client
 * (designs/2026-10-04-outbound-per-client.md, O1). A client's crawl asks main for
 * a recent copy of a URL before the network; a fresh 200 lands on main with no
 * company, so the next client reads it too. The client's own `documents` row is
 * still written by its crawl, in its database: extraction joins on it there.
 */
import type { Db } from "@wren/db";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Fetcher, FetchResponse } from "../fetch/fetcher.js";
import { htmlOf, type PageStore } from "../pages.js";
import { documents } from "../schema.js";
import { HTTP_TIER, pageRow } from "./crawler.js";

/** How long a kept page answers for its URL. */
export const SHARED_PAGE_DAYS = 30;

export function sharedPages(main: Db, inner: Fetcher, store?: PageStore | null): Fetcher {
  return {
    userAgent: inner.userAgent,
    async get(url: string): Promise<FetchResponse> {
      // robots.txt is the crawler's call each time, never cached as a page.
      if (new URL(url).pathname === "/robots.txt") return inner.get(url);
      const since = new Date(Date.now() - SHARED_PAGE_DAYS * 86_400_000);
      const [kept] = await main
        .select({
          finalUrl: documents.finalUrl,
          html: documents.html,
          htmlKey: documents.htmlKey,
        })
        .from(documents)
        .where(
          and(
            eq(documents.url, url),
            eq(documents.kind, "webpage"),
            eq(documents.statusCode, 200),
            eq(documents.fetchTier, HTTP_TIER),
            gt(documents.fetchedAt, since),
          ),
        )
        .orderBy(desc(documents.fetchedAt))
        .limit(1);
      const html = kept ? await htmlOf(kept, store).catch(() => null) : null;
      if (kept && html !== null) return { status: 200, url: kept.finalUrl ?? url, text: html };
      const resp = await inner.get(url);
      if (resp.status === 200)
        await main
          .insert(documents)
          .values(pageRow(null, url, resp))
          .onConflictDoNothing();
      return resp;
    },
  };
}
