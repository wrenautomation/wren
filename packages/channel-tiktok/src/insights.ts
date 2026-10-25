/**
 * A TikTok video's deeper numbers off its TikTok Studio analytics page, read in the box's browser
 * (`GET /web/videos/{id}/analytics`, autobrowse `tiktok/video-analytics`). The Display API gives
 * counts only; the Business API needs a TikTok for Business account. TikTok gives each share as
 * 0..1; Wren stores percents (`viewer_*`, `finish_rate`) and views (`traffic_source`,
 * `search_term`, like YouTube's). TikTok holds most fields until a video has 100 views: those are
 * `waiting`.
 */
import {
  browserRead,
  holdAt,
  type InsightGap,
  type Insights,
  type InsightsQuery,
  type InsightValue,
  knownGaps,
  METRICS as M,
  numberOf,
  type SiteClient,
} from "@wren/core/content";

export interface Bucket {
  key: string;
  value: number;
}

/** What the box's Studio read answers; null where the page had no data. */
export interface TikTokVideoAnalytics {
  durationSecs: number | null;
  views: number | null;
  uniqueViewers: number | null;
  totalPlaySecs: number | null;
  avgWatchSecs: number | null;
  finishRate: number | null;
  newFollowers: number | null;
  /** Key = the point in the video in seconds, value = the share still watching. */
  retention: Bucket[] | null;
  sources: Bucket[] | null;
  searchTerms: Bucket[] | null;
  age: Bucket[] | null;
  gender: Bucket[] | null;
  location: Bucket[] | null;
  followerShare: number | null;
  nonFollowerShare: number | null;
  newViewerShare: number | null;
  returnViewerShare: number | null;
}

/** What the Studio page reads. */
const STUDIO_METRICS = [
  M.durationSecs,
  M.reach,
  M.watchMinutes,
  M.avgViewSecs,
  M.avgViewPct,
  M.finishRate,
  M.follows,
  M.retention,
  M.hold3,
  M.hold30,
  M.trafficSource,
  M.searchTerm,
  M.viewerAge,
  M.viewerGender,
  M.viewerCountry,
  M.viewerFollower,
  M.viewerReturn,
] as const;

const BUSINESS_ONLY =
  "TikTok gives saves and profile visits in its Business API, which needs a TikTok for Business account";
const HELD = "TikTok shows this once the video has 100 views";

/** A share as a percent: TikTok gives 0..1; a value past 1 is a percent already. */
const pct = (v: number) => Math.round((v <= 1 ? v * 100 : v) * 100) / 100;
const share = (v: number) => (v <= 1 ? v : v / 100);

/** The Studio read as Wren's rows; a field the page held back is a `waiting` gap. */
export function studioRead(a: TikTokVideoAnalytics): {
  values: InsightValue[];
  gaps: InsightGap[];
} {
  const values: InsightValue[] = [];
  const held: string[] = [];
  const put = (metric: string, rows: InsightValue[]) => {
    if (rows.length) values.push(...rows);
    else held.push(metric);
  };
  const duration = a.durationSecs && a.durationSecs > 0 ? a.durationSecs : null;
  put(M.durationSecs, numberOf(M.durationSecs, duration));
  put(M.reach, numberOf(M.reach, a.uniqueViewers));
  put(
    M.watchMinutes,
    numberOf(M.watchMinutes, a.totalPlaySecs === null ? null : a.totalPlaySecs / 60),
  );
  put(M.avgViewSecs, numberOf(M.avgViewSecs, a.avgWatchSecs));
  put(
    M.avgViewPct,
    numberOf(
      M.avgViewPct,
      a.avgWatchSecs !== null && duration
        ? Math.round((a.avgWatchSecs / duration) * 10_000) / 100
        : null,
    ),
  );
  put(M.finishRate, numberOf(M.finishRate, a.finishRate === null ? null : pct(a.finishRate)));
  put(M.follows, numberOf(M.follows, a.newFollowers));
  // The curve keyed like YouTube's: the share of the video ("0.00"–"1.00").
  const curve = duration
    ? (a.retention ?? [])
        .map((b) => ({ ratio: Number(b.key) / duration, watch: share(b.value) }))
        .filter((p) => Number.isFinite(p.ratio) && p.ratio >= 0 && p.ratio <= 1)
    : [];
  put(
    M.retention,
    curve.flatMap((p) => numberOf(M.retention, p.watch, p.ratio.toFixed(2))),
  );
  put(M.hold3, numberOf(M.hold3, duration ? holdAt(curve, 3 / duration) : null));
  put(M.hold30, numberOf(M.hold30, duration ? holdAt(curve, 30 / duration) : null));
  // Sources and search words as views, like YouTube's.
  const views = a.views ?? 0;
  const asViews = (metric: string, buckets: Bucket[] | null, cap = Number.POSITIVE_INFINITY) =>
    (buckets ?? [])
      .slice(0, cap)
      .flatMap((b) => numberOf(metric, Math.round(share(b.value) * views), b.key.slice(0, 200)));
  put(M.trafficSource, asViews(M.trafficSource, a.sources));
  put(M.searchTerm, asViews(M.searchTerm, a.searchTerms, 25));
  const shares = (metric: string, buckets: Bucket[] | null, keyOf = (k: string) => k) =>
    (buckets ?? []).flatMap((b) => numberOf(metric, pct(b.value), keyOf(b.key)));
  put(M.viewerAge, shares(M.viewerAge, a.age));
  put(
    M.viewerGender,
    shares(M.viewerGender, a.gender, (k) => k.replace(/_vv$/, "")),
  );
  put(M.viewerCountry, shares(M.viewerCountry, a.location));
  const pair = (metric: string, first: [string, number | null], second: [string, number | null]) =>
    [first, second].flatMap(([key, v]) => numberOf(metric, v === null ? null : pct(v), key));
  put(
    M.viewerFollower,
    pair(M.viewerFollower, ["follower", a.followerShare], ["other", a.nonFollowerShare]),
  );
  put(
    M.viewerReturn,
    pair(M.viewerReturn, ["new", a.newViewerShare], ["returning", a.returnViewerShare]),
  );
  return { values, gaps: knownGaps("waiting", HELD, held) };
}

/**
 * The video's Studio numbers on its browser days (`browserRead`), plus the Business API's
 * numbers as gaps. A video still under its publish id (private, processing) has no page yet.
 */
export async function tiktokInsights(
  sites: SiteClient,
  q: InsightsQuery,
  now: Date,
): Promise<Insights> {
  const out: { values: InsightValue[]; gaps: InsightGap[] } = {
    values: [],
    gaps: knownGaps("needs_william", BUSINESS_ONLY, [M.saves, M.profileVisits]),
  };
  if (/^\d+$/.test(q.id))
    await browserRead(
      STUDIO_METRICS,
      q,
      now,
      async () => {
        const r = studioRead(
          await sites.call<TikTokVideoAnalytics>(
            "tiktok",
            "GET",
            `/web/videos/${q.id}/analytics`,
            {},
          ),
        );
        out.gaps.push(...r.gaps);
        return r.values;
      },
      out,
    );
  return { ...out, asOf: now.toISOString() };
}
