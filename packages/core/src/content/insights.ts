/**
 * A post's and an account's deeper numbers (designs/2026-10-07-content-analytics.md): whatever
 * the platform's token can read, as long rows (`metric`, `key`, `value`), plus a gap per number
 * it can't, with the platform's own words. A refusal is a gap, never a throw, so one missing
 * scope never costs the numbers that came back.
 */
import { SiteCallError } from "./autobrowse.js";
import type { FetchedWith } from "./index.js";

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
 * One number. `key` splits a metric: the share of the video for `retention` ("0.00"–"1.00"), the
 * source for `traffic_source`, the words for `search_term`, the bucket for a `viewer_*` share
 * (`viewer_age` "25-34", `viewer_gender` "female", `viewer_country` "CA", `viewer_follower`
 * "follower" | "other"). Absent for a plain number.
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
  /**
   * Set when one leg read the post's own counts too (LinkedIn's analytics page): a post whose
   * counts read failed takes its look from these.
   */
  fetchedWith?: FetchedWith;
}

export interface InsightsQuery {
  id: string;
  /** ISO time it went up: where a report's dates start. */
  published?: string | null;
  /** Its shape's kind: `short`, `video`, `carousel`, `thread`. */
  kind?: string | null;
  /** What it carries: X reads a video's watch numbers only on a post with one. */
  media?: "image" | "video" | null;
  /** `Metrics.read` from this look's counts: what the post's own read just answered. */
  read?: unknown;
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
  searchAppearances: "search_appearances",
  linkClicks: "link_clicks",
  profileClicks: "profile_clicks",
  avgViewSecs: "avg_view_secs",
  avgViewPct: "avg_view_pct",
  watchMinutes: "watch_minutes",
  engagedViews: "engaged_views",
  durationSecs: "duration_secs",
  /** Share still watching 3 s in (0..1): the hook where no skip rate comes. */
  hold3: "hold_3s",
  hold30: "hold_30s",
  retention: "retention",
  relativeRetention: "relative_retention",
  trafficSource: "traffic_source",
  searchTerm: "search_term",
  upvoteRatio: "upvote_ratio",
  /** Percent of plays swiped away in the first seconds. */
  skipRate: "skip_rate",
  /** Percent of views watched to the end. */
  finishRate: "finish_rate",
  /** Percent of views per bucket; `key` is the bucket. */
  viewerAge: "viewer_age",
  viewerGender: "viewer_gender",
  viewerCountry: "viewer_country",
  viewerFollower: "viewer_follower",
  /** Percent of views from viewers new to the account ("new") or back again ("returning"). */
  viewerReturn: "viewer_return",
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
 * The gap a failed read is. autobrowse's access code first: need_login a sign-in only William
 * can make (the why names the command), platform_blocked the platform refusing, rate_limited and
 * upstream_broken a retry. Uncoded: 401 or 403 a missing scope, 404 a route the box doesn't
 * serve, 501 no leg, any other 4xx the platform refusing (its words kept). Null: the caller
 * retries.
 */
export function gapStateOf(err: unknown): GapState | null {
  if (!(err instanceof SiteCallError)) return null;
  if (err.code === "need_login") return "needs_william";
  if (err.code === "platform_blocked") return "error";
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

/** Days after a post went up when a browser read runs: 5 reads a post, light on the account. */
const BROWSER_READ_DAYS: readonly number[] = [1, 3, 7, 14, 28];
const DAY_MS = 86_400_000;

/** Whether today is one of a post's browser-read days (whole days since it went up). */
export function browserReadDue(published: string | null | undefined, now: Date): boolean {
  if (!published) return false;
  const at = Date.parse(published);
  if (Number.isNaN(at)) return false;
  return BROWSER_READ_DAYS.includes(Math.floor((now.getTime() - at) / DAY_MS));
}

/**
 * Read a group of numbers off a page in the box's browser. Light: only on `BROWSER_READ_DAYS`.
 * A day over the box's cap (429) reads nothing; any other failure is a gap, never a retry, so
 * a broken page costs one read, not a storm. A day with no read writes nothing: the last read's
 * numbers and states stand.
 */
export async function browserRead(
  metrics: readonly string[],
  q: Pick<InsightsQuery, "published">,
  now: Date,
  work: () => Promise<InsightValue[]>,
  into: { values: InsightValue[]; gaps: InsightGap[] },
): Promise<boolean> {
  if (!browserReadDue(q.published, now)) return false;
  try {
    into.values.push(...(await work()));
    return true;
  } catch (err) {
    if (err instanceof SiteCallError && err.status === 429) return false;
    const why = (err instanceof Error ? err.message : String(err)).slice(0, WHY_MAX);
    for (const metric of metrics)
      into.gaps.push({ metric, state: gapStateOf(err) ?? "error", why });
    return false;
  }
}

/** Share still watching at `at` (a ratio of the video): the curve's nearest point. */
export function holdAt(
  curve: ReadonlyArray<{ ratio: number; watch: number }>,
  at: number,
): number | null {
  if (!curve.length || at < 0 || at > 1) return null;
  let best = curve[0] as { ratio: number; watch: number };
  for (const p of curve) if (Math.abs(p.ratio - at) < Math.abs(best.ratio - at)) best = p;
  return best.watch;
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
