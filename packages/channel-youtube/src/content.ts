/**
 * YouTube as a `ContentChannel`, over autobrowse's site API in the Data
 * API v3's shape. Publish = a resumable upload of a file the worker can
 * read (a path on the worker or a URL); list = the channel's uploads
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
  type CommentRow,
  type ContentChannel,
  type FetchedWith,
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
  type Published,
  type PublishedRow,
  pageOf,
  previewOf,
  type ReportDays,
  readGroup,
  type SiteClient,
} from "@wren/core/content";
import { fieldsOf, languageName } from "@wren/core/content/shapes";

export interface YouTubeContentOptions {
  now?: () => Date;
  /** Makes a laptop file or a stored object reachable from the box; absent = paths are the box's own. */
  host?: MediaHost;
  /** Default privacy for an upload; `extra.privacyStatus` on the post overrides. */
  privacy?: "public" | "unlisted" | "private";
}

const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

interface Video {
  id: string;
  snippet?: { title?: string; description?: string; publishedAt?: string };
  status?: { publishAt?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}
interface PlaylistItem {
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    resourceId?: { videoId?: string };
  };
}
interface CommentThread {
  id?: string;
  snippet?: {
    topLevelComment?: {
      id?: string;
      snippet?: {
        authorDisplayName?: string;
        textOriginal?: string;
        textDisplay?: string;
        publishedAt?: string;
      };
    };
  };
}

interface Subscription {
  id?: string;
  subscriberSnippet?: { title?: string; channelId?: string; description?: string };
}

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
export const REACH_JOB = "wren reach";
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
const STUDIO_ONLY = "YouTube shows viewed vs swiped away in Studio only";
const day = (iso: string) => iso.slice(0, 10);

/** Share still watching `secs` in: the curve's point at that ratio of the video. */
export function holdAt(
  curve: ReadonlyArray<{ ratio: number; watch: number }>,
  at: number,
): number | null {
  if (!curve.length || at < 0) return null;
  const sorted = [...curve].sort((a, b) => a.ratio - b.ratio);
  if (at > 1) return null;
  let best = sorted[0] as { ratio: number; watch: number };
  for (const p of sorted) if (Math.abs(p.ratio - at) < Math.abs(best.ratio - at)) best = p;
  return best.watch;
}

export function youtubeContent(sites: SiteClient, o: YouTubeContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("youtube", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const read = <T>(resource: string, query: Record<string, unknown>) =>
    sites.call<T>("youtube", "GET", `/youtube/v3/${resource}`, query);
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
      if (post.media?.kind !== "video")
        throw new Error(
          "youtube: a post is a video (media.kind = video, media.source = path or URL)",
        );
      const f = fieldsOf("youtube", post.extra);
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
          privacyStatus: f.privacyStatus ?? o.privacy ?? "private",
          ...(post.scheduledFor ? { publishAt: post.scheduledFor } : {}),
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
              },
            ]
          : [];
      });
      return pageOf(rows, q);
    },
    async metrics(id: string): Promise<Metrics> {
      const r = await read<{ items?: Video[] }>("videos", { part: "statistics", id });
      const s = r.items?.[0]?.statistics;
      if (!s) throw new Error(`youtube: no video ${id}`);
      return {
        id,
        views: Number(s.viewCount ?? 0),
        reactions: Number(s.likeCount ?? 0),
        comments: Number(s.commentCount ?? 0),
        shares: 0,
        asOf: now().toISOString(),
        fetchedWith: await via("GET", "/youtube/v3/videos"),
      };
    },
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      const r = await read<{ items?: CommentThread[] }>("commentThreads", {
        part: "snippet",
        videoId: id,
        maxResults: Math.min(q.limit ?? 100, 100),
        order: "time",
      });
      const rows = (r.items ?? []).flatMap((t) => {
        const c = t.snippet?.topLevelComment;
        const cid = c?.id ?? t.id;
        return cid
          ? [
              {
                id: cid,
                postId: id,
                author: c?.snippet?.authorDisplayName ?? "",
                text: c?.snippet?.textOriginal ?? c?.snippet?.textDisplay ?? "",
                at: c?.snippet?.publishedAt ?? now().toISOString(),
              },
            ]
          : [];
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
      const later = [M.retention, M.relativeRetention, M.hold30, M.trafficSource, M.searchTerm];
      if (!live) {
        const first = out.gaps.find((g) => g.metric === totals[0]);
        if (first) out.gaps.push(...knownGaps(first.state, first.why, later));
      } else {
        await readGroup(
          [M.retention, M.relativeRetention, M.hold30],
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
            const at = duration ? 30 / duration : -1;
            return [
              ...curve.flatMap((p) => numberOf(M.retention, p.watch, p.ratio.toFixed(2))),
              ...curve.flatMap((p) =>
                numberOf(M.relativeRetention, p.relative, p.ratio.toFixed(2)),
              ),
              ...numberOf(M.hold30, holdAt(curve, at)),
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
      if (q.kind === "short") out.gaps.push(...knownGaps("no_api", STUDIO_ONLY, [M.skipRate]));
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
