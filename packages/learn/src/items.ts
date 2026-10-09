/**
 * Items by hand: saving a link (the portal box, the phone's Shortcut, the CLI), search across
 * every transcript, and one item whole for its page. Each in one workspace (`client`): Wren's own
 * (`wren`) or a client's.
 */
import type { Db, Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import type { Embed } from "@wren/llm";
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { nearItems } from "./embed.js";
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
 * Save a link. The same link twice in a workspace is one item: a second save only marks it saved
 * again. One the feed already brought keeps its read and score, and comes back from done.
 */
export async function saveLink(
  db: Db,
  p: { client: string; url: string; by: string | null; via: Via; title?: string | null },
): Promise<Saved> {
  const url = cleanUrl(p.url);
  const kind = kindOf(url);
  const now = new Date();
  const [row] = await db
    .insert(items)
    .values({
      client: p.client,
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
      target: [items.client, items.url],
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

const RRF_K = 60;

/**
 * Every item's transcript searched, best match first. Words, "a phrase", -not and or. With an
 * embedder, items near the query's meaning join the word matches, the two lists fused by rank
 * (reciprocal rank fusion); a failed embed leaves the word matches alone.
 */
export async function searchItems(
  db: Queryable,
  client: string,
  q: string,
  limit = 40,
  embed: Embed | null = null,
): Promise<Hit[]> {
  const words = q.trim();
  if (!words) return [];
  const cap = Math.min(Math.max(limit, 1), 200);
  const tsq = sql`websearch_to_tsquery('english', ${words})`;
  const rank = sql<number>`ts_rank(${items.search}, ${tsq})`;
  const columns = (snippet: SQL<string>) => ({
    id: items.id,
    title: items.title,
    url: items.url,
    kind: items.kind,
    source: sql<string>`coalesce(${sources.name}, 'Saved')`,
    score: items.score,
    savedAt: items.savedAt,
    at: sql<Date>`coalesce(${items.publishedAt}, ${items.createdAt})`,
    snippet,
  });
  const rows = await db
    .select({
      ...columns(
        sql<string>`ts_headline('english', left(coalesce(${items.transcript}, ${items.text}, ''), 200000), ${tsq}, 'MaxWords=30, MinWords=10, MaxFragments=2, FragmentDelimiter=" … ", StartSel=«, StopSel=»')`,
      ),
      rank,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(and(eq(items.client, client), sql`${items.search} @@ ${tsq}`))
    .orderBy(sql`${rank} desc`, desc(items.id))
    .limit(cap);
  const byWords = rows.map((r) => ({ ...r, rank: Number(r.rank), at: new Date(r.at) }));
  if (!embed) return byWords;
  const near = await embed([words], "query")
    .then(([v]) => (v ? nearItems(db, client, v, cap) : []))
    .catch(() => []);
  if (!near.length) return byWords;
  const fused = new Map<number, number>();
  for (const [i, h] of byWords.entries()) fused.set(h.id, 1 / (RRF_K + i + 1));
  for (const [i, n] of near.entries())
    fused.set(n.id, (fused.get(n.id) ?? 0) + 1 / (RRF_K + i + 1));
  const known = new Set(byWords.map((h) => h.id));
  const more = near.filter((n) => !known.has(n.id)).map((n) => n.id);
  const extra = more.length
    ? (
        await db
          .select({
            ...columns(sql<string>`left(coalesce(${items.summary}, ${items.text}, ''), 240)`),
          })
          .from(items)
          .leftJoin(sources, eq(sources.id, items.sourceId))
          .where(and(eq(items.client, client), inArray(items.id, more)))
      ).map((r) => ({ ...r, rank: 0, at: new Date(r.at) }))
    : [];
  return [...byWords, ...extra]
    .map((h) => ({ ...h, rank: fused.get(h.id) ?? 0 }))
    .sort((a, b) => b.rank - a.rank || b.id - a.id)
    .slice(0, cap);
}

/** One ⌘K line: enough to name an item and open it. */
export interface Found {
  id: number;
  title: string;
  kind: ItemKind;
  source: string;
}

/**
 * ⌘K as you type: each word a prefix ("warm sched" finds "warmup schedule"), titles first. No
 * snippet and no embedding, so it answers on every pause. Only letters and digits reach the query.
 */
export async function findItems(
  db: Queryable,
  client: string,
  q: string,
  limit = 6,
): Promise<Found[]> {
  const words =
    q
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 8) ?? [];
  if (!words.length) return [];
  const tsq = sql`to_tsquery('english', ${words.map((w) => `${w}:*`).join(" & ")})`;
  const like = `%${words.join("%")}%`;
  const inTitle = sql`${items.title} ilike ${like}`;
  return db
    .select({
      id: items.id,
      title: items.title,
      kind: items.kind,
      source: sql<string>`coalesce(${sources.name}, 'Saved')`,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        eq(items.client, client),
        isNull(items.archivedAt),
        sql`(${inTitle} or ${items.search} @@ ${tsq})`,
      ),
    )
    .orderBy(sql`${inTitle} desc`, sql`ts_rank(${items.search}, ${tsq}) desc`, desc(items.id))
    .limit(Math.min(Math.max(limit, 1), 20));
}

/** One item whole: its transcript, the SOPs it was asked into. Null for none. */
export async function itemOf(db: Queryable, client: string, id: number) {
  const [row] = await db
    .select({ item: items, source: sources.name })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(and(eq(items.id, id), eq(items.client, client)));
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
  client: string,
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
        eq(items.client, client),
        o.saved ? sql`${items.savedAt} is not null` : undefined,
        o.waiting ? sql`${items.readAt} is null and ${items.archivedAt} is null` : undefined,
      ),
    )
    .orderBy(sql`coalesce(${items.savedAt}, ${items.createdAt}) desc`, desc(items.id))
    .limit(o.limit ?? 30);
}
