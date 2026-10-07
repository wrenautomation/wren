/**
 * The drive: every item as something to watch, hear or read, organized like files. Places
 * (Inbox, Watch later, Starred, Saved, Archive, a collection, a source), filters by type and
 * source, sorts, collections that nest like folders, tags, and where you left off.
 */
import type { Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import {
  collections,
  type ItemType,
  items,
  itemTags,
  type Moment,
  SOURCE_KINDS,
  type SourceKind,
  sopSources,
  sources,
  TYPES,
} from "./schema.js";
import { chaptersOf } from "./score.js";

/** Where a list looks: a place in the rail, a collection (`c12`) or a source (`s4`). */
export const PLACES = ["inbox", "all", "later", "starred", "saved", "archived"] as const;
export type Place = (typeof PLACES)[number] | `c${number}` | `s${number}`;
export const SORTS = ["newest", "score", "length", "source", "title"] as const;
export type Sort = (typeof SORTS)[number];
/** What a mark sets on items. */
export const MARKS = [
  "star",
  "unstar",
  "pin",
  "unpin",
  "later",
  "unlater",
  "archive",
  "unarchive",
  "read",
  "unread",
] as const;
export type Mark = (typeof MARKS)[number];

/** Seconds from the end that count as finished. */
const DONE_TAIL = 30;
const PAGE = 60;

/** One item as a card: everything the feed, list and compact views show. */
export interface Card {
  id: number;
  title: string;
  type: ItemType;
  url: string;
  thumbnail: string | null;
  /** Seconds, for video and audio. */
  duration: number | null;
  /** Characters of text, for a read time. */
  chars: number;
  source: { id: number; name: string; kind: SourceKind; avatar: string | null } | null;
  creator: string | null;
  score: number | null;
  summary: string | null;
  /** unread, read or archived. */
  status: "unread" | "read" | "archived";
  /** Where it is in Learn's pipeline: ready once scored. */
  state: "reading" | "failed" | "mac" | "scoring" | "ready";
  starred: boolean;
  pinned: boolean;
  later: boolean;
  /** Seconds in, to resume. */
  position: number | null;
  collectionId: number | null;
  tags: string[];
  saved: boolean;
  at: string;
}

// A subquery names its outer table in full: drizzle drops the table from a lone table's columns.
const tagsOf = sql<
  string[]
>`coalesce((select array_agg(t.tag order by t.tag) from learn.item_tags t where t.item_id = "items"."id"), '{}')`;

const cardCols = {
  id: items.id,
  title: items.title,
  type: items.type,
  url: items.url,
  thumbnail: items.thumbnailUrl,
  duration: items.duration,
  chars: sql<number>`coalesce(length(coalesce(${items.transcript}, ${items.text})), 0)::int`,
  sourceId: sources.id,
  sourceName: sources.name,
  sourceKind: sources.kind,
  sourceAvatar: sources.avatarUrl,
  creator: items.creator,
  score: items.score,
  summary: items.summary,
  archivedAt: items.archivedAt,
  openedAt: items.openedAt,
  readAt: items.readAt,
  readFailure: items.readFailure,
  needsMac: items.needsMac,
  verdict: items.verdict,
  starredAt: items.starredAt,
  pinnedAt: items.pinnedAt,
  laterAt: items.laterAt,
  position: items.position,
  collectionId: items.collectionId,
  tags: tagsOf,
  savedAt: items.savedAt,
  at: sql<string>`coalesce(${items.publishedAt}, ${items.createdAt})`,
};

const cards = (db: Queryable) =>
  db.select(cardCols).from(items).leftJoin(sources, eq(sources.id, items.sourceId));
type CardRow = Awaited<ReturnType<typeof cards>>[number];

function cardOf(r: CardRow): Card {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    url: r.url,
    thumbnail: r.thumbnail,
    duration: r.duration,
    chars: Number(r.chars),
    source:
      r.sourceId !== null && r.sourceName !== null && r.sourceKind !== null
        ? { id: r.sourceId, name: r.sourceName, kind: r.sourceKind, avatar: r.sourceAvatar }
        : null,
    creator: r.creator,
    score: r.score,
    summary: r.summary,
    status: r.archivedAt ? "archived" : r.openedAt ? "read" : "unread",
    state: r.readAt
      ? r.verdict
        ? "ready"
        : "scoring"
      : r.readFailure
        ? "failed"
        : r.needsMac
          ? "mac"
          : "reading",
    starred: !!r.starredAt,
    pinned: !!r.pinnedAt,
    later: !!r.laterAt,
    position: r.position,
    collectionId: r.collectionId,
    tags: r.tags ?? [],
    saved: !!r.savedAt,
    at: new Date(r.at).toISOString(),
  };
}

/** New and worth a look: not opened, not archived, not dropped by the scorer. */
const fresh = sql`${items.archivedAt} is null and ${items.openedAt} is null
  and (${items.savedAt} is not null or ${items.verdict} is null or ${items.verdict} <> 'drop')`;

/** A place as a filter; null for a place that isn't one. */
export function placeWhere(place: string): SQL | undefined | null {
  const live = isNull(items.archivedAt);
  switch (place) {
    case "inbox":
      return fresh;
    case "all":
      return live;
    case "later":
      return and(live, isNotNull(items.laterAt));
    case "starred":
      return isNotNull(items.starredAt);
    case "saved":
      return and(live, isNotNull(items.savedAt));
    case "archived":
      return isNotNull(items.archivedAt);
  }
  const m = /^([cs])(\d{1,9})$/.exec(place);
  if (!m) return null;
  const id = Number(m[2]);
  return m[1] === "c" ? and(live, eq(items.collectionId, id)) : and(live, eq(items.sourceId, id));
}

const ORDER: Record<Sort, SQL[]> = {
  newest: [sql`coalesce(${items.publishedAt}, ${items.createdAt}) desc`],
  score: [sql`${items.score} desc nulls last`],
  length: [
    sql`${items.duration} desc nulls last`,
    sql`length(coalesce(${items.transcript}, ${items.text})) desc nulls last`,
  ],
  source: [sql`coalesce(${sources.name}, 'Saved') asc`],
  title: [sql`lower(${items.title}) asc`],
};

export interface Browse {
  place?: string | null | undefined;
  types?: string[] | null | undefined;
  sources?: (string | number)[] | null | undefined;
  tag?: string | null | undefined;
  q?: string | null | undefined;
  sort?: string | null | undefined;
  offset?: number | null | undefined;
  limit?: number | null | undefined;
}

/**
 * A page of cards in a place, filtered and sorted, pinned first. Counts are by type and by source
 * in the place before those filters, so a chip shows what picking it would leave.
 */
export async function browse(db: Queryable, b: Browse) {
  const place = b.place || "inbox";
  const where = placeWhere(place);
  if (where === null) throw new Error(`no such place: ${place}`);
  const types = (b.types ?? []).filter((t): t is ItemType =>
    (TYPES as readonly string[]).includes(t),
  );
  const sourceIds = (b.sources ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  const q = b.q?.trim();
  const tag = b.tag?.trim();
  const base = and(
    where,
    q ? sql`${items.search} @@ websearch_to_tsquery('english', ${q})` : undefined,
    tag
      ? sql`exists (select 1 from learn.item_tags t where t.item_id = "items"."id" and t.tag = ${tag})`
      : undefined,
  );
  const sort: Sort = (SORTS as readonly string[]).includes(b.sort ?? "")
    ? (b.sort as Sort)
    : "newest";
  const limit = Math.min(Math.max(b.limit ?? PAGE, 1), 200);
  const offset = Math.max(b.offset ?? 0, 0);
  const picked = and(
    base,
    types.length ? inArray(items.type, types) : undefined,
    sourceIds.length ? inArray(items.sourceId, sourceIds) : undefined,
  );
  const [rows, byType, bySource, [total]] = await Promise.all([
    cards(db)
      .where(picked)
      .orderBy(sql`${items.pinnedAt} is null`, ...ORDER[sort], desc(items.id))
      .limit(limit + 1)
      .offset(offset),
    db
      .select({ type: items.type, n: sql<number>`count(*)::int` })
      .from(items)
      .where(and(base, sourceIds.length ? inArray(items.sourceId, sourceIds) : undefined))
      .groupBy(items.type),
    db
      .select({
        id: sources.id,
        name: sources.name,
        kind: sources.kind,
        avatar: sources.avatarUrl,
        n: sql<number>`count(*)::int`,
      })
      .from(items)
      .innerJoin(sources, eq(sources.id, items.sourceId))
      .where(and(base, types.length ? inArray(items.type, types) : undefined))
      .groupBy(sources.id)
      .orderBy(sql`count(*) desc`, asc(sources.name))
      .limit(40),
    db.select({ n: sql<number>`count(*)::int` }).from(items).where(picked),
  ]);
  return {
    place,
    sort,
    items: rows.slice(0, limit).map(cardOf),
    more: rows.length > limit,
    total: Number(total?.n ?? 0),
    types: Object.fromEntries(byType.map((r) => [r.type, Number(r.n)])) as Partial<
      Record<ItemType, number>
    >,
    sources: bySource.map((r) => ({ ...r, n: Number(r.n) })),
  };
}

/** The rail: counts per place, the collections tree, sources by kind, tags. */
export async function rail(db: Queryable) {
  const count = (w: SQL | undefined) => sql<number>`(count(*) filter (where ${w}))::int`;
  const [[places], folders, srcs, tags] = await Promise.all([
    db
      .select({
        inbox: count(fresh),
        all: count(isNull(items.archivedAt)),
        later: count(and(isNull(items.archivedAt), isNotNull(items.laterAt))),
        starred: count(isNotNull(items.starredAt)),
        saved: count(and(isNull(items.archivedAt), isNotNull(items.savedAt))),
        archived: count(isNotNull(items.archivedAt)),
      })
      .from(items),
    db
      .select({
        id: collections.id,
        name: collections.name,
        parentId: collections.parentId,
        n: sql<number>`(select count(*) from learn.items i where i.collection_id = "collections"."id" and i.archived_at is null)::int`,
      })
      .from(collections)
      .orderBy(asc(sql`lower(${collections.name})`)),
    db
      .select({
        id: sources.id,
        name: sources.name,
        kind: sources.kind,
        avatar: sources.avatarUrl,
        stopped: sql<boolean>`${sources.stoppedAt} is not null`,
        failure: sources.failure,
        fresh: sql<number>`(select count(*) from learn.items i where i.source_id = "sources"."id" and i.archived_at is null and i.opened_at is null and (i.verdict is null or i.verdict <> 'drop'))::int`,
      })
      .from(sources)
      .orderBy(asc(sql`lower(${sources.name})`)),
    db
      .select({ tag: itemTags.tag, n: sql<number>`count(*)::int` })
      .from(itemTags)
      .groupBy(itemTags.tag)
      .orderBy(asc(itemTags.tag)),
  ]);
  return {
    places: places ?? { inbox: 0, all: 0, later: 0, starred: 0, saved: 0, archived: 0 },
    collections: folders.map((c) => ({ ...c, n: Number(c.n) })),
    sources: SOURCE_KINDS.map((kind) => ({
      kind,
      sources: srcs.filter((s) => s.kind === kind).map((s) => ({ ...s, fresh: Number(s.fresh) })),
    })).filter((g) => g.sources.length),
    tags: tags.map((t) => ({ ...t, n: Number(t.n) })),
  };
}

const WEEK_MS = 7 * 24 * 3600_000;
const SHELF = 10;

/**
 * The home page: new from your sources, one shelf per type; what you were watching; this
 * week's best; and what went into SOPs lately.
 */
export async function home(db: Queryable, now = new Date()) {
  const [counts, going, top, sops] = await Promise.all([
    db
      .select({ type: items.type, n: sql<number>`count(*)::int` })
      .from(items)
      .where(fresh)
      .groupBy(items.type),
    cards(db)
      .where(
        and(
          isNull(items.archivedAt),
          sql`${items.position} > 0`,
          sql`(${items.duration} is null or ${items.position} < ${items.duration} - ${DONE_TAIL})`,
        ),
      )
      .orderBy(desc(items.playedAt))
      .limit(SHELF),
    cards(db)
      .where(
        and(
          isNull(items.archivedAt),
          isNotNull(items.score),
          sql`coalesce(${items.publishedAt}, ${items.createdAt}) > ${new Date(now.getTime() - WEEK_MS).toISOString()}`,
        ),
      )
      .orderBy(desc(items.score), desc(items.id))
      .limit(SHELF),
    db
      .select({
        id: sopSources.id,
        sop: sopSources.sop,
        state: sopSources.state,
        error: sopSources.error,
        itemId: sopSources.itemId,
        title: items.title,
        type: items.type,
        at: sql<string>`coalesce(${sopSources.doneAt}, ${sopSources.askedAt})`,
      })
      .from(sopSources)
      .innerJoin(items, eq(items.id, sopSources.itemId))
      .orderBy(sql`coalesce(${sopSources.doneAt}, ${sopSources.askedAt}) desc`)
      .limit(8),
  ]);
  const live = TYPES.filter((t) => counts.some((c) => c.type === t));
  const shelves = await Promise.all(
    live.map(async (type) => ({
      type,
      total: Number(counts.find((c) => c.type === type)?.n ?? 0),
      items: (
        await cards(db)
          .where(and(fresh, eq(items.type, type)))
          .orderBy(sql`coalesce(${items.publishedAt}, ${items.createdAt}) desc`, desc(items.id))
          .limit(SHELF)
      ).map(cardOf),
    })),
  );
  return {
    shelves,
    continue: going.map(cardOf),
    top: top.map(cardOf),
    sops: sops.map((s) => ({ ...s, at: new Date(s.at).toISOString() })),
  };
}

/** One item whole, for its page: the card, its text, moments, SOPs and neighbors. */
export async function itemPage(db: Queryable, id: number) {
  const [row] = await cards(db).where(eq(items.id, id));
  if (!row) return null;
  const [[whole], sops, folder] = await Promise.all([
    db
      .select({
        text: items.text,
        transcript: items.transcript,
        file: items.file,
        mediaUrl: items.mediaUrl,
        moments: items.moments,
        why: items.why,
        changes: items.changes,
        verdict: items.verdict,
        readFailure: items.readFailure,
        kind: items.kind,
        sourceUrl: sources.page,
      })
      .from(items)
      .leftJoin(sources, eq(sources.id, items.sourceId))
      .where(eq(items.id, id)),
    db.select().from(sopSources).where(eq(sopSources.itemId, id)).orderBy(asc(sopSources.sop)),
    row.collectionId
      ? db
          .select({ id: collections.id, name: collections.name })
          .from(collections)
          .where(eq(collections.id, row.collectionId))
      : Promise.resolve([]),
  ]);
  const moments: Moment[] = whole?.moments?.length
    ? whole.moments
    : chaptersOf(whole?.transcript ?? null);
  return {
    ...cardOf(row),
    text: whole?.text ?? "",
    transcript: whole?.transcript ?? null,
    file: whole?.file ?? null,
    mediaUrl: whole?.mediaUrl ?? null,
    moments,
    why: whole?.why ?? null,
    changes: whole?.changes ?? [],
    verdict: whole?.verdict ?? null,
    failure: whole?.readFailure ?? null,
    kind: whole?.kind ?? "article",
    collection: folder[0] ?? null,
    sops,
  };
}

/** Set a mark on items; the ids it changed. */
export async function mark(db: Queryable, ids: number[], m: Mark): Promise<number[]> {
  const now = new Date();
  const set: Partial<typeof items.$inferInsert> = {
    star: { starredAt: now },
    unstar: { starredAt: null },
    pin: { pinnedAt: now },
    unpin: { pinnedAt: null },
    later: { laterAt: now },
    unlater: { laterAt: null },
    archive: { archivedAt: now, laterAt: null },
    unarchive: { archivedAt: null },
    read: { openedAt: now },
    unread: { openedAt: null },
  }[m];
  // Setting a mark that's already set leaves its time alone.
  const unset = {
    star: isNull(items.starredAt),
    pin: isNull(items.pinnedAt),
    later: isNull(items.laterAt),
    archive: isNull(items.archivedAt),
    read: isNull(items.openedAt),
  } as Partial<Record<Mark, SQL>>;
  const rows = await db
    .update(items)
    .set(set)
    .where(and(inArray(items.id, ids), unset[m]))
    .returning({ id: items.id });
  return rows.map((r) => r.id);
}

/** Opened: no longer new. */
export async function opened(db: Queryable, id: number): Promise<void> {
  await db
    .update(items)
    .set({ openedAt: new Date() })
    .where(and(eq(items.id, id), isNull(items.openedAt)));
}

/** Where playback is, to resume; learns the length when the item didn't say. */
export async function progress(
  db: Queryable,
  p: { id: number; position: number; duration?: number | null | undefined },
): Promise<void> {
  const position = Math.max(0, Math.round(p.position));
  const duration = p.duration && p.duration > 0 ? Math.round(p.duration) : null;
  await db
    .update(items)
    .set({
      position,
      playedAt: new Date(),
      openedAt: sql`coalesce(${items.openedAt}, now())`,
      ...(duration ? { duration: sql`coalesce(${items.duration}, ${duration})` } : {}),
    })
    .where(eq(items.id, p.id));
}

/** Move items into a collection, or out of every one (null); the ids moved. */
export async function moveItems(
  db: Queryable,
  ids: number[],
  collectionId: number | null,
): Promise<number[]> {
  if (collectionId !== null) {
    const [c] = await db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.id, collectionId));
    if (!c) throw new Error("no such collection");
  }
  const rows = await db
    .update(items)
    .set({ collectionId })
    .where(inArray(items.id, ids))
    .returning({ id: items.id });
  return rows.map((r) => r.id);
}

/** A tag as kept: trimmed, lower case, spaces as dashes, 40 characters at most. */
export function tagOf(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 40);
}

/** Add and remove tags on items. */
export async function tagItems(
  db: Queryable,
  ids: number[],
  p: { add?: string[]; remove?: string[] },
): Promise<void> {
  const add = [...new Set((p.add ?? []).map(tagOf).filter(Boolean))];
  const remove = [...new Set((p.remove ?? []).map(tagOf).filter(Boolean))];
  if (add.length)
    await db
      .insert(itemTags)
      .values(ids.flatMap((itemId) => add.map((tag) => ({ itemId, tag }))))
      .onConflictDoNothing();
  if (remove.length)
    await db
      .delete(itemTags)
      .where(and(inArray(itemTags.itemId, ids), inArray(itemTags.tag, remove)));
}

const nameOf = (raw: string | null | undefined): string => {
  const name = pgSafe(raw?.trim() ?? "").slice(0, 80);
  if (!name) throw new Error("a name");
  return name;
};

/** A new collection, at the top or inside another. */
export async function addCollection(
  db: Queryable,
  p: { name: string; parentId?: number | null; by?: string | null },
) {
  const [row] = await db
    .insert(collections)
    .values({ name: nameOf(p.name), parentId: p.parentId ?? null, by: p.by ?? null })
    .returning();
  if (!row) throw new Error("no row");
  return row;
}

/** Rename a collection or move it under another; never under itself or its own children. */
export async function editCollection(
  db: Queryable,
  p: { id: number; name?: string | null | undefined; parentId?: number | null },
) {
  const set: Partial<typeof collections.$inferInsert> = {};
  if (p.name !== undefined && p.name !== null) set.name = nameOf(p.name);
  if (p.parentId !== undefined) {
    if (p.parentId !== null) {
      const chain = await db.execute<{ id: number }>(sql`
        with recursive up as (
          select id, parent_id from learn.collections where id = ${p.parentId}
          union all
          select c.id, c.parent_id from learn.collections c join up on c.id = up.parent_id)
        select id from up`);
      if (!chain.length) throw new Error("no such collection");
      if (chain.some((r) => Number(r.id) === p.id))
        throw new Error("a collection can't go inside itself");
    }
    set.parentId = p.parentId;
  }
  const [row] = await db.update(collections).set(set).where(eq(collections.id, p.id)).returning();
  if (!row) throw new Error("no such collection");
  return row;
}

/** Delete a collection and the ones inside it; their items stay, out of any collection. */
export async function dropCollection(db: Queryable, id: number): Promise<boolean> {
  const rows = await db
    .delete(collections)
    .where(eq(collections.id, id))
    .returning({ id: collections.id });
  return rows.length > 0;
}

/** Every source, grouped by kind, with what each brought and when. */
export async function sourcesByKind(db: Queryable) {
  const rows = await db
    .select({
      id: sources.id,
      name: sources.name,
      url: sources.url,
      page: sources.page,
      kind: sources.kind,
      avatar: sources.avatarUrl,
      tell: sources.tell,
      failure: sources.failure,
      stopped: sql<boolean>`${sources.stoppedAt} is not null`,
      fetchedAt: sources.fetchedAt,
      items: sql<number>`(select count(*) from learn.items i where i.source_id = "sources"."id")::int`,
      fresh: sql<number>`(select count(*) from learn.items i where i.source_id = "sources"."id" and i.archived_at is null and i.opened_at is null and (i.verdict is null or i.verdict <> 'drop'))::int`,
      top: sql<
        number | null
      >`(select max(i.score) from learn.items i where i.source_id = "sources"."id")::int`,
      last: sql<
        string | null
      >`(select max(coalesce(i.published_at, i.created_at)) from learn.items i where i.source_id = "sources"."id")`,
    })
    .from(sources)
    .orderBy(asc(sql`lower(${sources.name})`));
  return SOURCE_KINDS.map((kind) => ({
    kind,
    sources: rows
      .filter((r) => r.kind === kind)
      .map((r) => ({
        ...r,
        items: Number(r.items),
        fresh: Number(r.fresh),
        last: r.last ? new Date(r.last).toISOString() : null,
      })),
  }));
}
