/**
 * The `youtube` stage (designs/2026-10-05-social-reads.md): the channel a firm's own site links,
 * and its newest uploads, kept as findings. The channel is a `profile` finding, each upload a
 * `post` with its watch link; a link that leads to no channel is a `profile` marked missing, so
 * it isn't read again before READ_EVERY_DAYS. Each firm is written before the next is read, so a
 * stop is a pause and a rerun resumes.
 *
 * Calls go straight to the Data API as Wren's service account (`youtube.readonly`): no `sites`
 * hop, and the `wrenautomation` project's own daily units, apart from the uploads'.
 */
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { type CompanyFindingDraft, keepFinding } from "../findings.js";
import { type Bucket, bucketRoom } from "../pacing.js";

export const YOUTUBE_COMMAND = "enrich youtube";
export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const API = "https://www.googleapis.com/youtube/v3";
/**
 * Firms read a day. A read is about 2 of the project's 10,000 daily units: at most 3,000 firms
 * in any 24 hours is 6,000 units, and the rest stays for channel search (100 units a call). The
 * pool sleeps to the next day once idle, so the burst is most of a quiet day's reads.
 */
export const YOUTUBE_BUCKET: Bucket = { perDay: 2000, burst: 1000 };
/**
 * A pass waits for this much room. Without it a busy pool would read the one firm that refilled
 * each minute and never go idle.
 */
export const YOUTUBE_MIN_BATCH = 100;
export const READ_EVERY_DAYS = 30;
const UPLOADS = 5;
const ERROR_STREAK = 5;
const ABOUT_CHARS = 1000;
const DESCRIPTION_CHARS = 500;

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
  return async (resource, query) => {
    const r = await fetch(`${API}/${resource}?${new URLSearchParams(query)}`, {
      headers: { authorization: `Bearer ${await token()}` },
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
  publishedAt: string | null;
  uploads: string | null;
}

export interface Upload {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
}

const count = (v: unknown) => (v === undefined || v === null ? null : Number(v));

export async function readChannel(get: YouTubeGet, ref: ChannelRef): Promise<Channel | null> {
  const body = (await get("channels", {
    part: "snippet,contentDetails,statistics",
    [ref.by]: ref.value,
  })) as {
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
        hiddenSubscriberCount?: boolean;
      };
    }[];
  };
  const c = body.items?.[0];
  if (!c?.id) return null;
  return {
    id: c.id,
    title: c.snippet?.title ?? "",
    handle: c.snippet?.customUrl ?? null,
    about: (c.snippet?.description ?? "").slice(0, ABOUT_CHARS),
    country: c.snippet?.country ?? null,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : count(c.statistics?.subscriberCount),
    videos: count(c.statistics?.videoCount),
    publishedAt: c.snippet?.publishedAt ?? null,
    uploads: c.contentDetails?.relatedPlaylists?.uploads || null,
  };
}

/** A removed or hidden video keeps its slot under one of these titles. */
const GONE = /^(private|deleted) video$/i;

/** The newest uploads, newest first; a channel with none (the playlist 404s) has []. */
export async function readUploads(get: YouTubeGet, playlistId: string): Promise<Upload[]> {
  let body: {
    items?: {
      snippet?: { title?: string; description?: string; resourceId?: { videoId?: string } };
      contentDetails?: { videoId?: string; videoPublishedAt?: string };
    }[];
  };
  try {
    body = (await get("playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: String(UPLOADS),
    })) as typeof body;
  } catch (err) {
    if (err instanceof YouTubeError && err.status === 404) return [];
    throw err;
  }
  return (body.items ?? [])
    .map((i) => ({
      videoId: i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId ?? "",
      title: (i.snippet?.title ?? "").trim(),
      description: (i.snippet?.description ?? "").slice(0, DESCRIPTION_CHARS),
      publishedAt: i.contentDetails?.videoPublishedAt ?? "",
    }))
    .filter((u) => u.videoId && u.title && u.publishedAt && !GONE.test(u.title))
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
        published_at: c.publishedAt,
        link,
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
        },
        sourceUrl: `https://www.youtube.com/watch?v=${u.videoId}`,
      }),
    ),
  ];
}

/** Read within READ_EVERY_DAYS, channel or missing: not due. */
export const youtubeDue = (id: SQL) =>
  sql`not exists (select 1 from findings f where f.company_id = ${id} and f.kind = 'profile'
    and f.via = 'youtube' and f.observed_at > now() - make_interval(days => ${READ_EVERY_DAYS}))`;

export interface YouTubeWork {
  companyId: number;
  link: string;
}

/**
 * Due firms in the niche with a YouTube link of their own (the one on most of their pages), a
 * lead we can still mail first.
 */
export async function youtubeWork(
  db: Queryable,
  opts: { niche: string; limit: number },
): Promise<YouTubeWork[]> {
  const rows = await db.execute<{ id: number; link: string }>(sql`
    select id, link from (
      select distinct on (c.id) c.id, cp.value as link,
        exists (select 1 from leads l where l.company_id = c.id
          and l.status in ('imported', 'verified')) as mailable
      from companies c
      join own_contact_points cp on cp.company_id = c.id and cp.kind = 'youtube'
        and cp.person_id is null
      where c.niche = ${opts.niche} and c.decline_reason is null and ${youtubeDue(sql`c.id`)}
      order by c.id, cp.pages desc, cp.id
    ) t
    order by mailable desc, id
    limit ${opts.limit}`);
  return rows.map((r) => ({ companyId: Number(r.id), link: r.link }));
}

/** Reads the bucket allows now (every niche's), and when the next one is. */
export async function youtubeRoom(
  db: Queryable,
  now: Date,
  bucket: Bucket = YOUTUBE_BUCKET,
): Promise<{ room: number; nextInMs: number }> {
  // One profile finding per read; two days covers any refill.
  const rows = await db.execute<{ at: string }>(sql`
    select observed_at as at from findings
    where kind = 'profile' and via = 'youtube'
      and observed_at > ${now.toISOString()}::timestamptz - interval '2 days'
    order by observed_at`);
  return bucketRoom(
    rows.map((r) => new Date(r.at).getTime()),
    now.getTime(),
    bucket,
  );
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
export function countYouTubeUnit(
  stats: YouTubeStats,
  u: YouTubeUnit,
  streak: { errors: number },
): string | null {
  if (u.outcome === "quota") return "YouTube's daily units are spent";
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
