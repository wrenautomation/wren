/**
 * A post's and an account's deeper numbers (designs/2026-10-07-content-analytics.md): whatever
 * the platform's token can read, as long rows (`metric`, `key`, `value`), plus a gap per number
 * it can't, with the platform's own words. A refusal is a gap, never a throw, so one missing
 * scope never costs the numbers that came back.
 */
import { SiteCallError } from "./autobrowse.js";

/**
 * Why a number is missing: a consent away, an application only William can make, not built,
 * app-only, refused, or asked for and on its way (a report job's first report).
 */
export const GAP_STATES = [
  "needs_scope",
  "needs_william",
  "not_built",
  "no_api",
  "error",
  "waiting",
] as const;
export type GapState = (typeof GAP_STATES)[number];

/**
 * One number. `key` splits a metric: the tenth of the video for `retention`, the source for
 * `traffic_source`, the words for `search_term`. Absent for a plain number.
 */
export interface InsightValue {
  metric: string;
  key?: string;
  value: number;
}

export interface InsightGap {
  metric: string;
  state: GapState;
  /** The platform's words, or ours when we know it can't. */
  why: string;
}

export interface Insights {
  values: InsightValue[];
  gaps: InsightGap[];
  asOf: string;
}

export interface InsightsQuery {
  id: string;
  /** ISO time it went up: where a report's dates start. */
  published?: string | null;
  /** Its shape's kind: `short`, `video`, `carousel`, `thread`. */
  kind?: string | null;
  /** What it carries: X reads a video's watch numbers only on a post with one. */
  media?: "image" | "video" | null;
}

/** An account's numbers per day (`day` = YYYY-MM-DD). */
export interface AccountInsights {
  days: Array<{ day: string; values: InsightValue[] }>;
  gaps: InsightGap[];
  asOf: string;
}

/**
 * A platform's bulk report per post per day (YouTube's reach report): each row is one post's
 * numbers for its own `day`, not a look's. `cursor` is where the next read starts (the newest
 * report's create time); a later report for the same day replaces it (a backfill).
 */
export interface ReportDays {
  rows: Array<{ id: string; day: string; values: InsightValue[] }>;
  gaps: InsightGap[];
  cursor: string | null;
  asOf: string;
}

/** The metric names every adapter answers in, so one page reads them all. */
export const METRICS = {
  views: "views",
  reach: "reach",
  impressions: "impressions",
  ctr: "ctr",
  /** One day's own impressions and CTR (percent) from a report; `impressions`/`ctr` are the totals to that day. */
  impressionsDay: "impressions_day",
  ctrDay: "ctr_day",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saves: "saves",
  interactions: "interactions",
  follows: "follows",
  unfollows: "unfollows",
  profileVisits: "profile_visits",
  linkClicks: "link_clicks",
  profileClicks: "profile_clicks",
  avgViewSecs: "avg_view_secs",
  avgViewPct: "avg_view_pct",
  watchMinutes: "watch_minutes",
  engagedViews: "engaged_views",
  durationSecs: "duration_secs",
  hold30: "hold_30s",
  retention: "retention",
  relativeRetention: "relative_retention",
  trafficSource: "traffic_source",
  searchTerm: "search_term",
  upvoteRatio: "upvote_ratio",
  skipRate: "skip_rate",
  followers: "followers",
  accountsEngaged: "accounts_engaged",
  /** Shares sent in a private message (LinkedIn's "Sends on LinkedIn"). */
  sends: "sends",
  /** A post's video plays (X's media `view_count`). */
  videoViews: "video_views",
  /** Plays that reached a share of the video, keyed by percent ("0", "25", "50", "75", "100"). */
  playback: "playback",
} as const;
export type MetricName = (typeof METRICS)[keyof typeof METRICS];

const WHY_MAX = 300;

/**
 * The gap a failed read is: 401 or 403 a missing scope, 404 a route the box doesn't serve, 501
 * no leg, any other 4xx the platform refusing (its words kept). Null: not a refusal, the caller
 * retries.
 */
export function gapStateOf(err: unknown): GapState | null {
  if (!(err instanceof SiteCallError)) return null;
  if (err.status === 401 || err.status === 403) return "needs_scope";
  if (err.status === 404 || err.status === 501) return "not_built";
  if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429)
    return "error";
  return null;
}

/**
 * Read a group of numbers in one call. A refusal makes each of `metrics` a gap; anything else
 * (a timeout, a 5xx) throws so the caller's step retries.
 */
export async function readGroup(
  metrics: readonly string[],
  work: () => Promise<InsightValue[]>,
  into: { values: InsightValue[]; gaps: InsightGap[] },
): Promise<boolean> {
  try {
    into.values.push(...(await work()));
    return true;
  } catch (err) {
    const state = gapStateOf(err);
    if (!state) throw err;
    const why = (err instanceof Error ? err.message : String(err)).slice(0, WHY_MAX);
    for (const metric of metrics) into.gaps.push({ metric, state, why });
    return false;
  }
}

/** Gaps we know before asking: the platform keeps these in its own app. */
export const knownGaps = (state: GapState, why: string, metrics: readonly string[]): InsightGap[] =>
  metrics.map((metric) => ({ metric, state, why }));

/** A number, or nothing when the platform sent none or not a number. */
export const numberOf = (metric: string, v: unknown, key?: string): InsightValue[] => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n)
    ? [{ metric, value: n, ...(key !== undefined ? { key } : {}) }]
    : [];
};
