/**
 * Creators followed on sites with no feed: Instagram, X and TikTok. Instagram and X are read on
 * the worker through autobrowse (`meta GET /instagram/{username}`, Graph business discovery, and
 * `x GET /2/users/{handle}/tweets`, the signed-in page, both free and capped per day), so every
 * `CREATOR_EVERY_MS`. TikTok needs yt-dlp and a home IP, so the Mac's reader lists it
 * (`pullTikTok`). A creator's first read keeps what it had posted as seen, like a feed's.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SiteClient } from "@wren/core/content";
import type { Db } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { FeedItem, PullStats } from "./feeds.js";
import { cleanUrl, typeOf } from "./links.js";
import { type ItemKind, items, type SourceKind, sources } from "./schema.js";

const run = promisify(execFile);

export const CREATOR_KINDS = ["instagram", "x", "tiktok"] as const;
export type CreatorKind = (typeof CREATOR_KINDS)[number];
export const isCreatorKind = (k: string): k is CreatorKind =>
  (CREATOR_KINDS as readonly string[]).includes(k);
/** What a creator's first read marks its posts with: kept as seen, never read. */
export const FOLLOWED_BEFORE = "Posted before you followed.";
/** A creator is read 4 times a day: the sites' caps are a day's. */
export const CREATOR_EVERY_MS = 6 * 60 * 60_000;
/** Posts kept a read; a creator posts a few a day at most. */
const NEWEST = 12;

/** A post, with the kind its media says. */
export interface CreatorPost extends FeedItem {
  kind: ItemKind;
}

/** A profile's own tabs: still the profile. */
const PROFILE_TABS = new Set([
  "reels",
  "tagged",
  "posts",
  "videos",
  "media",
  "with_replies",
  "highlights",
]);
/** First path parts that are a site's own pages, never a handle. */
const NOT_HANDLES = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "i",
  "home",
  "search",
  "settings",
  "hashtag",
  "intent",
  "share",
]);

/** The creator a profile address names: its site, handle and page; null for anything else. */
export function creatorOf(raw: string): { kind: CreatorKind; handle: string; page: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const [first = "", tab, ...rest] = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // A profile is its handle, or a tab of it: a post's address (`/reel/<id>`, `/<handle>/status/<id>`) is not.
  if (rest.length || (tab !== undefined && !PROFILE_TABS.has(tab)) || NOT_HANDLES.has(first))
    return null;
  if (host === "instagram.com" && /^[A-Za-z0-9._]{1,30}$/.test(first))
    return { kind: "instagram", handle: first, page: `https://instagram.com/${first}` };
  if ((host === "x.com" || host === "twitter.com") && /^[A-Za-z0-9_]{1,15}$/.test(first))
    return { kind: "x", handle: first, page: `https://x.com/${first}` };
  if (host === "tiktok.com" && /^@[A-Za-z0-9._]{2,24}$/.test(first))
    return {
      kind: "tiktok",
      handle: first.slice(1),
      page: `https://tiktok.com/@${first.slice(1)}`,
    };
  return null;
}

const firstLine = (s: string, max = 100) => s.split("\n")[0]?.trim().slice(0, max) ?? "";
const titleOf = (text: string, fallback: string) => firstLine(text) || fallback;

/** ISO time of a Graph timestamp (`2026-09-30T21:40:31+0000`), or null. */
const graphTime = (t: string | undefined): Date | null => {
  const ms = t ? Date.parse(t.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) : Number.NaN;
  return Number.isNaN(ms) ? null : new Date(ms);
};

interface IgMedia {
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  thumbnail_url?: string;
  media_url?: string;
}

/** One page of a creator's posts, newest first, and where the page after starts (null: no more). */
export interface CreatorPage {
  posts: CreatorPost[];
  next: string | null;
}

/**
 * A page of an Instagram creator's posts, newest first: a reel or video waits for the Mac, a photo
 * is its caption. `after` is a previous page's `next` (Graph's cursor).
 */
export async function instagramPage(
  sites: SiteClient,
  handle: string,
  page: { after?: string | null; limit?: number } = {},
): Promise<CreatorPage> {
  const a = await sites.call<
    | {
        found: true;
        profile: { name?: string; username?: string };
        media?: IgMedia[];
        next?: string | null;
      }
    | { found: false; reason: string }
  >("meta", "GET", `/instagram/${handle}`, {
    limit: page.limit ?? NEWEST,
    ...(page.after ? { after: page.after } : {}),
  });
  if (!a.found) throw new Error(`instagram @${handle}: ${a.reason}`);
  const by = a.profile.username ?? handle;
  const posts = (a.media ?? [])
    .filter((m) => m.permalink)
    .map((m): CreatorPost => {
      const video = m.media_type === "VIDEO" || m.media_product_type === "REELS";
      const text = m.caption?.trim() ?? "";
      return {
        kind: video ? "reel" : "article",
        url: m.permalink as string,
        title: titleOf(text, `@${by} post`),
        text,
        publishedAt: graphTime(m.timestamp),
        creator: by,
        enclosure: null,
        thumbnail: m.thumbnail_url ?? (video ? null : (m.media_url ?? null)),
        duration: null,
      };
    });
  return { posts, next: a.next ?? null };
}

/** An Instagram creator's newest posts. */
export async function instagramPosts(sites: SiteClient, handle: string): Promise<CreatorPost[]> {
  return (await instagramPage(sites, handle)).posts;
}

interface XPost {
  id: string;
  text: string;
  author_username: string;
  created_at?: string;
  pinned?: true;
  reposted_by?: string;
  photos?: string[];
}

/** An X creator's newest posts of their own (no reposts, no pin), each read as its text. */
export async function xPosts(sites: SiteClient, handle: string): Promise<CreatorPost[]> {
  const a = await sites.call<{ data?: XPost[]; errors?: { detail: string }[] }>(
    "x",
    "GET",
    `/2/users/${handle}/tweets`,
    { max_results: NEWEST, exclude: "retweets" },
  );
  if (a.errors?.length && !a.data) throw new Error(`x @${handle}: ${a.errors[0]?.detail}`);
  return (a.data ?? [])
    .filter((t) => !t.pinned && !t.reposted_by && t.text.trim())
    .map((t) => ({
      kind: "article" as const,
      url: `https://x.com/${t.author_username}/status/${t.id}`,
      title: titleOf(t.text, `@${t.author_username} post`),
      text: t.text,
      publishedAt: t.created_at ? new Date(t.created_at) : null,
      creator: t.author_username,
      enclosure: null,
      thumbnail: t.photos?.[0] ?? null,
      duration: null,
    }));
}

interface YtDlpEntry {
  id?: string;
  url?: string;
  webpage_url?: string;
  title?: string;
  description?: string;
  timestamp?: number;
  duration?: number;
  uploader?: string;
  thumbnails?: { url?: string }[];
}

/**
 * A page of a TikTok creator's videos from yt-dlp's playlist view (no downloads), newest first.
 * `after` is how many come before the page (yt-dlp counts from the newest). Mac only.
 */
export async function tiktokPage(
  ytDlp: string,
  handle: string,
  page: { after?: string | null; limit?: number } = {},
): Promise<CreatorPage> {
  const skip = Number(page.after ?? 0);
  const limit = page.limit ?? NEWEST;
  const [cmd, ...pre] = ytDlp.split(/\s+/) as [string, ...string[]];
  const { stdout } = await run(
    cmd,
    [
      ...pre,
      ...["-J", "--flat-playlist", "--no-warnings"],
      ...["--playlist-start", String(skip + 1), "--playlist-end", String(skip + limit)],
      `https://www.tiktok.com/@${handle}`,
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
  );
  const entries = ((JSON.parse(stdout) as { entries?: YtDlpEntry[] }).entries ?? []).filter(
    (e) => e.id,
  );
  const posts = entries.map((e) => {
    const text = (e.description ?? e.title ?? "").trim();
    return {
      kind: "reel" as const,
      url: e.webpage_url ?? e.url ?? `https://www.tiktok.com/@${handle}/video/${e.id}`,
      title: titleOf(text, `@${handle} video`),
      text,
      publishedAt: e.timestamp ? new Date(e.timestamp * 1000) : null,
      creator: e.uploader ?? handle,
      enclosure: null,
      thumbnail: e.thumbnails?.at(-1)?.url ?? null,
      duration: e.duration ? Math.round(e.duration) : null,
    };
  });
  return { posts, next: entries.length >= limit ? String(skip + entries.length) : null };
}

/** A TikTok creator's newest videos. Mac only. */
export async function tiktokPosts(ytDlp: string, handle: string): Promise<CreatorPost[]> {
  return (await tiktokPage(ytDlp, handle)).posts;
}

/** One read of a creator's posts, by its kind. */
export type CreatorReader = (kind: CreatorKind, handle: string) => Promise<CreatorPost[]> | null;

/** The worker's reader: Instagram and X through autobrowse; TikTok is the Mac's. */
export const sitesReader =
  (sites: SiteClient): CreatorReader =>
  (kind, handle) =>
    kind === "instagram"
      ? instagramPosts(sites, handle)
      : kind === "x"
        ? xPosts(sites, handle)
        : null;

/** The Mac's reader: TikTok by yt-dlp. */
export const tiktokReader =
  (ytDlp: string): CreatorReader =>
  (kind, handle) =>
    kind === "tiktok" ? tiktokPosts(ytDlp, handle) : null;

/**
 * Read the creators that are due and that `read` can read, keeping new posts. A creator's first
 * read keeps its posts as seen. `macReads` marks new reels for the Mac as they're kept: the Mac
 * reads them in the same pass, with no spine between.
 */
export async function pullCreators(
  db: Db,
  read: CreatorReader,
  now: Date,
  opts: { kinds: readonly CreatorKind[]; macReads?: boolean },
): Promise<PullStats> {
  const due = await db
    .select()
    .from(sources)
    .where(
      and(
        inArray(sources.kind, [...opts.kinds]),
        isNull(sources.stoppedAt),
        or(
          isNull(sources.fetchedAt),
          lt(sources.fetchedAt, new Date(now.getTime() - CREATOR_EVERY_MS)),
        ),
      ),
    )
    .orderBy(asc(sources.id));
  const stats: PullStats = { added: [], failed: [] };
  for (const s of due) {
    const who = creatorOf(s.url);
    const pending = who && isCreatorKind(s.kind) ? read(s.kind, who.handle) : null;
    if (!pending) continue;
    try {
      const posts = await pending;
      const first = !s.fetchedAt;
      if (posts.length) {
        const rows = await db
          .insert(items)
          .values(
            posts.map((p) => {
              const url = cleanUrl(p.url);
              return {
                client: s.client,
                sourceId: s.id,
                url,
                kind: p.kind,
                type: typeOf(url, p.kind, s.kind),
                title: pgSafe(p.title),
                creator: pgSafe(p.creator),
                text: pgSafe(p.text),
                publishedAt: p.publishedAt,
                thumbnailUrl: p.thumbnail,
                duration: p.duration,
                ...(first
                  ? { why: FOLLOWED_BEFORE, archivedAt: now }
                  : opts.macReads && p.kind === "reel"
                    ? { needsMac: now }
                    : {}),
              };
            }),
          )
          .onConflictDoNothing({ target: [items.client, items.url] })
          .returning({ id: items.id });
        if (!first) stats.added.push(...rows.map((r) => r.id));
      }
      await db.update(sources).set({ fetchedAt: now, failure: null }).where(eq(sources.id, s.id));
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      stats.failed.push({ source: s.name, error });
      await db.update(sources).set({ failure: error }).where(eq(sources.id, s.id));
    }
  }
  return stats;
}

/** The source row a creator follow makes: read on the next pass, not now. */
export function creatorSource(raw: string): { kind: SourceKind; url: string; name: string } | null {
  const c = creatorOf(raw);
  return c ? { kind: c.kind, url: c.page, name: `@${c.handle}` } : null;
}
