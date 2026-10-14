/**
 * Pull email link clicks from the lander into `email_clicks`.
 *
 * The same shape as the open-pixel pull (`./opens.ts`): the lander is the source of truth, this
 * reads its `hits` forward from a stored cursor (`click_syncs`), and the cursor moves in the same
 * transaction as the counts it covers. Counts are increments, so that is what keeps a run that
 * dies half way from counting a view twice.
 *
 * A click is a view with `r` set: the lander writes `?r=<code>` on the view an email link lands
 * on. Each is grouped by code and page, and the code is looked up in `messages.link_code`. Only
 * email mints codes today. A text or a DM link that carried one would land here the same way, but
 * neither has a code column to name its message, and `/go/` hops drop `?r=` on the redirect, so
 * their clicks have no code and none arrive.
 *
 * A code no message holds is stored with no message: typed by hand, or a message since deleted.
 * A click is interest, not consent: nothing sends or stops on these rows.
 */
import { atomic, type Db, type Queryable } from "@wren/db";
import { eq, inArray, sql } from "drizzle-orm";
import type { FetchLike } from "../fetch-like.js";
import { clickSyncs, emailClicks, messages } from "../schema.js";
import { SITE_MAX_PAGES, SITE_PAGE, type SiteHit, sitePage } from "./clicks.js";

export interface ClickSyncStats {
  /** Views read this run. */
  fetched: number;
  /** Of those, views that came from an email link. */
  coded: number;
  /** Coded views whose code names a message. */
  matched: number;
  /** Coded views whose code no message holds. */
  unknown_code: number;
  /** Coded views with no readable time, left out. */
  unreadable: number;
  pages: number;
}

export interface SyncClicksOptions {
  baseUrl: string;
  exportToken: string;
  fetch?: FetchLike;
}

/** Read every view newer than the last one we hold, and count the coded ones. Returns the stats. */
export async function syncClicks(db: Db, opts: SyncClicksOptions): Promise<ClickSyncStats> {
  const stats: ClickSyncStats = {
    fetched: 0,
    coded: 0,
    matched: 0,
    unknown_code: 0,
    unreadable: 0,
    pages: 0,
  };
  let since = await cursor(db, opts.baseUrl);
  for (let page = 0; page < SITE_MAX_PAGES; page++) {
    const hits = await sitePage("hits", {
      baseUrl: opts.baseUrl,
      exportToken: opts.exportToken,
      since,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    stats.pages += 1;
    if (!hits.length) break;
    stats.fetched += hits.length;
    // Over every row read, not every row kept: most views carry no code.
    since = Math.max(since, ...hits.map((h) => Number(h.id)));
    await atomic(db, async (tx) => {
      await store(tx, hits, stats);
      await advance(tx, opts.baseUrl, since, stats);
    });
    if (hits.length < SITE_PAGE) break;
  }
  return stats;
}

/** This host's high-water mark: the lander's view id, 0 before the first run. */
async function cursor(db: Queryable, baseUrl: string): Promise<number> {
  const [stored] = await db.select().from(clickSyncs).where(eq(clickSyncs.baseUrl, baseUrl));
  return stored?.cursorId ?? 0;
}

async function advance(
  db: Queryable,
  baseUrl: string,
  cursorId: number,
  stats: ClickSyncStats,
): Promise<void> {
  await db
    .insert(clickSyncs)
    .values({ baseUrl, cursorId, syncedAt: sql`now()`, stats: { ...stats } })
    .onConflictDoUpdate({
      target: clickSyncs.baseUrl,
      set: {
        cursorId: sql`excluded.cursor_id`,
        syncedAt: sql`excluded.synced_at`,
        stats: sql`excluded.stats`,
      },
      // Never move a cursor backwards: a stale page or a re-pointed host must not re-count what it passed.
      setWhere: sql`${clickSyncs.cursorId} < excluded.cursor_id`,
    });
}

interface Group {
  code: string;
  url: string;
  first: Date;
  last: Date;
  clicks: number;
}

/** Group the coded views of one page by code and landing page. */
function grouped(hits: readonly SiteHit[], stats: ClickSyncStats): Group[] {
  const groups = new Map<string, Group>();
  for (const h of hits) {
    const code = typeof h.r === "string" ? h.r.trim().slice(0, 40) : "";
    if (!code) continue;
    stats.coded += 1;
    const at = new Date(String(h.ts));
    if (Number.isNaN(at.getTime())) {
      stats.unreadable += 1;
      continue;
    }
    const url = String(h.page ?? "").slice(0, 200);
    const key = `${code}\n${url}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { code, url, first: at, last: at, clicks: 1 });
    else {
      g.clicks += 1;
      if (at < g.first) g.first = at;
      if (at > g.last) g.last = at;
    }
  }
  return [...groups.values()];
}

async function store(
  db: Queryable,
  hits: readonly SiteHit[],
  stats: ClickSyncStats,
): Promise<void> {
  const groups = grouped(hits, stats);
  if (!groups.length) return;
  const known = new Map(
    (
      await db
        .select({ code: messages.linkCode, id: messages.id })
        .from(messages)
        .where(inArray(messages.linkCode, [...new Set(groups.map((g) => g.code))]))
    ).map((row) => [row.code, row.id]),
  );
  for (const g of groups) {
    if (known.has(g.code)) stats.matched += g.clicks;
    else stats.unknown_code += g.clicks;
  }
  await db
    .insert(emailClicks)
    .values(
      groups.map((g) => ({
        linkCode: g.code,
        url: g.url,
        messageId: known.get(g.code) ?? null,
        firstAt: g.first,
        lastAt: g.last,
        clicks: g.clicks,
      })),
    )
    .onConflictDoUpdate({
      target: [emailClicks.linkCode, emailClicks.url],
      set: {
        clicks: sql`${emailClicks.clicks} + excluded.clicks`,
        firstAt: sql`least(${emailClicks.firstAt}, excluded.first_at)`,
        lastAt: sql`greatest(${emailClicks.lastAt}, excluded.last_at)`,
        messageId: sql`coalesce(${emailClicks.messageId}, excluded.message_id)`,
      },
    });
}
