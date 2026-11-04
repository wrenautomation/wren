/**
 * Items by hand: saving a link and one item whole. Each in one workspace (`client`): Wren's own
 * (`wren`) or a client's.
 */
import type { Db, Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { cleanUrl, kindOf, needsMac, typeOf, youtubeThumb } from "./links.js";
import { type ItemKind, items, type PostStats, sopSources, type Via } from "./schema.js";

export interface Saved {
  id: number;
  url: string;
  kind: ItemKind;
  /** First time this link came in. */
  fresh: boolean;
  /** It still has to be read (`wren learn read`). */
  unread: boolean;
}

/**
 * Save a link. The same link twice in a workspace is one item: a second save only marks it saved
 * again. One already read keeps its read, and comes back from done. `kind`
 * overrides what the link says: a launch film on YouTube is a `film`, not a `video`.
 */
export async function saveLink(
  db: Db,
  p: {
    client: string;
    url: string;
    by: string | null;
    via: Via;
    title?: string | null;
    kind?: ItemKind;
    /** Who made it, when the saver knows (a hunt's search result). */
    creator?: string | null;
    /** The saver's clock, when it has one (a hunt counts its day from it). */
    now?: Date;
    /** Its public numbers now, when the saver has them; a later read keeps them. */
    stats?: PostStats | null;
  },
): Promise<Saved> {
  const url = cleanUrl(p.url);
  const kind = p.kind ?? kindOf(url);
  const now = p.now ?? new Date();
  const [row] = await db
    .insert(items)
    .values({
      client: p.client,
      url,
      kind,
      type: typeOf(url, kind),
      thumbnailUrl: youtubeThumb(url),
      title: pgSafe(p.title?.trim() || url),
      creator: p.creator ? pgSafe(p.creator) : null,
      stats: p.stats ?? null,
      statsAt: p.stats ? now : null,
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
        creator: sql`coalesce(${items.creator}, ${p.creator ? pgSafe(p.creator) : null})`,
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

/** One item whole: its transcript, the SOPs it was asked into. Null for none. */
export async function itemOf(db: Queryable, client: string, id: number) {
  const [row] = await db
    .select({ item: items })
    .from(items)
    .where(and(eq(items.id, id), eq(items.client, client)));
  if (!row) return null;
  const sops = await db
    .select()
    .from(sopSources)
    .where(eq(sopSources.itemId, id))
    .orderBy(asc(sopSources.sop));
  return { ...row.item, sops };
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
    })
    .from(items)
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
