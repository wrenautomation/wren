/**
 * The hunt (designs/2026-10-25-competitor-analyzer.md, Hunt): nobody scrolls a platform for an
 * SOP's examples. `wren sop hunt <name>` reads the scope in the SOP's notes front matter and seeds
 * Learn with candidates for it: the followed creators the `set` names (a YouTube channel's items
 * the feed archived as seen are taken back; an Instagram or TikTok profile is walked like
 * `learn catalog`), then the `topic` searched on YouTube by yt-dlp (one search per phrase, merged,
 * most viewed first). Each candidate is saved with the SOP's kind and tagged with the SOP's name, and
 * a day's cap stops the flood. The Mac's reader and `learn breakdown` do the rest; the pieces reach
 * his "To call" queue ranked by reach. Thin orchestration: no new reader.
 */
import type { Db } from "@wren/db";
import { flatPlaylist, type YtDlpEntry } from "@wrenautomation/weaver/video";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { type CatalogReader, readCatalog } from "./catalog.js";
import { isCreatorKind, statsOf } from "./creators.js";
import { tagItems, tagOf } from "./drive.js";
import { IN_FEED_BEFORE } from "./feeds.js";
import { saveLink } from "./items.js";
import { cleanUrl } from "./links.js";
import { ITEM_KINDS, type ItemKind, items, itemTags, sources } from "./schema.js";
import type { SopScope } from "./standard.js";

/** One search result, before it is an item. */
export interface Find {
  url: string;
  title: string;
  creator: string | null;
  views: number | null;
  publishedAt: Date | null;
  duration: number | null;
}

/** A topic searched on a platform: the finds, most relevant first as the platform ranks them. */
export type TopicSearch = (query: string, n: number) => Promise<Find[]>;

/** Candidates a hunt saves a day, per SOP: what he can call on in a sitting. */
export const HUNT_CAP = 10;
/** Finds one search asks for: the cap several times over, so the most viewed are a real pick. */
export const HUNT_PER_QUERY = 30;

/** yt-dlp's `ytsearchN:` as a `TopicSearch`: no API key, no quota, the home IP. Mac only. */
export const youtubeSearch =
  (ytDlp: string): TopicSearch =>
  async (query, n) =>
    (await flatPlaylist(ytDlp, `ytsearch${n}:${query}`)).map(findOf);

const findOf = (e: YtDlpEntry): Find => ({
  url: cleanUrl(e.webpage_url ?? e.url ?? `https://www.youtube.com/watch?v=${e.id}`),
  title: (e.title ?? "").trim() || `${e.channel ?? e.uploader ?? "video"} ${e.id}`,
  creator: e.channel ?? e.uploader ?? null,
  views: statsOf({ views: e.view_count })?.views ?? null,
  publishedAt: e.timestamp ? new Date(e.timestamp * 1000) : null,
  duration: e.duration ? Math.round(e.duration) : null,
});

/** `topic` as its phrases: "launch film, product film" is two searches, not one noisy one. */
export const phrasesOf = (topic: string): string[] => [
  ...new Set(
    topic
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  ),
];

/** Several searches' finds as one list: each link once, the most viewed first, unknown views last. */
export function rankFinds(lists: readonly Find[][]): Find[] {
  const byUrl = new Map<string, Find>();
  for (const f of lists.flat()) {
    const had = byUrl.get(f.url);
    if (!had || (f.views ?? -1) > (had.views ?? -1)) byUrl.set(f.url, f);
  }
  return [...byUrl.values()].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
}

export interface Hunt {
  /** The tag every candidate carries: the SOP's name. */
  tag: string;
  cap: number;
  /** Candidates saved for this SOP in the last day before this hunt. */
  before: number;
  /** A followed creator's items the feed had archived as seen, taken back. */
  revived: number[];
  /** Instagram and TikTok creators walked, with what each queued. */
  walked: { creator: string; queued: number }[];
  /** Set names Learn follows nothing for. */
  unfollowed: string[];
  searched: string[];
  found: number;
  /** Finds Learn already had, left as they are (an archive stays archived). */
  known: number;
  saved: number[];
  /** Room under the cap after this hunt. */
  left: number;
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * Seed Learn with candidates for one SOP. The set's followed creators first (what he already
 * trusts), then the topic's search, until `cap` candidates in the last day. Candidates Learn
 * already has are skipped, never un-archived: his archive is his call.
 */
export async function huntSop(
  db: Db,
  o: {
    client: string;
    name: string;
    scope: SopScope;
    search: TopicSearch;
    /** Instagram and TikTok profiles paged; null where the hunt runs with no desk. */
    catalog: CatalogReader | null;
    cap?: number;
    perQuery?: number;
    now?: Date;
  },
): Promise<Hunt> {
  const tag = tagOf(o.name);
  if (!tag) throw new Error("An SOP name is lowercase letters, digits and dashes");
  const now = o.now ?? new Date();
  const cap = o.cap ?? HUNT_CAP;
  const since = new Date(now.getTime() - DAY_MS);
  const kind = kindFor(o.scope);
  const [{ before }] = (await db
    .select({ before: sql<number>`count(*)::int` })
    .from(items)
    .innerJoin(itemTags, eq(itemTags.itemId, items.id))
    .where(and(eq(items.client, o.client), eq(itemTags.tag, tag), gte(items.savedAt, since)))) as [
    { before: number },
  ];
  const out: Hunt = {
    tag,
    cap,
    before,
    revived: [],
    walked: [],
    unfollowed: [],
    searched: [],
    found: 0,
    known: 0,
    saved: [],
    left: Math.max(cap - before, 0),
  };
  const take = async (ids: number[]) => {
    if (!ids.length) return;
    await tagItems(db, o.client, ids, { add: [tag] });
    out.left = Math.max(out.left - ids.length, 0);
  };

  // 1. The set's followed creators.
  if (o.scope.set.length) {
    const followed = await db
      .select({
        id: sources.id,
        name: sources.name,
        kind: sources.kind,
        url: sources.url,
        page: sources.page,
      })
      .from(sources)
      .where(
        and(
          eq(sources.client, o.client),
          isNull(sources.stoppedAt),
          inArray(sql`lower(${sources.name})`, o.scope.set),
        ),
      );
    const byName = new Map(followed.map((s) => [s.name.toLowerCase(), s]));
    for (const name of o.scope.set) {
      const s = byName.get(name);
      if (!s) {
        out.unfollowed.push(name);
        continue;
      }
      if (out.left <= 0) break;
      if (isCreatorKind(s.kind)) {
        if (!o.catalog) continue;
        const pass = await readCatalog(db, o.catalog, {
          client: o.client,
          url: s.page ?? s.url,
          want: out.left,
          now,
        });
        const ids = [...pass.revived, ...pass.queued];
        out.walked.push({ creator: pass.creator, queued: ids.length });
        await take(ids);
        continue;
      }
      // A feed's: what it held when followed sits archived as seen; the newest come back as candidates.
      const seen = await db
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.client, o.client),
            eq(items.sourceId, s.id),
            eq(items.why, IN_FEED_BEFORE),
            isNull(items.readAt),
            isNull(items.needsMac),
          ),
        )
        .orderBy(desc(items.publishedAt), desc(items.id))
        .limit(out.left);
      const ids = seen.map((r) => r.id);
      if (ids.length)
        await db
          .update(items)
          .set({
            archivedAt: null,
            why: null,
            needsMac: now,
            savedAt: now,
            savedVia: "cli",
            ...(kind ? { kind, type: sql`${items.type}` } : {}),
          })
          .where(inArray(items.id, ids));
      out.revived.push(...ids);
      await take(ids);
    }
  }

  // 2. The topic, searched. YouTube by yt-dlp; another platform's search when an SOP there needs it.
  const youtube = !o.scope.platforms.length || o.scope.platforms.includes("youtube");
  const phrases = youtube ? phrasesOf(o.scope.topic) : [];
  if (phrases.length && out.left > 0) {
    out.searched = phrases;
    const n = o.perQuery ?? HUNT_PER_QUERY;
    const finds = rankFinds(await Promise.all(phrases.map((q) => o.search(q, n))));
    out.found = finds.length;
    const had = finds.length
      ? await db
          .select({ url: items.url })
          .from(items)
          .where(
            and(
              eq(items.client, o.client),
              inArray(
                items.url,
                finds.map((f) => f.url),
              ),
            ),
          )
      : [];
    const known = new Set(had.map((h) => h.url));
    for (const f of finds) {
      if (out.left <= 0) break;
      if (known.has(f.url)) {
        out.known++;
        continue;
      }
      const saved = await saveLink(db, {
        client: o.client,
        now,
        url: f.url,
        by: null,
        via: "cli",
        title: f.title,
        creator: f.creator,
        stats: f.views === null ? null : { views: f.views },
        worth: false,
        ...(kind ? { kind } : {}),
      });
      if (f.publishedAt || f.duration)
        await db
          .update(items)
          .set({
            publishedAt: sql`coalesce(${items.publishedAt}, ${f.publishedAt?.toISOString() ?? null}::timestamptz)`,
            duration: sql`coalesce(${items.duration}, ${f.duration})`,
          })
          .where(eq(items.id, saved.id));
      out.saved.push(saved.id);
      await take([saved.id]);
    }
  }
  return out;
}

/** The kind every candidate gets when the scope names one; several, and the link decides. */
function kindFor(scope: SopScope): ItemKind | null {
  const [k, ...rest] = scope.kinds;
  if (!k || rest.length) return null;
  return (ITEM_KINDS as readonly string[]).includes(k) ? (k as ItemKind) : null;
}

/** Ids the hunt touched, for the reader: new saves first (they have numbers), then revived. */
export const huntedIds = (h: Hunt): number[] => [...h.saved, ...h.revived];
