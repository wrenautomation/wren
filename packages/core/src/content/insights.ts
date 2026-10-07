/**
 * A post's and an account's deeper numbers (designs/2026-10-07-content-analytics.md): whatever
 * the platform's token can read, as long rows (`metric`, `key`, `value`), plus a gap per number
 * it can't, with the platform's own words. A refusal is a gap, never a throw, so one missing
 * scope never costs the numbers that came back.
 */
import { SiteCallError } from "./autobrowse.js";

/** Why a number is missing: a consent away, an application only William can make, not built, or app-only. */
export const GAP_STATES = ["needs_scope", "needs_william", "not_built", "no_api", "error"] as const;
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
}

/** An account's numbers per day (`day` = YYYY-MM-DD). */
export interface AccountInsights {
  days: Array<{ day: string; values: InsightValue[] }>;
  gaps: InsightGap[];
  asOf: string;
}

/** The metric names every adapter answers in, so one page reads them all. */
export const METRICS = {
  views: "views",
  reach: "reach",
  impressions: "impressions",
  ctr: "ctr",
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
