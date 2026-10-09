/**
 * A creator's back catalog (designs/2026-10-07-learn.md): following reads only what comes
 * next, so what a creator posted before is read on ask, a few at a time. A pass walks the profile
 * newest first, page by page, and queues the next `want` posts Learn has not taken yet for the
 * Mac's reader; the next pass walks past them to older ones. Nothing is kept between passes: a
 * post is taken once it is an item (read, waiting, or archived by hand), so the walk re-finds its
 * place. A post its creator's follow kept as seen ("Posted before you followed.", never read) is
 * taken back. Reels only by default: a photo's whole read is its caption.
 */
import type { Db } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, eq, inArray } from "drizzle-orm";
import {
  type CreatorKind,
  type CreatorPage,
  creatorOf,
  FOLLOWED_BEFORE,
  isCreatorKind,
} from "./creators.js";
import { cleanUrl, typeOf } from "./links.js";
import { items, sources } from "./schema.js";

/** One page of a creator's posts; null when this kind cannot be paged here. */
export type CatalogReader = (
  kind: CreatorKind,
  handle: string,
  page: { after: string | null; limit: number },
) => Promise<CreatorPage> | null;

/** Posts a page: Graph's discovery takes up to 50; a page is one capped read. */
export const CATALOG_PAGE = 25;
/** Pages one pass walks at most: a 1,000-post profile, 40 reads of the day's 300. */
export const CATALOG_PAGES = 40;

export interface CatalogPass {
  creator: string;
  /** Items made for posts Learn never had, waiting for the Mac. */
  queued: number[];
  /** Items a follow had kept as seen, now waiting for the Mac. */
  revived: number[];
  /** Posts walked past: already taken, or not reels. */
  skipped: number;
  pages: number;
  /** The oldest post was reached: nothing older is left. */
  end: boolean;
}

/**
 * Queue the next `want` posts of a creator Learn has not taken, newest first. The items join its
 * source when the workspace follows it.
 */
export async function readCatalog(
  db: Db,
  read: CatalogReader,
  o: {
    client: string;
    url: string;
    want: number;
    now: Date;
    reelsOnly?: boolean;
    pageSize?: number;
    maxPages?: number;
  },
): Promise<CatalogPass> {
  const who = creatorOf(o.url);
  if (!who || !isCreatorKind(who.kind))
    throw new Error(`not a creator's profile: ${o.url} (an Instagram, X or TikTok profile)`);
  const [source] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.client, o.client), eq(sources.url, who.page)));
  const out: CatalogPass = {
    creator: `@${who.handle}`,
    queued: [],
    revived: [],
    skipped: 0,
    pages: 0,
    end: false,
  };
  const limit = o.pageSize ?? CATALOG_PAGE;
  let after: string | null = null;
  while (
    out.queued.length + out.revived.length < o.want &&
    out.pages < (o.maxPages ?? CATALOG_PAGES)
  ) {
    const pending = read(who.kind, who.handle, { after, limit });
    if (!pending) throw new Error(`${who.kind} profiles can't be paged yet`);
    const page = await pending;
    out.pages++;
    const posts = page.posts
      .filter((p) => !(o.reelsOnly ?? true) || p.kind === "reel")
      .map((p) => ({ ...p, url: cleanUrl(p.url) }));
    out.skipped += page.posts.length - posts.length;
    const had = posts.length
      ? await db
          .select({
            id: items.id,
            url: items.url,
            readAt: items.readAt,
            needsMac: items.needsMac,
            why: items.why,
          })
          .from(items)
          .where(
            and(
              eq(items.client, o.client),
              inArray(
                items.url,
                posts.map((p) => p.url),
              ),
            ),
          )
      : [];
    const byUrl = new Map(had.map((h) => [h.url, h]));
    for (const p of posts) {
      if (out.queued.length + out.revived.length >= o.want) break;
      const h = byUrl.get(p.url);
      if (h && !h.readAt && !h.needsMac && h.why === FOLLOWED_BEFORE) {
        await db
          .update(items)
          .set({ archivedAt: null, why: null, needsMac: o.now })
          .where(eq(items.id, h.id));
        out.revived.push(h.id);
        continue;
      }
      if (h) {
        out.skipped++;
        continue;
      }
      const [row] = await db
        .insert(items)
        .values({
          client: o.client,
          sourceId: source?.id ?? null,
          url: p.url,
          kind: p.kind,
          type: typeOf(p.url, p.kind, who.kind),
          title: pgSafe(p.title),
          creator: pgSafe(p.creator),
          text: pgSafe(p.text),
          publishedAt: p.publishedAt,
          thumbnailUrl: p.thumbnail,
          duration: p.duration,
          ...(p.kind === "reel" ? { needsMac: o.now } : {}),
        })
        .onConflictDoNothing({ target: [items.client, items.url] })
        .returning({ id: items.id });
      if (row) out.queued.push(row.id);
      else out.skipped++;
    }
    if (!page.next) {
      out.end = true;
      break;
    }
    after = page.next;
  }
  return out;
}
