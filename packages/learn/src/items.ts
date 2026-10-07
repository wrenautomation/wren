/**
 * Items by hand: saving a link (the portal box, the phone's Shortcut, the CLI), search across
 * every transcript, and one item whole for its page.
 */
import type { Db, Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { cleanUrl, kindOf, needsMac, typeOf, youtubeThumb } from "./links.js";
import { type ItemKind, items, sopSources, sources, type Via } from "./schema.js";

export interface Saved {
  id: number;
  url: string;
  kind: ItemKind;
  /** First time this link came in. */
  fresh: boolean;
  /** It still has to be read: it goes onto the spine. */
  unread: boolean;
}

/**
 * Save a link. The same link twice is one item: a second save only marks it saved again. One the
 * feed already brought keeps its read and score, and comes back from done.
 */
export async function saveLink(
  db: Db,
  p: { url: string; by: string | null; via: Via; title?: string | null },
): Promise<Saved> {
  const url = cleanUrl(p.url);
  const kind = kindOf(url);
  const now = new Date();
  const [row] = await db
    .insert(items)
    .values({
      url,
      kind,
      type: typeOf(url, kind),
      thumbnailUrl: youtubeThumb(url),
      title: pgSafe(p.title?.trim() || url),
      savedAt: now,
      savedBy: p.by,
      savedVia: p.via,
      ...(needsMac(kind) ? { needsMac: now } : {}),
    })
    .onConflictDoUpdate({
      target: items.url,
      set: {
        savedAt: sql`coalesce(${items.savedAt}, ${now.toISOString()}::timestamptz)`,
        savedBy: sql`coalesce(${items.savedBy}, ${p.by})`,
        savedVia: sql`coalesce(${items.savedVia}, ${p.via})`,
        archivedAt: null,
      },
    })
    .returning({
      id: items.id,
      kind: items.kind,
      readAt: items.readAt,
      fresh: sql<boolean>`xmax = 0`,
    });
  if (!row) throw new Error("save returned no row");
  return { id: row.id, url, kind: row.kind, fresh: !!row.fresh, unread: !row.readAt };
}

export interface Hit {
  id: number;
  title: string;
  url: string;
  kind: string;
  source: string;
  score: number | null;
  savedAt: Date | null;
  at: Date;
  /** The matched words, marked «like this». */
  snippet: string;
  rank: number;
}

/** Every item's transcript searched, best match first. Words, "a phrase", -not and or. */
export async function searchItems(db: Queryable, q: string, limit = 40): Promise<Hit[]> {
  const words = q.trim();
  if (!words) return [];
  const tsq = sql`websearch_to_tsquery('english', ${words})`;
  const rank = sql<number>`ts_rank(${items.search}, ${tsq})`;
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      url: items.url,
      kind: items.kind,
      source: sql<string>`coalesce(${sources.name}, 'Saved')`,
      score: items.score,
      savedAt: items.savedAt,
      at: sql<Date>`coalesce(${items.publishedAt}, ${items.createdAt})`,
      snippet: sql<string>`ts_headline('english', left(coalesce(${items.transcript}, ${items.text}, ''), 200000), ${tsq}, 'MaxWords=30, MinWords=10, MaxFragments=2, FragmentDelimiter=" … ", StartSel=«, StopSel=»')`,
      rank,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(sql`${items.search} @@ ${tsq}`)
    .orderBy(sql`${rank} desc`, desc(items.id))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => ({ ...r, rank: Number(r.rank), at: new Date(r.at) }));
}

/** One item whole: its transcript, the SOPs it was asked into. Null for none. */
export async function itemOf(db: Queryable, id: number) {
  const [row] = await db
    .select({ item: items, source: sources.name })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(items.id, id));
  if (!row) return null;
  const sops = await db
    .select()
    .from(sopSources)
    .where(eq(sopSources.itemId, id))
    .orderBy(asc(sopSources.sop));
  return { ...row.item, source: row.source, sops };
}

/** Items for the CLI: newest first, saved only or waiting only on ask. */
export async function listItems(
  db: Queryable,
  o: { saved?: boolean; waiting?: boolean; limit?: number } = {},
) {
  return db
    .select({
      id: items.id,
      title: items.title,
      kind: items.kind,
      url: items.url,
      score: items.score,
      verdict: items.verdict,
      readAt: items.readAt,
      readFailure: items.readFailure,
      savedAt: items.savedAt,
      source: sources.name,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        o.saved ? sql`${items.savedAt} is not null` : undefined,
        o.waiting ? sql`${items.readAt} is null and ${items.archivedAt} is null` : undefined,
      ),
    )
    .orderBy(sql`coalesce(${items.savedAt}, ${items.createdAt}) desc`, desc(items.id))
    .limit(o.limit ?? 30);
}
