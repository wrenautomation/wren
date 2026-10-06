/**
 * The `youtubeSearch` stage (designs/2026-10-05-social-reads.md): firms by niche from YouTube's
 * channel search. A search is one `search.list` for channels (100 units) and one `channels.list` on
 * its ids, every part (1 unit), as Wren's service account; each is one import of source
 * `youtube_search`, one row per channel, the channel resource whole. A firm is the first site its
 * about text links that isn't a platform; a channel that links none is keyed `yt:<channel id>`, never
 * dropped. A search is read again after YOUTUBE_SEARCH_EVERY_DAYS, paced by a bucket over the imports.
 */
import {
  extractDomain,
  IDENTITY_KEY,
  isPlatformDomain,
  type LeadSource,
  type RawRow,
  registrableDomain,
  runImport,
} from "@wren/core";
import { atomic, type Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { type Bucket, bucketRoom } from "../pacing.js";
import { CHANNEL_PARTS, YouTubeError, type YouTubeGet } from "./youtube.js";

export const YOUTUBE_SEARCH_COMMAND = "enrich youtube-search";
export const YOUTUBE_SEARCH_SOURCE = "youtube_search";
/**
 * Searches a day, 101 units each. The project has 10,000 a day: the `youtube` stage keeps at most
 * 6,000 in any 24 hours and talks 2,000 (20 searches), so this takes about half of what is left.
 */
export const YOUTUBE_SEARCH_BUCKET: Bucket = { perDay: 10, burst: 10 };
/** A niche's channels change slowly: a search is read again after this. */
export const YOUTUBE_SEARCH_EVERY_DAYS = 30;
/** Channels a search asks for: the most one call returns, at the same 100 units. */
const RESULTS = 50;

/** `youtube/search?q=...`: one search's reads share it, so its last read is findable. */
export const youtubeSearchRef = (q: string): string =>
  `youtube/search?${new URLSearchParams({ q })}`;

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

/** The first site the text links that isn't a platform (registrable), or null. */
export function channelSite(about: string, platforms: Iterable<string> = []): string | null {
  const extra = [...platforms];
  for (const [url] of about.matchAll(LINK)) {
    const host = extractDomain(url);
    if (host && !isPlatformDomain(host, extra)) return registrableDomain(host);
  }
  return null;
}

/** One channel resource as `channels.list` answers it, every part asked for. */
export interface FoundChannel {
  id: string;
  snippet?: { title?: string; description?: string };
  [part: string]: unknown;
}

/** The channels a search finds, in its order, each read whole; none = []. */
export async function searchChannels(get: YouTubeGet, q: string): Promise<FoundChannel[]> {
  const found = (await get("search", {
    part: "snippet",
    type: "channel",
    q,
    maxResults: String(RESULTS),
    regionCode: "US",
    relevanceLanguage: "en",
  })) as { items?: { id?: { channelId?: string } }[] };
  const ids = [...new Set((found.items ?? []).flatMap((i) => i.id?.channelId ?? []))];
  if (ids.length === 0) return [];
  const read = (await get("channels", {
    part: CHANNEL_PARTS,
    id: ids.join(","),
    maxResults: String(RESULTS),
  })) as { items?: FoundChannel[] };
  const byId = new Map((read.items ?? []).map((c) => [c.id, c]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** One row per channel, the resource whole under `youtube`; its own site is the firm, else the channel. */
export function youtubeSearchRows(
  channels: readonly FoundChannel[],
  q: string,
  platforms: Iterable<string> = [],
): RawRow[] {
  const extra = [...platforms];
  return channels.map((c) => {
    const own = channelSite(c.snippet?.description ?? "", extra);
    return {
      company_name: c.snippet?.title ?? null,
      website: own ?? `https://www.youtube.com/channel/${c.id}`,
      query: q,
      youtube: c,
      ...(own ? {} : { [IDENTITY_KEY]: { source_key: `yt:${c.id}` } }),
    };
  });
}

/** Searches left in the bucket now, and how long until the next when none. */
export async function youtubeSearchRoom(
  db: Queryable,
  now: Date,
  bucket: Bucket = YOUTUBE_SEARCH_BUCKET,
): Promise<{ room: number; nextInMs: number }> {
  const rows = await db.execute<{ at: string }>(sql`
    select imported_at as at from imports
    where source_type = ${YOUTUBE_SEARCH_SOURCE}
      and imported_at > ${now.toISOString()}::timestamptz - interval '2 days'
    order by imported_at`);
  return bucketRoom(
    rows.map((r) => new Date(r.at).getTime()),
    now.getTime(),
    bucket,
  );
}

/** The searches due a read: never read first (in list order), then the longest ago. */
export async function youtubeSearchesDue(
  db: Queryable,
  searches: readonly string[],
  opts: { now: Date; limit: number },
): Promise<string[]> {
  if (searches.length === 0 || opts.limit <= 0) return [];
  const refs = searches.map(youtubeSearchRef);
  const rows = await db.execute<{ ref: string; at: string }>(sql`
    select source_ref as ref, max(imported_at) as at from imports
    where source_type = ${YOUTUBE_SEARCH_SOURCE}
      and source_ref in (${sql.join(
        refs.map((r) => sql`${r}`),
        sql`, `,
      )})
    group by source_ref`);
  const last = new Map(rows.map((r) => [r.ref, new Date(r.at).getTime()]));
  const due = opts.now.getTime() - YOUTUBE_SEARCH_EVERY_DAYS * 86_400_000;
  return searches
    .map((q, i) => ({ q, at: last.get(refs[i] as string) ?? 0 }))
    .filter((s) => s.at <= due)
    .sort((a, b) => a.at - b.at)
    .slice(0, opts.limit)
    .map((s) => s.q);
}

export type YouTubeSearchOutcome = "read" | "quota" | "error";

export interface YouTubeSearchUnit {
  q: string;
  outcome: YouTubeSearchOutcome;
  channels: number;
  created: number;
  seen: number;
  batch: number | null;
  error: string | null;
}

/** Run one search and import its channels; an API error comes back as data, never thrown. */
export async function youtubeSearchUnit(
  db: Queryable,
  get: YouTubeGet,
  w: { q: string; niche: string; platforms?: Iterable<string> },
): Promise<YouTubeSearchUnit> {
  const none = { q: w.q, channels: 0, created: 0, seen: 0, batch: null };
  let channels: FoundChannel[];
  try {
    channels = await searchChannels(get, w.q);
  } catch (err) {
    if (!(err instanceof YouTubeError)) throw err;
    return { ...none, outcome: err.quota ? "quota" : "error", error: err.message };
  }
  const platforms = [...(w.platforms ?? [])];
  const source: LeadSource = {
    sourceType: YOUTUBE_SEARCH_SOURCE,
    sourceRef: youtubeSearchRef(w.q),
    rows: () => youtubeSearchRows(channels, w.q, platforms),
  };
  const { batch, stats } = await atomic(db, (tx) =>
    runImport(tx, source, { niche: w.niche, extraPlatformDomains: platforms }),
  );
  return {
    q: w.q,
    outcome: "read",
    channels: channels.length,
    created: stats.companies_created,
    seen: stats.companies_seen,
    batch: batch.id,
    error: null,
  };
}

export interface YouTubeSearchStats {
  selected: number;
  read: number;
  channels: number;
  created: number;
  seen: number;
  errors: number;
  /** Why the run stopped early; null = it ran out of searches. */
  stopped: string | null;
}

export const emptyYouTubeSearchStats = (): YouTubeSearchStats => ({
  selected: 0,
  read: 0,
  channels: 0,
  created: 0,
  seen: 0,
  errors: 0,
  stopped: null,
});

/** Count a unit; the reason to stop, or null. */
export function countYouTubeSearchUnit(s: YouTubeSearchStats, u: YouTubeSearchUnit): string | null {
  if (u.outcome === "quota") return `YouTube's daily units are spent: ${u.error}`;
  if (u.outcome === "error") {
    s.errors++;
    return null;
  }
  s.read++;
  s.channels += u.channels;
  s.created += u.created;
  s.seen += u.seen;
  return null;
}
