/**
 * The `youtube` stage (designs/2026-10-05-social-reads.md): the channel a firm's own site links,
 * and its newest uploads, kept as findings. The channel is a `profile` finding, each upload a
 * `post` with its watch link; a link that leads to no channel is a `profile` marked missing, so
 * it isn't read again before READ_EVERY_DAYS. Each firm is written before the next is read, so a
 * stop is a pause and a rerun resumes. Every finding keeps the API's whole answer as `raw`, every
 * part asked for, text uncut: what to use is decided when it is read.
 *
 * Calls go straight to the Data API as Wren's service account (`youtube.readonly`): no `sites`
 * hop, and the `wrenautomation` project's own daily units, apart from the uploads'. A client's
 * reads run on its own API key when it brings one (`clientYouTube`,
 * designs/2026-10-07-vendor-keys.md), else on Wren's, gated and metered on its share.
 */

import type { VendorKeys } from "@wren/core/vendor-keys";
import { isVendorStop } from "@wren/core/vendor-stop";
import { ownRoom } from "@wren/core/vendors";
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { type CompanyFindingDraft, keepFinding } from "../findings.js";
import { type Bucket, bucketRoom } from "../pacing.js";

export const YOUTUBE_COMMAND = "enrich youtube";
export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const API = "https://www.googleapis.com/youtube/v3";
/**
 * Firms read a day. A read is 3 of the project's 10,000 daily units (channel, one page of uploads,
 * their videos): at most 2,000 firms in any 24 hours is 6,000 units, and the rest stays for
 * channel search (100 units a call). About 4,100 firms have a link and each is read every 30 days,
 * so a steady day is ~140. The pool sleeps to the next day once idle.
 */
export const YOUTUBE_BUCKET: Bucket = { perDay: 1500, burst: 500 };
/**
 * A pass waits for this much room. Without it a busy pool would read the one firm that refilled
 * each minute and never go idle.
 */
export const YOUTUBE_MIN_BATCH = 100;
export const READ_EVERY_DAYS = 30;
/** Newest uploads read a firm: a page is 50 and costs a unit, as does each 50 videos' details. */
export const UPLOADS = 50;
const PAGE = 50;
const ERROR_STREAK = 5;
export const CHANNEL_PARTS =
  "snippet,contentDetails,statistics,brandingSettings,topicDetails,status,localizations";
const VIDEO_PARTS = "snippet,statistics,contentDetails,topicDetails,status,liveStreamingDetails";

export class YouTubeError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
  /** The project's daily units are spent: nothing more today. */
  get quota(): boolean {
    return this.status === 403 && /quota|rateLimit/i.test(this.reason);
  }
}

/** One GET on the Data API: the parsed body, or a YouTubeError. */
export type YouTubeGet = (resource: string, query: Record<string, string>) => Promise<unknown>;

export function youtubeApi(
  token: () => Promise<string>,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): YouTubeGet {
  return dataApi(async () => ({ authorization: `Bearer ${await token()}` }), fetch);
}

/** The Data API on an API key (a client's own): public reads only, its project's units. */
export function youtubeKeyApi(
  key: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): YouTubeGet {
  return dataApi(async () => ({ "x-goog-api-key": key }), fetch);
}

function dataApi(
  headers: () => Promise<Record<string, string>>,
  fetch: typeof globalThis.fetch,
): YouTubeGet {
  return async (resource, query) => {
    const r = await fetch(`${API}/${resource}?${new URLSearchParams(query)}`, {
      headers: await headers(),
    });
    const body = (await r.json().catch(() => null)) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    } | null;
    if (!r.ok)
      throw new YouTubeError(
        r.status,
        body?.error?.errors?.[0]?.reason ?? "",
        `YouTube ${resource}: ${body?.error?.message ?? `HTTP ${r.status}`}`,
      );
    return body;
  };
}

export type ChannelRef = { by: "id" | "forHandle" | "forUsername"; value: string };

/** The lookup a link allows, or why it has none. */
export function channelRef(link: string): ChannelRef | { missing: string } {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return { missing: "not a link" };
  }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return { missing: "not a channel link" };
  const [first, second] = u.pathname.split("/").filter(Boolean);
  if (first?.startsWith("@") && first.length > 1)
    return { by: "forHandle", value: decodeURIComponent(first) };
  if (first === "channel" && second && /^UC[\w-]{22}$/.test(second))
    return { by: "id", value: second };
  if (first === "user" && second) return { by: "forUsername", value: second };
  if (first === "c") return { missing: "a custom link, which the API can't look up" };
  return { missing: "not a channel link" };
}

export interface Channel {
  id: string;
  title: string;
  handle: string | null;
  about: string;
  country: string | null;
  subscribers: number | null;
  videos: number | null;
  views: number | null;
  keywords: string | null;
  /** Wikipedia links YouTube files the channel under. */
  topics: string[];
  publishedAt: string | null;
  uploads: string | null;
  /** The channel resource as the API sent it. */
  raw: unknown;
}

export interface Upload {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  seconds: number | null;
  tags: string[];
  /** Streamed live (or scheduled to be). */
  live: boolean;
  /** The video resource as the API sent it; the playlist item when the video gave none. */
  raw: unknown;
}

const count = (v: unknown) => (v === undefined || v === null ? null : Number(v));

/** ISO 8601 `PT1H2M3S` as seconds; null for anything else. */
export function seconds(iso: string | undefined): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? "");
  if (!m || iso === "P") return null;
  const [d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number];
  return ((d * 24 + h) * 60 + min) * 60 + s;
}

export async function readChannel(get: YouTubeGet, ref: ChannelRef): Promise<Channel | null> {
  const body = (await get("channels", { part: CHANNEL_PARTS, [ref.by]: ref.value })) as {
    items?: {
      id?: string;
      snippet?: {
        title?: string;
        description?: string;
        customUrl?: string;
        country?: string;
        publishedAt?: string;
      };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
      statistics?: {
        subscriberCount?: string;
        videoCount?: string;
        viewCount?: string;
        hiddenSubscriberCount?: boolean;
      };
      brandingSettings?: { channel?: { keywords?: string } };
      topicDetails?: { topicCategories?: string[] };
    }[];
  };
  const c = body.items?.[0];
  if (!c?.id) return null;
  return {
    id: c.id,
    title: c.snippet?.title ?? "",
    handle: c.snippet?.customUrl ?? null,
    about: c.snippet?.description ?? "",
    country: c.snippet?.country ?? null,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : count(c.statistics?.subscriberCount),
    videos: count(c.statistics?.videoCount),
    views: count(c.statistics?.viewCount),
    keywords: c.brandingSettings?.channel?.keywords || null,
    topics: c.topicDetails?.topicCategories ?? [],
    publishedAt: c.snippet?.publishedAt ?? null,
    uploads: c.contentDetails?.relatedPlaylists?.uploads || null,
    raw: c,
  };
}

/** A removed or hidden video keeps its slot under one of these titles. */
const GONE = /^(private|deleted) video$/i;

type PlaylistItem = {
  snippet?: { title?: string; description?: string; resourceId?: { videoId?: string } };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
};
type Video = {
  id?: string;
  snippet?: { tags?: string[]; liveBroadcastContent?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
  liveStreamingDetails?: unknown;
};

/**
 * Up to `limit` newest uploads, newest first, each with its video's details; a channel with none
 * (the playlist 404s) has [].
 */
export async function readUploads(
  get: YouTubeGet,
  playlistId: string,
  limit = UPLOADS,
): Promise<Upload[]> {
  const items: PlaylistItem[] = [];
  let pageToken: string | undefined;
  do {
    let body: { items?: PlaylistItem[]; nextPageToken?: string };
    try {
      body = (await get("playlistItems", {
        part: "snippet,contentDetails",
        playlistId,
        maxResults: String(Math.min(PAGE, limit - items.length)),
        ...(pageToken ? { pageToken } : {}),
      })) as typeof body;
    } catch (err) {
      if (err instanceof YouTubeError && err.status === 404) break;
      throw err;
    }
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken && items.length < limit);
  const kept = items
    .map((i) => ({
      item: i,
      videoId: i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId ?? "",
      title: (i.snippet?.title ?? "").trim(),
      publishedAt: i.contentDetails?.videoPublishedAt ?? "",
    }))
    .filter((u) => u.videoId && u.title && u.publishedAt && !GONE.test(u.title));
  const videos = new Map<string, Video>();
  for (let at = 0; at < kept.length; at += PAGE) {
    const ids = kept.slice(at, at + PAGE).map((u) => u.videoId);
    const body = (await get("videos", { part: VIDEO_PARTS, id: ids.join(",") })) as {
      items?: Video[];
    };
    for (const v of body.items ?? []) if (v.id) videos.set(v.id, v);
  }
  return kept
    .map(({ item, videoId, title, publishedAt }): Upload => {
      const v = videos.get(videoId);
      return {
        videoId,
        title,
        description: item.snippet?.description ?? "",
        publishedAt,
        views: count(v?.statistics?.viewCount),
        likes: count(v?.statistics?.likeCount),
        comments: count(v?.statistics?.commentCount),
        seconds: seconds(v?.contentDetails?.duration),
        tags: v?.snippet?.tags ?? [],
        live: Boolean(v?.liveStreamingDetails) || v?.snippet?.liveBroadcastContent === "upcoming",
        raw: v ?? item,
      };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** The findings one read makes: the channel (or why there is none) and each upload. */
export function youtubeFindings(
  companyId: number,
  link: string,
  read: { channel: Channel; uploads: Upload[] } | { missing: string },
): CompanyFindingDraft[] {
  const base = { companyId, via: "youtube", confidence: 1, document: null };
  if ("missing" in read)
    return [
      {
        ...base,
        kind: "profile",
        factKey: `c${companyId}:profile:youtube:${link}`.slice(0, 400),
        value: { url: link, missing: read.missing },
        sourceUrl: link,
      },
    ];
  const { channel: c, uploads } = read;
  return [
    {
      ...base,
      kind: "profile",
      factKey: `c${companyId}:profile:youtube:${c.id}`,
      value: {
        site: "YouTube",
        channel_id: c.id,
        title: c.title,
        handle: c.handle,
        about: c.about,
        country: c.country,
        subscribers: c.subscribers,
        videos: c.videos,
        views: c.views,
        keywords: c.keywords,
        topics: c.topics,
        published_at: c.publishedAt,
        link,
        raw: c.raw,
      },
      sourceUrl: `https://www.youtube.com/channel/${c.id}`,
    },
    ...uploads.map(
      (u): CompanyFindingDraft => ({
        ...base,
        kind: "post",
        factKey: `c${companyId}:post:youtube:${u.videoId}`,
        value: {
          site: "YouTube",
          kind: "video",
          video_id: u.videoId,
          channel_id: c.id,
          title: u.title,
          description: u.description,
          published_at: u.publishedAt,
          views: u.views,
          likes: u.likes,
          comments: u.comments,
          seconds: u.seconds,
          tags: u.tags,
          live: u.live,
          raw: u.raw,
        },
        sourceUrl: `https://www.youtube.com/watch?v=${u.videoId}`,
      }),
    ),
  ];
}

/**
 * Read within READ_EVERY_DAYS, channel or missing: not due. A channel kept before `raw` was is
 * due again, so the reads from before it fill themselves in.
 */
export const youtubeDue = (id: SQL) =>
  sql`not exists (select 1 from findings f where f.company_id = ${id} and f.kind = 'profile'
    and f.via = 'youtube' and f.observed_at > now() - make_interval(days => ${READ_EVERY_DAYS})
    and (f.value ? 'raw' or f.value ? 'missing'))`;

export interface YouTubeWork {
  companyId: number;
  link: string;
}

/**
 * Due firms in the niche (null: every niche, a client's whole pool) with a YouTube link of their
 * own (the one on most of their pages), a lead we can still mail first.
 */
export async function youtubeWork(
  db: Queryable,
  opts: { niche: string | null; limit: number },
): Promise<YouTubeWork[]> {
  const rows = await db.execute<{ id: number; link: string }>(sql`
    select id, link from (
      select distinct on (c.id) c.id, cp.value as link,
        exists (select 1 from leads l where l.company_id = c.id
          and l.status in ('imported', 'verified')) as mailable
      from companies c
      join own_contact_points cp on cp.company_id = c.id and cp.kind = 'youtube'
        and cp.person_id is null
      where (${opts.niche}::text is null or c.niche = ${opts.niche})
        and c.decline_reason is null and ${youtubeDue(sql`c.id`)}
      order by c.id, cp.pages desc, cp.id
    ) t
    order by mailable desc, id
    limit ${opts.limit}`);
  return rows.map((r) => ({ companyId: Number(r.id), link: r.link }));
}

/**
 * Reads the bucket allows now (every niche's), and when the next one is. A client's room also
 * counts main's reads (`also`): one bucket per source.
 */
export async function youtubeRoom(
  db: Queryable,
  now: Date,
  bucket: Bucket = YOUTUBE_BUCKET,
  also: Queryable | null = null,
): Promise<{ room: number; nextInMs: number }> {
  // One profile finding per read; two days covers any refill.
  const reads = async (on: Queryable) =>
    (
      await on.execute<{ at: string }>(sql`
        select observed_at as at from findings
        where kind = 'profile' and via = 'youtube'
          and observed_at > ${now.toISOString()}::timestamptz - interval '2 days'`)
    ).map((r) => new Date(r.at).getTime());
  const at = [...(await reads(db)), ...(also ? await reads(also) : [])].sort((a, b) => a - b);
  return bucketRoom(at, now.getTime(), bucket);
}

/** Data API units one firm's read costs: channel, a page of uploads, their videos. */
export const READ_UNITS = 3;

/**
 * Reads `client` (null: Wren) may make now. A client on its own key has its key's daily quota
 * to itself; Wren and clients on Wren's key share Wren's bucket (`youtubeRoom`, counting main's
 * reads too).
 */
export async function youtubeReadRoom(
  db: Queryable,
  main: Queryable,
  client: string | null,
  now: Date,
): Promise<{ room: number; nextInMs: number }> {
  if (client === null) return youtubeRoom(db, now);
  const own = await ownRoom(main, client, "youtube", now);
  if (own) return { room: Math.floor(own.room / READ_UNITS), nextInMs: own.nextInMs };
  return youtubeRoom(db, now, undefined, main);
}

export type YouTubeOutcome = "read" | "missing" | "quota" | "error";

export interface YouTubeUnit {
  companyId: number;
  outcome: YouTubeOutcome;
  uploads: number;
  error: string | null;
}

/**
 * One firm: look the channel up, read its uploads, keep the findings. API errors come back as
 * data, so a batch never retries a read.
 */
export async function youtubeUnit(
  db: Queryable,
  get: YouTubeGet,
  w: YouTubeWork,
): Promise<YouTubeUnit> {
  const done = (outcome: YouTubeOutcome, uploads = 0, error: string | null = null) => ({
    companyId: w.companyId,
    outcome,
    uploads,
    error,
  });
  const ref = channelRef(w.link);
  let read: { channel: Channel; uploads: Upload[] } | { missing: string };
  if ("missing" in ref) read = ref;
  else {
    try {
      const channel = await readChannel(get, ref);
      read = channel
        ? { channel, uploads: channel.uploads ? await readUploads(get, channel.uploads) : [] }
        : { missing: "no channel at this link" };
    } catch (err) {
      if (err instanceof YouTubeError && err.quota) return done("quota", 0, err.message);
      return done("error", 0, err instanceof Error ? err.message : String(err));
    }
  }
  for (const f of youtubeFindings(w.companyId, w.link, read)) await keepFinding(db, f);
  return "missing" in read ? done("missing") : done("read", read.uploads.length);
}

export interface YouTubeStats {
  selected: number;
  read: number;
  missing: number;
  uploads: number;
  errors: number;
  /** Why the run stopped early; null = it ran out of firms. */
  stopped: string | null;
}

export const emptyYouTubeStats = (): YouTubeStats => ({
  selected: 0,
  read: 0,
  missing: 0,
  uploads: 0,
  errors: 0,
  stopped: null,
});

/** Adds one unit; returns why the run must stop, or null. */
/** A client's reads stopped by its vendor gate or its key: the pass ends on why. */
const STOPPED = "YouTube stopped: ";

/** Data API units a read spends: a search is 100, every other list 1. */
export const youtubeUnits = (resource: string) => (resource === "search" ? 100 : 1);

/**
 * A client's YouTube reads: on its own API key (`own`), or Wren's (`wren`), each gated and
 * metered in Data API units on its share. A stop (no key, no mode, a cap) reads as spent units,
 * so the pass ends on it. The key never leaves in an error.
 */
export function clientYouTube(o: {
  client: string;
  keys: VendorKeys;
  wren: YouTubeGet;
  own: (key: string) => YouTubeGet;
  part: string;
  runId?: string | null;
}): YouTubeGet {
  let mine: { key: string; get: YouTubeGet } | null = null;
  return async (resource, query) => {
    try {
      return await o.keys.use(
        {
          client: o.client,
          vendor: "youtube",
          why: `youtube ${resource} for ${o.part}`,
          units: youtubeUnits(resource),
          part: o.part,
          runId: o.runId ?? null,
        },
        (k) => {
          if (k.mode !== "own") return o.wren(resource, query);
          if (mine?.key !== k.key) mine = { key: k.key, get: o.own(k.key) };
          return mine.get(resource, query);
        },
      );
    } catch (err) {
      if (isVendorStop(err))
        throw new YouTubeError(403, "rateLimitExceeded", `${STOPPED}${err.why}`);
      throw err;
    }
  };
}

export function countYouTubeUnit(
  stats: YouTubeStats,
  u: YouTubeUnit,
  streak: { errors: number },
): string | null {
  if (u.outcome === "quota")
    return u.error?.startsWith(STOPPED) ? u.error : "YouTube's daily units are spent";
  if (u.outcome === "error") {
    stats.errors++;
    streak.errors++;
    return streak.errors >= ERROR_STREAK ? `${streak.errors} errors in a row: ${u.error}` : null;
  }
  streak.errors = 0;
  if (u.outcome === "read") stats.read++;
  else stats.missing++;
  stats.uploads += u.uploads;
  return null;
}
