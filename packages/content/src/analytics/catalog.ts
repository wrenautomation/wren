/**
 * Every number a post or an account can earn, per platform (designs/2026-10-07-content-analytics.md):
 * what it is, the API and scope behind it, whether we read it, and the one step that would let us.
 * The design doc's tables are this list; a test keeps its counts in step. A metric's state on a
 * page is the platform's last answer (`metric_sources`) when there is one, this list's when not.
 */
import { type GapState, METRICS as M, type Platform } from "@wren/core/content";
import type { FunnelStage } from "../schema.js";

/** A catalog row's word; `error` and `waiting` only ever come from a platform's answer. */
export type CatalogState = "live" | Exclude<GapState, "error" | "waiting">;
/** Where on a platform: YouTube's long videos and Shorts read differently; the rest are posts. */
export type Surface = "long" | "short" | "post";
/** What the number is about, as the doc groups them. */
export type MetricGroup =
  | "reach"
  | "retention"
  | "engagement"
  | "conversation"
  | "funnel"
  | "iteration"
  | "account";

export interface CatalogEntry {
  platform: Platform | "all";
  /** Absent: every surface of the platform. */
  surface?: Surface;
  label: string;
  /** The stored names it covers; a derived number names its own. */
  metrics: readonly string[];
  group: MetricGroup;
  stage: FunnelStage;
  state: CatalogState;
  api: string;
  /** The name a "Needs scope" line gives, and the one step that ends it. */
  needs?: Need;
}

export interface Need {
  name: string;
  step: string;
}

export const NEEDS = {
  youtubeAnalytics: {
    name: "YouTube Analytics",
    step: "Turn on the YouTube Analytics and YouTube Reporting APIs in the wrenautomation Cloud project, then run `pnpm -s autobrowse site setup youtube consent --account <the channel's Google login>` and click Allow.",
  },
  youtubeReach: {
    name: "YouTube reach report",
    step: "The YouTube Analytics step (same APIs, same consent). The next metrics pass starts the daily job; its first report lands within 2 days.",
  },
  linkedinAnalytics: {
    name: "LinkedIn Community Management API",
    step: "Request the Community Management API for Wren's LinkedIn app (developer portal, Products), then consent again with r_member_postAnalytics.",
  },
  tiktokBusiness: {
    name: "TikTok Business API",
    step: "Apply for TikTok for Business API access on the Wren account.",
  },
  instagramMessages: {
    name: "Instagram messages",
    step: "Meta app review for instagram_manage_messages on the Wren app, then we send and read Instagram DMs.",
  },
} as const satisfies Record<string, Need>;

const DATA = "Data API v3, youtube.readonly";
const YTA = "YouTube Analytics reports, yt-analytics.readonly";
const GRAPH = "Graph API media insights, instagram_manage_insights";
const OURS = "our own rows";

type Row = [
  platform: CatalogEntry["platform"],
  surface: Surface | null,
  label: string,
  metrics: readonly string[],
  group: MetricGroup,
  stage: FunnelStage,
  state: CatalogState,
  api: string,
  needs?: Need,
];
const entry = ([
  platform,
  surface,
  label,
  metrics,
  group,
  stage,
  state,
  api,
  needs,
]: Row): CatalogEntry => ({
  platform,
  ...(surface ? { surface } : {}),
  label,
  metrics,
  group,
  stage,
  state,
  api,
  ...(needs ? { needs } : {}),
});
const YA = NEEDS.youtubeAnalytics;
const TT = NEEDS.tiktokBusiness;

export const ANALYTICS_CATALOG: readonly CatalogEntry[] = (
  [
    // ---- Every platform: built here from our own rows ----
    ["all", null, "Engagement per view", ["engagement"], "engagement", "trust", "live", OURS],
    ["all", null, "Engagement per follower", ["per_follower"], "engagement", "trust", "live", OURS],
    [
      "all",
      null,
      "Post to site",
      ["clicks", "to_site"],
      "funnel",
      "convert",
      "live",
      "the lander's /go/ links",
    ],
    [
      "all",
      null,
      "Site to form, booking, won",
      ["forms", "calls", "won"],
      "funnel",
      "convert",
      "live",
      "the lander's export, bookings, invoices",
    ],
    [
      "all",
      null,
      "Revenue per post, first and last touch",
      ["revenue_first", "revenue_last"],
      "funnel",
      "convert",
      "live",
      "paid invoices by client email",
    ],
    ["all", null, "Best time to post", ["best_hour"], "iteration", "reach", "live", OURS],
    ["all", null, "Cadence against goals", ["cadence"], "iteration", "reach", "live", OURS],
    ["all", null, "Leaderboard by format and stage", ["score"], "iteration", "trust", "live", OURS],
    [
      "all",
      null,
      "What worked, and what to make next",
      ["digest"],
      "iteration",
      "trust",
      "live",
      OURS,
    ],

    // ---- YouTube long-form (a Short reads these too) ----
    ["youtube", "long", "Views", [M.views], "reach", "reach", "live", DATA],
    [
      "youtube",
      "long",
      "Impressions and CTR",
      [M.impressions, M.ctr],
      "reach",
      "reach",
      "needs_scope",
      "Reporting API reach report, yt-analytics.readonly",
      NEEDS.youtubeReach,
    ],
    [
      "youtube",
      "long",
      "Traffic sources",
      [M.trafficSource],
      "reach",
      "reach",
      "needs_scope",
      YTA,
      YA,
    ],
    ["youtube", "long", "Search terms", [M.searchTerm], "reach", "reach", "needs_scope", YTA, YA],
    [
      "youtube",
      "long",
      "Subscribers gained and lost",
      [M.follows, M.unfollows],
      "reach",
      "reach",
      "needs_scope",
      YTA,
      YA,
    ],
    [
      "youtube",
      "long",
      "Average view duration and % viewed",
      [M.avgViewSecs, M.avgViewPct],
      "retention",
      "trust",
      "needs_scope",
      YTA,
      YA,
    ],
    [
      "youtube",
      "long",
      "Retention curve",
      [M.retention, M.relativeRetention],
      "retention",
      "trust",
      "needs_scope",
      YTA,
      YA,
    ],
    ["youtube", "long", "Rewatches", [M.retention], "retention", "trust", "needs_scope", YTA, YA],
    [
      "youtube",
      "long",
      "Watch time",
      [M.watchMinutes],
      "retention",
      "trust",
      "needs_scope",
      YTA,
      YA,
    ],
    [
      "youtube",
      "long",
      "Likes and comments",
      [M.likes, M.comments],
      "engagement",
      "trust",
      "live",
      DATA,
    ],
    [
      "youtube",
      "long",
      "Shares and saves",
      [M.shares, M.saves],
      "engagement",
      "trust",
      "needs_scope",
      YTA,
      YA,
    ],
    [
      "youtube",
      null,
      "Comment reply rate and time to reply",
      ["reply_rate", "reply_secs"],
      "conversation",
      "trust",
      "live",
      OURS,
    ],
    [
      "youtube",
      null,
      "Comment to DM, DM to booking",
      ["to_dm", "dm_booked"],
      "conversation",
      "convert",
      "no_api",
      "YouTube has no DMs",
    ],
    [
      "youtube",
      "long",
      "Title and thumbnail tests",
      ["variants"],
      "iteration",
      "reach",
      "no_api",
      "Studio's Test and compare only: the reach report has no variant, and both run at once",
    ],
    ["youtube", null, "Subscribers", [M.followers], "account", "reach", "live", DATA],
    [
      "youtube",
      null,
      "Channel views and subscribers per day",
      [M.views, M.follows, M.unfollows, M.watchMinutes],
      "account",
      "reach",
      "needs_scope",
      YTA,
      YA,
    ],

    // ---- YouTube Shorts (past long-form's) ----
    [
      "youtube",
      "short",
      "Engaged views",
      [M.engagedViews],
      "reach",
      "reach",
      "needs_scope",
      YTA,
      YA,
    ],
    [
      "youtube",
      "short",
      "Viewed vs swiped away",
      [M.skipRate],
      "retention",
      "reach",
      "no_api",
      "Studio only",
    ],
    [
      "youtube",
      "short",
      "30-second hold",
      [M.hold30],
      "retention",
      "trust",
      "needs_scope",
      YTA,
      YA,
    ],
    [
      "youtube",
      "short",
      "Post to site",
      ["to_site"],
      "funnel",
      "convert",
      "no_api",
      "A Short's links can't be clicked",
    ],

    // ---- Instagram ----
    ["instagram", null, "Reach", [M.reach], "reach", "reach", "live", GRAPH],
    ["instagram", null, "Views", [M.views], "reach", "reach", "live", GRAPH],
    [
      "instagram",
      null,
      "Likes, comments, shares, saves",
      [M.likes, M.comments, M.shares, M.saves, M.interactions],
      "engagement",
      "trust",
      "live",
      GRAPH,
    ],
    [
      "instagram",
      null,
      "Follows and profile visits from the post",
      [M.follows, M.profileVisits],
      "reach",
      "reach",
      "live",
      GRAPH,
    ],
    [
      "instagram",
      null,
      "Average and total watch time",
      [M.avgViewSecs, M.watchMinutes],
      "retention",
      "trust",
      "live",
      GRAPH,
    ],
    ["instagram", null, "Skip rate", [M.skipRate], "retention", "trust", "no_api", "the app only"],
    [
      "instagram",
      null,
      "Retention curve and rewatches",
      [M.retention],
      "retention",
      "trust",
      "no_api",
      "the app only",
    ],
    [
      "instagram",
      null,
      "Traffic sources",
      [M.trafficSource],
      "reach",
      "reach",
      "no_api",
      "the app only",
    ],
    [
      "instagram",
      null,
      "Comment reply rate and time to reply",
      ["reply_rate", "reply_secs"],
      "conversation",
      "trust",
      "live",
      OURS,
    ],
    [
      "instagram",
      null,
      "Comment to DM, DMs answered, DM to booking",
      ["to_dm", "dms_answered", "dm_booked"],
      "conversation",
      "convert",
      "needs_scope",
      "instagram_manage_messages",
      NEEDS.instagramMessages,
    ],
    [
      "instagram",
      null,
      "Account reach, profile visits, link-in-bio clicks",
      [M.reach, M.profileVisits, M.linkClicks, M.accountsEngaged],
      "account",
      "reach",
      "live",
      "Graph API user insights, instagram_manage_insights",
    ],
    [
      "instagram",
      null,
      "Followers",
      [M.followers],
      "account",
      "reach",
      "live",
      "Graph API user followers_count",
    ],

    // ---- TikTok ----
    [
      "tiktok",
      null,
      "Views, likes, comments, shares",
      [M.views, M.likes, M.comments, M.shares],
      "engagement",
      "reach",
      "live",
      "Display API video/query, video.list",
    ],
    [
      "tiktok",
      null,
      "Reach, watch time, full watches, retention, sources",
      [M.reach, M.avgViewSecs, M.retention, M.trafficSource],
      "retention",
      "trust",
      "needs_william",
      "Business API",
      TT,
    ],
    [
      "tiktok",
      null,
      "Saves",
      [M.saves],
      "engagement",
      "trust",
      "needs_william",
      "Business API",
      TT,
    ],
    [
      "tiktok",
      null,
      "Comment reply rate",
      ["reply_rate"],
      "conversation",
      "trust",
      "not_built",
      "the box's TikTok comments read",
    ],
    [
      "tiktok",
      null,
      "Followers",
      [M.followers],
      "account",
      "reach",
      "not_built",
      "Display API user/info, user.info.stats",
    ],
    [
      "tiktok",
      null,
      "Profile visits and link-in-bio clicks",
      [M.profileVisits, M.linkClicks],
      "account",
      "reach",
      "needs_william",
      "Business API",
      TT,
    ],

    // ---- LinkedIn ----
    [
      "linkedin",
      null,
      "Reactions and comments",
      [M.likes, M.comments],
      "engagement",
      "trust",
      "live",
      "socialActions, w_member_social",
    ],
    [
      "linkedin",
      null,
      "Impressions, reach, reshares, profile views",
      [M.impressions, M.reach, M.shares, M.profileVisits],
      "reach",
      "reach",
      "needs_william",
      "memberCreatorPostAnalytics, r_member_postAnalytics",
      NEEDS.linkedinAnalytics,
    ],
    [
      "linkedin",
      null,
      "Impressions from the post's analytics page",
      ["browser_impressions"],
      "reach",
      "reach",
      "not_built",
      "a browser route on the box",
    ],
    [
      "linkedin",
      null,
      "Comment reply rate and time to reply",
      ["reply_rate", "reply_secs"],
      "conversation",
      "trust",
      "live",
      OURS,
    ],
    [
      "linkedin",
      null,
      "Comment to DM, DMs answered, DM to booking",
      ["to_dm", "dms_answered", "dm_booked"],
      "conversation",
      "convert",
      "live",
      OURS,
    ],
    [
      "linkedin",
      null,
      "Followers",
      [M.followers],
      "account",
      "reach",
      "live",
      "the box's /audience",
    ],
    [
      "linkedin",
      null,
      "Profile visits and search appearances",
      [M.profileVisits],
      "account",
      "reach",
      "not_built",
      "a browser route on the box",
    ],

    // ---- X ----
    [
      "x",
      null,
      "Impressions, likes, replies, reposts",
      [M.views, M.likes, M.comments, M.shares],
      "reach",
      "reach",
      "live",
      "public_metrics, tweet.read",
    ],
    ["x", null, "Bookmarks", [M.saves], "engagement", "trust", "live", "public_metrics"],
    [
      "x",
      null,
      "Link and profile clicks",
      [M.linkClicks, M.profileClicks],
      "funnel",
      "convert",
      "live",
      "non_public_metrics, the API leg",
    ],
    [
      "x",
      null,
      "Video views and watch",
      ["video_views"],
      "retention",
      "trust",
      "not_built",
      "organic_metrics",
    ],
    [
      "x",
      null,
      "Comment reply rate and time to reply",
      ["reply_rate", "reply_secs"],
      "conversation",
      "trust",
      "live",
      OURS,
    ],
    [
      "x",
      null,
      "Comment to DM, DM to booking",
      ["to_dm", "dm_booked"],
      "conversation",
      "convert",
      "not_built",
      "dm.read, dm.write",
    ],
    [
      "x",
      null,
      "Followers",
      [M.followers],
      "account",
      "reach",
      "not_built",
      "users/me public_metrics",
    ],

    // ---- Reddit ----
    [
      "reddit",
      null,
      "Score, comments, crossposts",
      [M.likes, M.comments, M.shares],
      "engagement",
      "reach",
      "live",
      "/api/info",
    ],
    ["reddit", null, "Upvote ratio", [M.upvoteRatio], "engagement", "trust", "live", "/api/info"],
    ["reddit", null, "Views", [M.views], "reach", "reach", "no_api", "shown to the author only"],
    [
      "reddit",
      null,
      "Comments we posted in threads",
      ["thread_answers"],
      "conversation",
      "trust",
      "live",
      OURS,
    ],
    [
      "reddit",
      null,
      "Comment reply rate, DM to booking",
      ["reply_rate", "dm_booked"],
      "conversation",
      "convert",
      "live",
      OURS,
    ],
    ["reddit", null, "Followers", [M.followers], "account", "reach", "live", "profile about"],
  ] satisfies Row[]
).map(entry);

/** The doc's platform headings: YouTube splits by surface, the rest are one table each. */
export const CATALOG_TABLES = [
  { id: "youtube-long", label: "YouTube long-form", platform: "youtube", surface: "long" },
  {
    id: "youtube-short",
    label: "YouTube Shorts (past long-form)",
    platform: "youtube",
    surface: "short",
  },
  { id: "instagram", label: "Instagram", platform: "instagram" },
  { id: "tiktok", label: "TikTok", platform: "tiktok" },
  { id: "linkedin", label: "LinkedIn", platform: "linkedin" },
  { id: "x", label: "X", platform: "x" },
  { id: "reddit", label: "Reddit", platform: "reddit" },
  { id: "all", label: "Every platform", platform: "all" },
] as const;

/** A table's rows: YouTube long-form takes every row not Shorts' own; Shorts only its own. */
export function tableRows(t: (typeof CATALOG_TABLES)[number]): CatalogEntry[] {
  return ANALYTICS_CATALOG.filter((e) => {
    if (e.platform !== t.platform) return false;
    if (!("surface" in t)) return true;
    return t.surface === "long" ? e.surface !== "short" : e.surface === t.surface;
  });
}

/** Live, Needs scope, Needs William, Not built and No API per table: the doc's Counts. */
export function catalogCounts(): Array<{ label: string } & Record<CatalogState, number>> {
  return CATALOG_TABLES.map((t) => {
    const n = { live: 0, needs_scope: 0, needs_william: 0, not_built: 0, no_api: 0 };
    for (const e of tableRows(t)) n[e.state] += 1;
    return { label: t.label, ...n };
  });
}

/**
 * The rows that bear on one post: its platform's and every platform's. A Short reads as
 * long-form plus its own rows; a long video leaves the Shorts rows out.
 */
export function entriesFor(platform: Platform, surface: Surface): CatalogEntry[] {
  return ANALYTICS_CATALOG.filter(
    (e) =>
      e.group !== "account" &&
      (e.platform === "all" ||
        (e.platform === platform && (surface === "short" || e.surface !== "short"))),
  );
}

/** A draft's surface from its platform and shape kind. */
export const surfaceOf = (platform: string, kind: string | null | undefined): Surface =>
  platform === "youtube" ? (kind === "short" ? "short" : "long") : "post";

/** What a state says on a page, where the number would sit. */
export function stateLine(state: string, needs?: Need, why?: string | null): string {
  switch (state) {
    case "live":
      return "Live";
    case "needs_scope":
      return `Needs scope: ${needs?.name ?? "a consent"}`;
    case "needs_william":
      return `Needs William: ${needs?.name ?? "an application"}`;
    case "not_built":
      return "In development";
    case "no_api":
      return "Not in the API";
    case "waiting":
      return `Waiting${why ? `: ${why}` : ` on ${needs?.name ?? "the platform"}`}`;
    default:
      return `Refused${why ? `: ${why}` : ""}`;
  }
}

export const FORMATS = ["long", "short", "reel", "video", "carousel", "thread", "post"] as const;
export type Format = (typeof FORMATS)[number];

/** A draft's format from its platform and shape kind; `formatSql` in the schema is the same. */
export function formatOf(platform: string, kind: string | null | undefined): Format {
  if (platform === "youtube") return kind === "short" ? "short" : "long";
  if (platform === "tiktok") return "video";
  if (platform === "instagram" && kind === "video") return "reel";
  if (
    (platform === "instagram" && kind === "carousel") ||
    (platform === "linkedin" && kind === "document")
  )
    return "carousel";
  if (platform === "x" && kind === "thread") return "thread";
  return "post";
}

/** Goals per week (designs/2026-10-07-content-funnel.md): what cadence is measured against. */
export const CADENCE_GOALS: ReadonlyArray<{
  id: string;
  platform: Platform;
  label: string;
  /** Per week. */
  goal: number;
  /** What counts: a published post of this format, any post, or a thread comment we posted. */
  counts: Format | "any" | "thread_comment";
}> = [
  {
    id: "youtube-long",
    platform: "youtube",
    label: "YouTube long videos",
    goal: 2,
    counts: "long",
  },
  { id: "youtube-short", platform: "youtube", label: "YouTube Shorts", goal: 5, counts: "short" },
  { id: "instagram", platform: "instagram", label: "Instagram Reels", goal: 7, counts: "reel" },
  { id: "linkedin", platform: "linkedin", label: "LinkedIn posts", goal: 7, counts: "any" },
  { id: "reddit", platform: "reddit", label: "Reddit posts", goal: 1, counts: "any" },
  {
    id: "reddit-comments",
    platform: "reddit",
    label: "Reddit comments",
    goal: 35,
    counts: "thread_comment",
  },
];
