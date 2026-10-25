/**
 * YouTube as a `ContentChannel`, over autobrowse's site API in the Data
 * API v3's shape. Publish = a resumable upload of a file the worker can
 * read (a path on the worker or a URL), or a community post through autobrowse's browser route
 * (no API; kind "community"); list = the channel's uploads
 * playlist (cheap in quota); metrics = `videos?part=statistics`;
 * activity = recent public subscribers; audience = the subscriber count.
 * insights = YouTube Analytics (`yt-analytics.readonly`) reports: totals, the retention curve,
 * traffic sources and search terms per video; per day for the channel.
 * reportDays = the Reporting API's reach report (same scope): thumbnail impressions and CTR per
 * video per day, the only place YouTube gives them. The first read starts the job.
 */
import {
  type AccountInsights,
  type ActivityQuery,
  type ActivityRow,
  type Audience,
  browserRead,
  type CommentRow,
  type ContentChannel,
  type FetchedWith,
  type FollowingRow,
  holdAt,
  type InsightGap,
  type Insights,
  type InsightsQuery,
  type InsightValue,
  knownGaps,
  type ListQuery,
  METRICS as M,
  type MediaHost,
  type Metrics,
  mediaFileOf,
  numberOf,
  type Post,
  type PostPatch,
  type Published,
  type PublishedRow,
  pageOf,
  previewOf,
  type ReportDays,
  readGroup,
  type SiteClient,
  withHook,
} from "@wren/core/content";
import { fieldsOf, languageName } from "@wren/core/content/shapes";

interface YouTubeContentOptions {
  now?: () => Date;
  /** Makes a laptop file or a stored object reachable from the box; absent = paths are the box's own. */
  host?: MediaHost;
  /** Default privacy for an upload; `extra.privacyStatus` on the post overrides. */
  privacy?: "public" | "unlisted" | "private";
}

const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
/** A community post has no API: autobrowse posts it in the browser (`google` profile). */
const COMMUNITY_PATH = "/studio/communityPosts";
const COMMUNITY_URL = "https://www.youtube.com/my_community";

interface Video {
  id: string;
  snippet?: { title?: string; description?: string; publishedAt?: string };
  status?: { publishAt?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}
/** What `videos.update` needs back whole: title and category, plus what it holds. */
interface Snippet {
  title?: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
}
interface PlaylistItem {
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    resourceId?: { videoId?: string };
  };
}
interface YtComment {
  id?: string;
  snippet?: {
    authorDisplayName?: string;
    authorChannelId?: { value?: string };
    textOriginal?: string;
    textDisplay?: string;
    publishedAt?: string;
  };
}
interface CommentThread {
  id?: string;
  /** `channelId`: the video's channel, ours. */
  snippet?: { channelId?: string; topLevelComment?: YtComment };
  /** Up to five replies ride along; YouTube threads one level. */
  replies?: { comments?: YtComment[] };
}

interface Subscription {
  id?: string;
  subscriberSnippet?: { title?: string; channelId?: string; description?: string };
  /** Ours, read with `mine`: the channel we subscribe to, and when. */
  snippet?: { title?: string; publishedAt?: string; resourceId?: { channelId?: string } };
}

/** Pages of 50 our subscriptions list reads at most: 1000 channels. */
const FOLLOWING_PAGES = 20;

/** YouTube Analytics' answer: named columns, then rows. */
interface Report {
  columnHeaders?: Array<{ name?: string }>;
  rows?: unknown[][];
}
/** Each row as an object by column name. */
export const reportRows = (r: Report): Array<Record<string, unknown>> => {
  const names = (r.columnHeaders ?? []).map((c) => c.name ?? "");
  return (r.rows ?? []).map((row) => Object.fromEntries(names.map((n, i) => [n, row[i]])));
};

/** `PT1M5S` → 65. */
export function isoSeconds(d: string | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return null;
  const [, days = "0", h = "0", min = "0", sec = "0"] = m;
  return Number(days) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(sec);
}

/** The video's totals: one report, its columns renamed to ours. */
// Views, likes and comments come from the Data API (live; Analytics lags a day or two).
const TOTALS: Record<string, string> = {
  estimatedMinutesWatched: M.watchMinutes,
  averageViewDuration: M.avgViewSecs,
  averageViewPercentage: M.avgViewPct,
  subscribersGained: M.follows,
  subscribersLost: M.unfollows,
  shares: M.shares,
  videosAddedToPlaylists: M.saves,
};
/** The channel's day report. */
const DAYS: Record<string, string> = {
  views: M.views,
  estimatedMinutesWatched: M.watchMinutes,
  subscribersGained: M.follows,
  subscribersLost: M.unfollows,
};
export const ANALYTICS_PATH = "/v2/reports";
/** The Reporting API's reach report: thumbnail impressions and their CTR per video per day. */
export const REACH_REPORT = "channel_reach_basic_a1";
const REACH_JOB = "wren reach";
/** Reports one read downloads at most; the rest wait for the next pass (the cursor says where). */
const REPORTS_PER_READ = 40;
const WAITING =
  "YouTube is making the first reach report: it lands within 2 days of the job starting, with the 30 days before";
const REACH_METRICS = [M.impressions, M.ctr, M.impressionsDay, M.ctrDay] as const;
interface ReportingJob {
  id?: string;
  reportTypeId?: string;
}
interface ReportingReport {
  id?: string;
  startTime?: string;
  createTime?: string;
}
/** `20261005` → `2026-10-05`. */
const dayOfReport = (d: string | undefined): string | null => {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(d ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** A CSV cell as a number; empty is unknown, not zero. */
const cell = (v: string | undefined): number => (v ? Number(v) : Number.NaN);

/**
 * A reach report's CSV rows as one row per video and day: impressions summed; `clicks` and
 * `rated` give the day's CTR. Google documents `video_thumbnail_impressions_ctr` as a percentage;
 * the first real report confirms it (a ratio would read 100 times low).
 *
 * `rated` is the impressions that came with a CTR. Rows without a video, a day or impressions
 * are dropped.
 */
export function reachRows(
  csv: ReadonlyArray<Record<string, string>>,
): Array<{ id: string; day: string; impressions: number; clicks: number; rated: number }> {
  const by = new Map<
    string,
    { id: string; day: string; impressions: number; clicks: number; rated: number }
  >();
  for (const r of csv) {
    const id = r.video_id;
    const day = dayOfReport(r.date);
    const n = cell(r.video_thumbnail_impressions);
    const ctr = cell(r.video_thumbnail_impressions_ctr);
    if (!id || !day || !Number.isFinite(n)) continue;
    const at = by.get(`${id}|${day}`) ?? { id, day, impressions: 0, clicks: 0, rated: 0 };
    at.impressions += n;
    if (Number.isFinite(ctr)) {
      at.clicks += (n * ctr) / 100;
      at.rated += n;
    }
    by.set(`${id}|${day}`, at);
  }
  return [...by.values()];
}
/** autobrowse `GET /studio/videos/{id}/analytics`: Studio's own totals for one video. */
interface StudioTotals {
  /** Percent of feed plays that stayed to watch (Shorts only). */
  viewedPct: number | null;
  avgViewSecs: number | null;
  avgViewPct: number | null;
  views: number | null;
}
const day = (iso: string) => iso.slice(0, 10);

/**
 * Each bucket's percent of the whole, summed over rows (YouTube's age and gender rows each
 * carry both). Rows with no bucket drop out.
 */
export function sharesOf(
  metric: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  keyOf: (r: Record<string, unknown>) => string | null,
  col: string,
): InsightValue[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    const v = Number(r[col]);
    if (k && Number.isFinite(v)) by.set(k, (by.get(k) ?? 0) + v);
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  return [...by].flatMap(([k, v]) => numberOf(metric, Math.round((v / total) * 10_000) / 100, k));
}
const AUDIENCE = [M.viewerAge, M.viewerGender, M.viewerCountry, M.viewerFollower];
const FOLLOWER: Record<string, string> = { SUBSCRIBED: "follower", UNSUBSCRIBED: "other" };

/** `videos.list` takes up to 50 ids in one call. */
const VIDEOS_PER_READ = 50;

export function youtubeContent(sites: SiteClient, o: YouTubeContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("youtube", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const read = <T>(resource: string, query: Record<string, unknown>) =>
    sites.call<T>("youtube", "GET", `/youtube/v3/${resource}`, query);
  /**
   * Counts and lengths for these videos, at most `VIDEOS_PER_READ` to a call. The length rides
   * along (the same one quota unit): `insights` needs it and it never changes.
   */
  const statistics = async (ids: string[]): Promise<Video[]> => {
    const out: Video[] = [];
    for (let i = 0; i < ids.length; i += VIDEOS_PER_READ) {
      const r = await read<{ items?: Video[] }>("videos", {
        part: "statistics,contentDetails",
        id: ids.slice(i, i + VIDEOS_PER_READ).join(","),
      });
      out.push(...(r.items ?? []));
    }
    return out;
  };
  const metricsOf = (v: Video, fetchedWith: FetchedWith): Metrics => {
    const s = v.statistics ?? {};
    return {
      id: v.id,
      views: Number(s.viewCount ?? 0),
      reactions: Number(s.likeCount ?? 0),
      comments: Number(s.commentCount ?? 0),
      shares: 0,
      read: { durationSecs: isoSeconds(v.contentDetails?.duration) },
      asOf: now().toISOString(),
      fetchedWith,
    };
  };
  let uploads: Promise<string> | null = null;
  const uploadsPlaylist = () => {
    uploads ??= read<{
      items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
    }>("channels", { part: "contentDetails", mine: "true" }).then((r) => {
      const id = r.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!id) throw new Error("youtube: the token's account has no channel");
      return id;
    });
    return uploads;
  };
  return {
    platform: "youtube",
    async publish(post: Post): Promise<Published> {
      const f = fieldsOf("youtube", post.extra);
      if (f.kind === "community") {
        const image = f.image;
        const r = await sites.call<{ url?: string | null }>("youtube", "POST", COMMUNITY_PATH, {
          text: post.text,
          ...(image ? { image: await mediaFileOf(image, o.host, "youtube") } : {}),
        });
        // The flow answers the new post's link when the list shows it; posted either way.
        const id = r.url ? /\/post\/([^/?#]+)/.exec(r.url)?.[1] : undefined;
        return {
          id: id ?? `community-${now().getTime()}`,
          url: r.url ?? COMMUNITY_URL,
          publishedAt: now().toISOString(),
          fetchedWith: await via("POST", COMMUNITY_PATH),
          ...(r.url
            ? {}
            : { notes: ["YouTube didn't show the post's link: find it on the Posts tab"] }),
        };
      }
      if (post.media?.kind !== "video")
        throw new Error(
          "youtube: a post is a video (media.kind = video, media.source = path or URL)",
        );
      const title = f.title ?? post.media.title;
      if (!title) throw new Error("youtube: a title is needed (media.title or extra.title)");
      const v = await sites.call<Video>("youtube", "POST", "/upload/youtube/v3/videos", {
        snippet: {
          title,
          description: post.text,
          ...(f.tags?.length ? { tags: f.tags } : {}),
          ...(f.categoryId ? { categoryId: f.categoryId } : {}),
          ...(f.defaultLanguage ? { defaultLanguage: f.defaultLanguage } : {}),
          ...(f.defaultAudioLanguage ? { defaultAudioLanguage: f.defaultAudioLanguage } : {}),
        },
        status: {
          // A set time: private until YouTube makes it public then.
          privacyStatus: f.publishAt ? "private" : (f.privacyStatus ?? o.privacy ?? "private"),
          ...(f.publishAt
            ? { publishAt: f.publishAt }
            : post.scheduledFor
              ? { publishAt: post.scheduledFor }
              : {}),
          selfDeclaredMadeForKids: f.madeForKids ?? false,
          ...(f.syntheticMedia !== undefined ? { containsSyntheticMedia: f.syntheticMedia } : {}),
        },
        ...(f.notifySubscribers !== undefined ? { notifySubscribers: f.notifySubscribers } : {}),
        file: await mediaFileOf(post.media.source, o.host, "youtube"),
      });
      // The video is up: what follows must not fail the post, or a retry would upload it twice.
      // A step that fails is a note on the draft (an unverified channel refuses custom thumbnails).
      const notes: string[] = [];
      const after = (what: string, step: () => Promise<unknown>) =>
        step().catch((err: Error) => void notes.push(`${what} not set: ${err.message}`));
      const thumb = f.kind === "short" ? undefined : f.thumbnail;
      if (thumb)
        await after("Thumbnail", async () =>
          sites.call("youtube", "POST", "/upload/youtube/v3/thumbnails/set", {
            videoId: v.id,
            file: await mediaFileOf(thumb, o.host, "youtube"),
            ...(/\.png$/i.test(thumb) ? { contentType: "image/png" } : {}),
          }),
        );
      const captions = f.captions;
      if (captions) {
        const language = f.captionsLanguage ?? "en";
        // The track's name in the CC menu: the language's ("English").
        await after("Subtitles", async () =>
          sites.call("youtube", "POST", "/upload/youtube/v3/captions", {
            videoId: v.id,
            language,
            name: languageName(language),
            file: await mediaFileOf(captions, o.host, "youtube"),
          }),
        );
      }
      if (f.playlistId) {
        const playlistId = f.playlistId;
        await after("Playlist", () =>
          sites.call("youtube", "POST", "/youtube/v3/playlistItems", { playlistId, videoId: v.id }),
        );
      }
      return {
        id: v.id,
        url: videoUrl(v.id),
        publishedAt: post.scheduledFor ?? v.snippet?.publishedAt ?? now().toISOString(),
        fetchedWith: await via("POST", "/upload/youtube/v3/videos"),
        ...(notes.length ? { notes } : {}),
      };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const r = await read<{ items?: PlaylistItem[] }>("playlistItems", {
        part: "snippet",
        playlistId: await uploadsPlaylist(),
        maxResults: Math.min(q.limit ?? 50, 50),
      });
      const fetchedWith = await via("GET", "/youtube/v3/playlistItems");
      const rows = (r.items ?? []).flatMap((it) => {
        const id = it.snippet?.resourceId?.videoId;
        return id
          ? [
              {
                id,
                url: videoUrl(id),
                publishedAt: it.snippet?.publishedAt ?? now().toISOString(),
                fetchedWith,
                preview: previewOf(it.snippet?.title ?? ""),
                ...(it.snippet?.title ? { title: it.snippet.title } : {}),
                text: it.snippet?.description ?? "",
              },
            ]
          : [];
      });
      return pageOf(rows, q);
    },
    // A swap on a live video: the snippet goes back whole (YouTube replaces the part), changed.
    async update(id: string, patch: PostPatch): Promise<void> {
      if (patch.title !== undefined || patch.hook !== undefined) {
        const r = await read<{ items?: Array<{ snippet?: Snippet }> }>("videos", {
          part: "snippet",
          id,
        });
        const s = r.items?.[0]?.snippet;
        if (!s) throw new Error(`youtube: no video ${id}`);
        const snippet = {
          title: patch.title ?? s.title ?? "",
          description:
            patch.hook !== undefined ? withHook(s.description ?? "", patch.hook) : s.description,
          categoryId: s.categoryId,
          ...(s.tags?.length ? { tags: s.tags } : {}),
          ...(s.defaultLanguage ? { defaultLanguage: s.defaultLanguage } : {}),
          ...(s.defaultAudioLanguage ? { defaultAudioLanguage: s.defaultAudioLanguage } : {}),
        };
        await sites.call("youtube", "PUT", "/youtube/v3/videos", { id, snippet });
      }
      const thumb = patch.thumbnail;
      if (thumb)
        await sites.call("youtube", "POST", "/upload/youtube/v3/thumbnails/set", {
          videoId: id,
          file: await mediaFileOf(thumb, o.host, "youtube"),
          ...(/\.png$/i.test(thumb) ? { contentType: "image/png" } : {}),
        });
    },
    async metrics(id: string): Promise<Metrics> {
      const v = (await statistics([id]))[0];
      if (!v?.statistics) throw new Error(`youtube: no video ${id}`);
      return metricsOf({ ...v, id }, await via("GET", "/youtube/v3/videos"));
    },
    /** One `videos.list` per 50 ids (its limit), where a post was one call each. */
    async metricsMany(posts: { id: string }[]): Promise<Metrics[]> {
      const items = (await statistics(posts.map((p) => p.id))).filter((v) => v.statistics);
      if (!items.length) return [];
      const fetchedWith = await via("GET", "/youtube/v3/videos");
      return items.map((v) => metricsOf(v, fetchedWith));
    },
    /** The same read gives every video's comment count; a video with comments off has none. */
    async commentCounts(ids: string[]): Promise<Record<string, number>> {
      const out: Record<string, number> = {};
      for (const v of await statistics(ids))
        if (v.statistics?.commentCount !== undefined) out[v.id] = Number(v.statistics.commentCount);
      return out;
    },
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      const r: { items?: CommentThread[] } = await read<{ items?: CommentThread[] }>(
        "commentThreads",
        {
          part: "snippet,replies",
          videoId: id,
          maxResults: Math.min(q.limit ?? 100, 100),
          order: "time",
        },
      ).catch((err: unknown) => {
        // Comments off on the video (or it's private): nothing to read, not a failure.
        if (err instanceof Error && /has disabled comments/.test(err.message)) return {};
        throw err;
      });
      const rowOf = (c: YtComment | undefined, own: string | undefined, parentId?: string) =>
        c?.id
          ? [
              {
                id: c.id,
                postId: id,
                author: c.snippet?.authorDisplayName ?? "",
                text: c.snippet?.textOriginal ?? c.snippet?.textDisplay ?? "",
                at: c.snippet?.publishedAt ?? now().toISOString(),
                ...(parentId ? { parentId } : {}),
                ...(own && c.snippet?.authorChannelId?.value === own ? { mine: true } : {}),
              },
            ]
          : [];
      // The replies under each comment come in the same read: a follow-up is not missed.
      const rows = (r.items ?? []).flatMap((t) => {
        const top = t.snippet?.topLevelComment;
        const cid = top?.id ?? t.id;
        const own = t.snippet?.channelId;
        if (!cid) return [];
        return [
          ...rowOf({ ...top, id: cid }, own),
          ...(t.replies?.comments ?? []).flatMap((c) => rowOf(c, own, cid)),
        ];
      });
      return pageOf(rows, q);
    },
    async reply(commentId: string, text: string): Promise<void> {
      await sites.call("youtube", "POST", "/youtube/v3/comments", {
        snippet: { parentId: commentId, textOriginal: text },
      });
    },
    // Only subscribers who keep their subscriptions public show up; the API gives no time.
    async activity(q: ActivityQuery = {}): Promise<ActivityRow[]> {
      const r = await read<{ items?: Subscription[] }>("subscriptions", {
        part: "subscriberSnippet",
        myRecentSubscribers: true,
        maxResults: Math.min(q.limit ?? 50, 50),
      });
      return (r.items ?? []).flatMap((s) => {
        const ch = s.subscriberSnippet?.channelId;
        const id = s.id ?? ch;
        if (!id) return [];
        const actor = s.subscriberSnippet?.title ?? null;
        return [
          {
            id,
            kind: "subscribe" as const,
            actor,
            actorUrl: ch ? `https://www.youtube.com/channel/${ch}` : null,
            text: `${actor ?? "Someone"} subscribed`,
            url: null,
            at: null,
            raw: s,
          },
        ];
      });
    },
    // Every channel ours subscribes to, with the time we did.
    async following(): Promise<FollowingRow[]> {
      const out: FollowingRow[] = [];
      let pageToken: string | undefined;
      for (let i = 0; i < FOLLOWING_PAGES; i++) {
        const r = await read<{ items?: Subscription[]; nextPageToken?: string }>("subscriptions", {
          part: "snippet",
          mine: true,
          maxResults: 50,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const s of r.items ?? []) {
          const ch = s.snippet?.resourceId?.channelId;
          if (ch)
            out.push({
              handle: ch,
              name: s.snippet?.title ?? null,
              url: `https://www.youtube.com/channel/${ch}`,
              at: s.snippet?.publishedAt ?? null,
            });
        }
        pageToken = r.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    },
    async audience(): Promise<Audience> {
      const r = await read<{ items?: Array<{ statistics?: { subscriberCount?: string } }> }>(
        "channels",
        { part: "statistics", mine: true },
      );
      const s = r.items?.[0]?.statistics;
      if (!s) throw new Error("youtube: the token's account has no channel");
      return { followers: Number(s.subscriberCount ?? 0), asOf: now().toISOString(), raw: r };
    },
    async insights(q: InsightsQuery): Promise<Insights> {
      const out: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      const end = day(now().toISOString());
      // A report wants dates; a video can't have numbers before it went up.
      const start = q.published && day(q.published) < end ? day(q.published) : end;
      const report = (query: Record<string, unknown>) =>
        sites.call<Report>("youtube", "GET", ANALYTICS_PATH, {
          ids: "channel==MINE",
          startDate: start,
          endDate: end,
          filters: `video==${q.id}`,
          ...query,
        });
      let duration: number | null = null;
      await readGroup(
        [M.durationSecs],
        async () => {
          // The look's counts read already carried it: no second read.
          const given = (q.read as { durationSecs?: unknown } | null | undefined)?.durationSecs;
          if (typeof given === "number") {
            duration = given;
            return numberOf(M.durationSecs, duration);
          }
          const r = await read<{ items?: Array<{ contentDetails?: { duration?: string } }> }>(
            "videos",
            { part: "contentDetails", id: q.id },
          );
          duration = isoSeconds(r.items?.[0]?.contentDetails?.duration);
          return numberOf(M.durationSecs, duration);
        },
        out,
      );
      const totals = Object.values(TOTALS);
      const live = await readGroup(
        totals,
        async () => {
          const row = reportRows(await report({ metrics: Object.keys(TOTALS).join(",") }))[0] ?? {};
          return Object.entries(TOTALS).flatMap(([theirs, ours]) =>
            numberOf(ours, row[theirs] ?? 0),
          );
        },
        out,
      );
      // No route or no scope: every report below answers the same, so ask once.
      const later = [
        M.retention,
        M.relativeRetention,
        M.hold3,
        M.hold30,
        M.trafficSource,
        M.searchTerm,
        ...AUDIENCE,
      ];
      if (!live) {
        const first = out.gaps.find((g) => g.metric === totals[0]);
        if (first) out.gaps.push(...knownGaps(first.state, first.why, later));
      } else {
        await readGroup(
          [M.retention, M.relativeRetention, M.hold3, M.hold30],
          async () => {
            const rows = reportRows(
              await report({
                dimensions: "elapsedVideoTimeRatio",
                metrics: "audienceWatchRatio,relativeRetentionPerformance",
              }),
            );
            const curve = rows.map((r) => ({
              ratio: Number(r.elapsedVideoTimeRatio),
              watch: Number(r.audienceWatchRatio),
              relative: Number(r.relativeRetentionPerformance),
            }));
            const at = (secs: number) => (duration ? secs / duration : -1);
            return [
              ...curve.flatMap((p) => numberOf(M.retention, p.watch, p.ratio.toFixed(2))),
              ...curve.flatMap((p) =>
                numberOf(M.relativeRetention, p.relative, p.ratio.toFixed(2)),
              ),
              ...numberOf(M.hold3, holdAt(curve, at(3))),
              ...numberOf(M.hold30, holdAt(curve, at(30))),
            ];
          },
          out,
        );
        await readGroup(
          [M.trafficSource],
          async () =>
            reportRows(
              await report({
                dimensions: "insightTrafficSourceType",
                metrics: "views",
                sort: "-views",
              }),
            ).flatMap((r) =>
              numberOf(M.trafficSource, r.views, String(r.insightTrafficSourceType)),
            ),
          out,
        );
        await readGroup(
          [M.searchTerm],
          async () =>
            reportRows(
              await report({
                dimensions: "insightTrafficSourceDetail",
                filters: `video==${q.id};insightTrafficSourceType==YT_SEARCH`,
                metrics: "views",
                sort: "-views",
                maxResults: 25,
              }),
            ).flatMap((r) =>
              numberOf(M.searchTerm, r.views, String(r.insightTrafficSourceDetail).slice(0, 200)),
            ),
          out,
        );
        // Who watched it: each a percent of its views.
        await readGroup(
          [M.viewerAge, M.viewerGender],
          async () => {
            const rows = reportRows(
              await report({ dimensions: "ageGroup,gender", metrics: "viewerPercentage" }),
            );
            return [
              ...sharesOf(
                M.viewerAge,
                rows,
                (r) => String(r.ageGroup ?? "").replace(/^age/, "") || null,
                "viewerPercentage",
              ),
              ...sharesOf(
                M.viewerGender,
                rows,
                (r) => String(r.gender ?? "") || null,
                "viewerPercentage",
              ),
            ];
          },
          out,
        );
        await readGroup(
          [M.viewerCountry],
          async () =>
            sharesOf(
              M.viewerCountry,
              reportRows(await report({ dimensions: "country", metrics: "views", sort: "-views" })),
              (r) => String(r.country ?? "") || null,
              "views",
            ),
          out,
        );
        await readGroup(
          [M.viewerFollower],
          async () =>
            sharesOf(
              M.viewerFollower,
              reportRows(await report({ dimensions: "subscribedStatus", metrics: "views" })),
              (r) => FOLLOWER[String(r.subscribedStatus)] ?? null,
              "views",
            ),
          out,
        );
        if (q.kind === "short")
          await readGroup(
            [M.engagedViews],
            async () => {
              const row = reportRows(await report({ metrics: "engagedViews" }))[0] ?? {};
              return numberOf(M.engagedViews, row.engagedViews ?? 0);
            },
            out,
          );
      }
      // Viewed vs swiped away: Studio's page only, in the box's browser.
      if (q.kind === "short")
        await browserRead(
          [M.skipRate],
          q,
          now(),
          async () => {
            const s = await sites.call<StudioTotals>(
              "youtube",
              "GET",
              `/studio/videos/${encodeURIComponent(q.id)}/analytics`,
              {},
            );
            return typeof s.viewedPct === "number"
              ? numberOf(M.skipRate, Math.round((100 - s.viewedPct) * 100) / 100)
              : [];
          },
          out,
        );
      return { ...out, asOf: now().toISOString() };
    },
    async reportDays(q: { after?: string | null }): Promise<ReportDays> {
      const out: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      const rows: ReportDays["rows"] = [];
      let cursor = q.after ?? null;
      await readGroup(
        REACH_METRICS,
        async () => {
          const { jobs } = await sites.call<{ jobs?: ReportingJob[] }>(
            "youtube",
            "GET",
            "/v1/jobs",
            {},
          );
          const job =
            jobs?.find((j) => j.reportTypeId === REACH_REPORT) ??
            (await sites.call<ReportingJob>("youtube", "POST", "/v1/jobs", {
              reportTypeId: REACH_REPORT,
              name: REACH_JOB,
            }));
          if (!job.id) throw new Error("youtube: the reach report job came back without an id");
          const found: ReportingReport[] = [];
          let pageToken: string | undefined;
          do {
            const page = await sites.call<{
              reports?: ReportingReport[];
              nextPageToken?: string;
            }>("youtube", "GET", `/v1/jobs/${job.id}/reports`, {
              ...(cursor ? { createdAfter: cursor } : {}),
              ...(pageToken ? { pageToken } : {}),
            });
            found.push(...(page.reports ?? []));
            pageToken = page.nextPageToken;
          } while (pageToken);
          if (!found.length && !cursor)
            out.gaps.push(...knownGaps("waiting", WAITING, REACH_METRICS));
          // Oldest made first; a later report for the same day replaces it (a backfill).
          const take = found
            .filter((r) => r.id && r.createTime)
            .sort((a, b) => (a.createTime as string).localeCompare(b.createTime as string))
            .slice(0, REPORTS_PER_READ);
          const byDay = new Map<string, ReportingReport>();
          for (const r of take) byDay.set(r.startTime ?? (r.id as string), r);
          for (const r of byDay.values()) {
            const got = await sites.call<{ rows?: Array<Record<string, string>> }>(
              "youtube",
              "GET",
              `/v1/jobs/${job.id}/reports/${r.id}/rows`,
              {},
            );
            for (const v of reachRows(got.rows ?? []))
              rows.push({
                id: v.id,
                day: v.day,
                values: [
                  { metric: M.impressionsDay, value: v.impressions },
                  ...numberOf(M.ctrDay, v.rated > 0 ? (v.clicks / v.rated) * 100 : null),
                ],
              });
          }
          cursor = take.at(-1)?.createTime ?? cursor;
          return [];
        },
        out,
      );
      return { rows, gaps: out.gaps, cursor, asOf: now().toISOString() };
    },
    async accountInsights(): Promise<AccountInsights> {
      const out: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      const end = now();
      const start = new Date(end.getTime() - 7 * 86_400_000);
      const days = new Map<string, InsightValue[]>();
      await readGroup(
        Object.values(DAYS),
        async () => {
          const rows = reportRows(
            await sites.call<Report>("youtube", "GET", ANALYTICS_PATH, {
              ids: "channel==MINE",
              startDate: day(start.toISOString()),
              endDate: day(end.toISOString()),
              dimensions: "day",
              metrics: Object.keys(DAYS).join(","),
              sort: "day",
            }),
          );
          for (const r of rows)
            days.set(
              String(r.day),
              Object.entries(DAYS).flatMap(([theirs, ours]) => numberOf(ours, r[theirs] ?? 0)),
            );
          return [];
        },
        out,
      );
      return {
        days: [...days].map(([d, values]) => ({ day: d, values })),
        gaps: out.gaps,
        asOf: end.toISOString(),
      };
    },
  };
}
