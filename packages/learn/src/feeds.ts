/**
 * The sources Learn follows: RSS and Atom only. YouTube channels, Substacks, blogs, podcasts,
 * Reddit, HN and GitHub releases all publish one. Follow takes the feed or a page that names its
 * feed (`<link rel="alternate">`), so a channel's or a blog's address is enough. The Monitor's
 * pass reads each source hourly and keeps new items before anything reads them, so a pass that
 * dies loses nothing.
 */
import { decodeHtml } from "@wren/core/html";
import type { SpineEvent } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { cleanUrl, creatorSite, kindOf, typeOf, youtubeThumb } from "./links.js";
import { items, type SourceKind, sources, type Tell } from "./schema.js";

export interface FeedItem {
  url: string;
  title: string;
  text: string;
  publishedAt: Date | null;
  /** Who made it, when the feed says. */
  creator: string | null;
  /** The audio file the item carries: a podcast's episode. */
  enclosure: string | null;
  /** Its picture: media:thumbnail, an image media:content, itunes:image. */
  thumbnail: string | null;
  /** Seconds long, when the feed says: itunes:duration, media:content's duration. */
  duration: number | null;
}

export interface Feed {
  title: string;
  /** A podcast's: its items carry audio. */
  podcast: boolean;
  /** The feed's own picture: a podcast's artwork, a channel's image, an Atom icon. */
  image: string | null;
  /** What wrote it, when it says ("Substack"). */
  generator: string;
  items: FeedItem[];
}

/** Text kept per feed item. */
const KEEP_TEXT = 20_000;
/** A source is read at most this often, whatever the Monitor's pace. */
export const FEED_EVERY_MS = 60 * 60_000;

export const decode = decodeHtml;

/** An element's text as plain words: CDATA unwrapped, escaped HTML read, tags dropped. */
export function plain(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  const html = cdata ? (cdata[1] ?? "") : decode(raw);
  return decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const tagRe = (tag: string) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
const first = (block: string, tags: readonly string[]): string => {
  for (const t of tags) {
    const m = tagRe(t).exec(block);
    if (m?.[1]?.trim()) return m[1];
  }
  return "";
};
const attr = (a: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(a)?.[1];

/** Atom's alternate link (or its only one), else RSS's `<link>` text, else a permalink guid. */
function linkOf(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1] ?? "");
  const alt = links.find((a) => attr(a, "href") && (attr(a, "rel") ?? "alternate") === "alternate");
  const href = alt ? attr(alt, "href") : undefined;
  if (href) return decode(href).trim();
  const text = plain(first(block, ["link"]));
  if (/^https?:\/\//.test(text)) return text;
  const guid = plain(first(block, ["guid", "id"]));
  return /^https?:\/\//.test(guid) ? guid : "";
}

function dateOf(block: string): Date | null {
  const s = plain(first(block, ["pubDate", "published", "dc:date", "updated"]));
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

const AUDIO = /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i;

/** The item's audio enclosure; a video or image enclosure isn't one. */
function enclosureOf(block: string): string | null {
  for (const m of block.matchAll(/<enclosure\b([^>]*?)\/?>/gi)) {
    const a = m[1] ?? "";
    const url = attr(a, "url");
    if (!url) continue;
    const type = attr(a, "type") ?? "";
    if (/^audio\//i.test(type) || (!type && AUDIO.test(url))) return httpsOr(decode(url).trim());
  }
  return null;
}

/** An https address, or null: the app loads nothing over http. */
const httpsOr = (url: string | undefined | null): string | null => {
  const u = url?.trim();
  if (!u) return null;
  if (u.startsWith("https://")) return u;
  return u.startsWith("http://") ? `https://${u.slice(7)}` : null;
};

/** The item's picture: a thumbnail, an image media:content or enclosure, an itunes:image. */
function thumbnailOf(block: string): string | null {
  const thumb = /<media:thumbnail\b([^>]*?)\/?>/i.exec(block);
  if (thumb && attr(thumb[1] ?? "", "url"))
    return httpsOr(decode(attr(thumb[1] ?? "", "url") ?? ""));
  for (const m of block.matchAll(/<(media:content|enclosure)\b([^>]*?)\/?>/gi)) {
    const a = m[2] ?? "";
    const url = attr(a, "url");
    if (url && (/^image\//i.test(attr(a, "type") ?? "") || attr(a, "medium") === "image"))
      return httpsOr(decode(url));
  }
  const itunes = /<itunes:image\b([^>]*?)\/?>/i.exec(block);
  return itunes ? httpsOr(decode(attr(itunes[1] ?? "", "href") ?? "")) : null;
}

/** "1:02:03", "12:34" or "754" as seconds; null for anything else. */
export function secondsOf(raw: string): number | null {
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s)) || null;
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) || null;
}

function durationOf(block: string): number | null {
  const itunes = plain(first(block, ["itunes:duration"]));
  if (itunes) return secondsOf(itunes);
  const media = /<media:content\b([^>]*?)\/?>/i.exec(block);
  const d = media ? attr(media[1] ?? "", "duration") : undefined;
  return d ? secondsOf(d) : null;
}

/** The feed's own picture, from its head. */
function imageOf(head: string): string | null {
  const itunes = /<itunes:image\b([^>]*?)\/?>/i.exec(head);
  const href = itunes ? attr(itunes[1] ?? "", "href") : undefined;
  if (href) return httpsOr(decode(href));
  const rss = /<image\b[^>]*>([\s\S]*?)<\/image>/i.exec(head);
  const url = rss ? plain(first(rss[1] ?? "", ["url"])) : "";
  if (url) return httpsOr(url);
  return httpsOr(plain(first(head, ["logo", "icon"])));
}

/** A link we can keep, or "" for one that isn't a web address. */
const cleanOr = (url: string) => {
  try {
    return cleanUrl(url);
  } catch {
    return "";
  }
};

/** An RSS or Atom document's items, in feed order; items with no link are dropped. */
export function parseFeed(xml: string): Feed {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(
    (m) => m[2] ?? "",
  );
  const head = xml.split(/<(?:item|entry)\b/i)[0] ?? "";
  const found = blocks
    .map((b): FeedItem => {
      const texts = ["content:encoded", "content", "media:description", "description", "summary"]
        .map((t) => plain(first(b, [t])))
        .sort((x, y) => y.length - x.length);
      const author = plain(first(b, ["dc:creator", "itunes:author", "name", "author"]));
      return {
        url: cleanOr(linkOf(b)),
        title: plain(first(b, ["title"])) || "(untitled)",
        text: (texts[0] ?? "").slice(0, KEEP_TEXT),
        publishedAt: dateOf(b),
        creator: author || null,
        enclosure: enclosureOf(b),
        thumbnail: thumbnailOf(b),
        duration: durationOf(b),
      };
    })
    .filter((i) => i.url);
  const podcast = /xmlns:itunes=|<itunes:/i.test(head) && found.some((i) => i.enclosure);
  return {
    title: plain(first(head, ["title"])),
    podcast,
    image: imageOf(head),
    generator: plain(first(head, ["generator"])),
    items: found,
  };
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const HEADERS = {
  // Reddit refuses a bare client; say who reads.
  "user-agent": "wren-learn/1.0 (+https://wrenautomation.com)",
  accept:
    "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
};

async function get(fetchFn: FetchFn, url: string): Promise<string> {
  const res = await fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const isFeed = (body: string) => /<(rss|feed|rdf:RDF)\b/i.test(body.slice(0, 2000));

/** The feed a page names in its head: `<link rel="alternate" type="application/rss+xml">`. */
export function feedLinkOf(html: string, base: string): string | null {
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const a = m[1] ?? "";
    if (!/\balternate\b/i.test(attr(a, "rel") ?? "")) continue;
    if (!/(rss|atom)\+xml/i.test(attr(a, "type") ?? "")) continue;
    const href = attr(a, "href");
    if (href) return new URL(decode(href), base).toString();
  }
  return null;
}

export async function fetchFeed(fetchFn: FetchFn, url: string): Promise<Feed> {
  const body = await get(fetchFn, url);
  if (!isFeed(body)) throw new Error(`${url}: not an RSS or Atom feed`);
  return parseFeed(body);
}

/** A source's kind from its feed address and what it carries. */
export function sourceKindOf(feedUrl: string, feed: Feed): SourceKind {
  const host = new URL(feedUrl).hostname.replace(/^www\./, "");
  if (/(^|\.)youtube\.com$/.test(host)) return "youtube";
  if (feed.podcast) return "podcast";
  if (/(^|\.)reddit\.com$/.test(host)) return "reddit";
  if (/(^|\.)(news\.ycombinator\.com|hnrss\.org|lobste\.rs)$/.test(host)) return "forum";
  if (
    /(^|\.)(substack\.com|beehiiv\.com|buttondown\.(email|com))$/.test(host) ||
    /substack|beehiiv|buttondown/i.test(feed.generator)
  )
    return "newsletter";
  if (/(^|\.)github\.com$/.test(host) || /\/releases(\.atom)?$/.test(feedUrl)) return "releases";
  return "blog";
}

/** The feed behind an address: the address itself, or the one its page names. */
export async function findFeed(
  fetchFn: FetchFn,
  url: string,
): Promise<{ feedUrl: string; page: string | null; feed: Feed; pageImage: string | null }> {
  const site = creatorSite(url);
  if (site)
    throw new Error(
      `${site} creators are in development: public reads only. Save their posts one at a time for now.`,
    );
  const body = await get(fetchFn, url);
  if (isFeed(body)) return { feedUrl: url, page: null, feed: parseFeed(body), pageImage: null };
  const found = feedLinkOf(body, url);
  if (!found) throw new Error(`${url}: no RSS or Atom feed on this page`);
  return {
    feedUrl: found,
    page: url,
    feed: await fetchFeed(fetchFn, found),
    pageImage: ogImageOf(body),
  };
}

/** A page's og:image (a channel's avatar on its page), https only. */
export function ogImageOf(html: string): string | null {
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = m[1] ?? "";
    const key = attr(a, "property") ?? attr(a, "name");
    if (key?.toLowerCase() !== "og:image") continue;
    const content = attr(a, "content");
    if (content) return httpsOr(decode(content));
  }
  return null;
}

/** A new item's row: the kind and type its link says, its feed's text and picture kept. */
const rowOf = (sourceId: number, sourceKind: SourceKind, i: FeedItem) => {
  const kind = kindOf(i.url, i.enclosure);
  return {
    sourceId,
    url: i.url,
    kind,
    type: typeOf(i.url, kind, sourceKind),
    title: pgSafe(i.title),
    creator: pgSafe(i.creator),
    text: pgSafe(i.text),
    publishedAt: i.publishedAt,
    thumbnailUrl: youtubeThumb(i.url) ?? i.thumbnail,
    duration: i.duration,
    mediaUrl: i.enclosure,
  };
};

/**
 * Follow a source: read it once, so a bad address fails here, not an hour later. Its current
 * items are kept as seen (done, never read): following scores what comes next, not the past.
 */
export async function follow(
  db: Db,
  fetchFn: FetchFn,
  p: { url: string; name?: string | null; tell?: Tell | null; by?: string | null },
): Promise<{ id: number; name: string; kind: SourceKind; items: number }> {
  const { feedUrl, page, feed, pageImage } = await findFeed(fetchFn, p.url.trim());
  const name = p.name?.trim() || feed.title || new URL(feedUrl).hostname;
  const kind = sourceKindOf(feedUrl, feed);
  const tell = p.tell ?? "top";
  const avatarUrl = feed.image ?? pageImage;
  const [row] = await db
    .insert(sources)
    .values({
      url: feedUrl,
      page,
      name,
      kind,
      avatarUrl,
      tell,
      by: p.by ?? null,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: sources.url,
      set: { name, kind, avatarUrl, tell, stoppedAt: null, failure: null },
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("insert returned no row");
  if (feed.items.length)
    await db
      .insert(items)
      .values(
        feed.items.map((i) => ({
          ...rowOf(row.id, kind, i),
          why: "In the feed before you followed it.",
          archivedAt: new Date(),
        })),
      )
      .onConflictDoNothing({ target: items.url });
  return { id: row.id, name, kind, items: feed.items.length };
}

export interface PullStats {
  /** New items, by id: each goes to be read. */
  added: number[];
  failed: Array<{ source: string; error: string }>;
}

/** Each followed source due a read, its new items stored unread. A failing one keeps its error. */
export async function pullFeeds(db: Db, fetchFn: FetchFn, now: Date): Promise<PullStats> {
  const due = await db
    .select()
    .from(sources)
    .where(
      and(
        isNull(sources.stoppedAt),
        or(
          isNull(sources.fetchedAt),
          lt(sources.fetchedAt, new Date(now.getTime() - FEED_EVERY_MS)),
        ),
      ),
    )
    .orderBy(asc(sources.id));
  const stats: PullStats = { added: [], failed: [] };
  for (const s of due) {
    try {
      const feed = await fetchFeed(fetchFn, s.url);
      if (feed.items.length) {
        const rows = await db
          .insert(items)
          .values(feed.items.map((i) => rowOf(s.id, s.kind, i)))
          .onConflictDoNothing({ target: items.url })
          .returning({ id: items.id });
        stats.added.push(...rows.map((r) => r.id));
      }
      await db
        .update(sources)
        .set({ fetchedAt: now, failure: null, ...(s.avatarUrl ? {} : { avatarUrl: feed.image }) })
        .where(eq(sources.id, s.id));
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      stats.failed.push({ source: s.name, error });
      await db.update(sources).set({ failure: error }).where(eq(sources.id, s.id));
    }
  }
  return stats;
}

/** One item on the spine. */
export const itemEvent = (id: number): SpineEvent => ({
  subject: `item:${id}`,
  kind: "item",
  data: { itemId: id },
});
