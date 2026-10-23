/**
 * Every number a post or an account can earn, per platform (designs/2026-10-07-content-analytics.md):
 * what it is, the API and scope behind it, whether we read it, and the one step that would let us.
 * The design doc's tables are this list; a test keeps its counts in step. A metric's state on a
 * page is the platform's last answer (`metric_sources`) when there is one, this list's when not.
 */
import { type GapState, METRICS as M, type Platform } from "@wren/core/content";
import type { FunnelStage } from "../schema.js";

/**
 * A catalog row's word; `error` only ever comes from a platform's answer. `waiting` on a row:
 * built, and live once its first number lands.
 */
export type CatalogState = "live" | Exclude<GapState, "error">;
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
  | "audience"
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
const BROWSER_DAYS = "in the box's browser, days 1, 3, 7, 14 and 28";
const TT_STUDIO = `TikTok Studio's analytics page ${BROWSER_DAYS}`;

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
      "Hook: still watching at 3 s",
      [M.hold3],
      "retention",
      "reach",
      "needs_scope",
      YTA,
      YA,
    ],
    [
      "youtube",
      "long",
      "Audience: age, gender, country, subscribers vs others",
      [M.viewerAge, M.viewerGender, M.viewerCountry, M.viewerFollower],
      "audience",
      "reach",
      "needs_scope",
      YTA,
      YA,
    ],
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
      "Title, thumbnail and hook variants",
      ["variants"],
      "iteration",
      "reach",
      "waiting",
      "our swaps over time, each window's views and the reach report's CTR (Studio's Test and compare has no API)",
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
      "waiting",
      `YouTube Studio's analytics page ${BROWSER_DAYS}`,
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
    [
      "instagram",
      null,
      "Skip rate (Reels)",
      [M.skipRate],
      "retention",
      "trust",
      "live",
      "Graph API media insights reels_skip_rate, instagram_manage_insights",
    ],
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
    [
      "instagram",
      null,
      "Followers: age, gender, country",
      [M.viewerAge, M.viewerGender, M.viewerCountry],
      "account",
      "reach",
      "waiting",
      "Graph API user insights follower_demographics; Meta shows it at 100 followers",
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
      "Reach, watch time, average view, full watches, follows",
      [M.reach, M.watchMinutes, M.avgViewSecs, M.avgViewPct, M.finishRate, M.follows],
      "retention",
      "trust",
      "waiting",
      TT_STUDIO,
    ],
    [
      "tiktok",
      null,
      "Retention curve, 3- and 30-second hold",
      [M.retention, M.hold3, M.hold30],
      "retention",
      "reach",
      "waiting",
      TT_STUDIO,
    ],
    [
      "tiktok",
      null,
      "Traffic sources and search terms",
      [M.trafficSource, M.searchTerm],
      "reach",
      "reach",
      "waiting",
      TT_STUDIO,
    ],
    [
      "tiktok",
      null,
      "Audience: age, gender, country, followers vs others, new vs returning",
      [M.viewerAge, M.viewerGender, M.viewerCountry, M.viewerFollower, M.viewerReturn],
      "audience",
      "reach",
      "waiting",
      TT_STUDIO,
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
      "waiting",
      "the box's /web/videos/{id}/comments (browser), our answers",
    ],
    [
      "tiktok",
      null,
      "Followers",
      [M.followers],
      "account",
      "reach",
      "waiting",
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
      `the post page as Wren (a ugcPost), else the post's analytics page (a share), ${BROWSER_DAYS}; socialActions needs r_organization_social`,
    ],
    [
      "linkedin",
      null,
      "Impressions, reach, reposts, saves, sends, profile views, follows",
      [M.impressions, M.reach, M.shares, M.saves, M.sends, M.profileVisits, M.follows],
      "reach",
      "reach",
      "waiting",
      `the post's analytics page, as Wren, ${BROWSER_DAYS}`,
    ],
    [
      "linkedin",
      null,
      "Video views, watch time, average watch time",
      [M.videoViews, M.watchMinutes, M.avgViewSecs],
      "retention",
      "trust",
      "waiting",
      `the post's analytics page, as Wren, ${BROWSER_DAYS}, video posts only`,
    ],
    [
      "linkedin",
      null,
      "Viewer demographics",
      [M.viewerCountry, M.viewerAge],
      "audience",
      "reach",
      "not_built",
      "the analytics page said not available yet on 2026-10-23; its format is unmapped",
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
      [M.profileVisits, M.searchAppearances],
      "account",
      "reach",
      "waiting",
      "the box's /analytics/dashboard as linkedin@wren (browser, 10 a day with post analytics)",
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
      "Video views and playback quartiles",
      [M.videoViews, M.playback],
      "retention",
      "trust",
      "waiting",
      "media organic_metrics, the API leg, video posts only",
    ],
    [
      "x",
      null,
      "Retention curve and finish rate",
      [M.retention, M.finishRate],
      "retention",
      "trust",
      "waiting",
      "from the playback quartiles, video posts only",
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
      "waiting",
      OURS,
    ],
    [
      "x",
      null,
      "Followers",
      [M.followers],
      "account",
      "reach",
      "waiting",
      "users/me public_metrics, daily",
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

    // ---- Facebook ----
    [
      "facebook",
      null,
      "Views, reactions, comments, shares",
      [M.views, M.likes, M.comments, M.shares],
      "reach",
      "reach",
      "live",
      "Graph API post fields, pages_read_engagement",
    ],
    [
      "facebook",
      null,
      "Reach",
      [M.reach],
      "reach",
      "reach",
      "waiting",
      "post insights post_total_media_view_unique, read_insights",
    ],
    [
      "facebook",
      null,
      "Reels watch time, average watch time, follows",
      [M.watchMinutes, M.avgViewSecs, M.follows],
      "retention",
      "trust",
      "waiting",
      "Reel video_insights, read_insights",
    ],
    [
      "facebook",
      null,
      "Reels retention curve, 3 s and 30 s hold, average view percent",
      [M.retention, M.hold3, M.hold30, M.avgViewPct, M.durationSecs],
      "retention",
      "trust",
      "waiting",
      "Reel post_video_retention_graph; its keys are unproven live",
    ],
    [
      "facebook",
      null,
      "Page views, reach, follows by day",
      [M.views, M.reach, M.follows],
      "account",
      "reach",
      "waiting",
      "Page insights, period day, yesterday",
    ],

    // ---- Threads ----
    [
      "threads",
      null,
      "Views, likes, replies, reposts and quotes",
      [M.views, M.likes, M.comments, M.shares],
      "reach",
      "reach",
      "live",
      "post insights, threads_manage_insights",
    ],
    [
      "threads",
      null,
      "Link clicks",
      [M.linkClicks],
      "funnel",
      "convert",
      "waiting",
      "post insights clicks",
    ],
    [
      "threads",
      null,
      "Video watch time and retention",
      [M.watchMinutes, M.retention],
      "retention",
      "trust",
      "no_api",
      "Threads gives no watch numbers for a post",
    ],
    [
      "threads",
      null,
      "Follower country, age and gender",
      [M.viewerCountry, M.viewerAge, M.viewerGender],
      "audience",
      "reach",
      "waiting",
      "follower_demographics, from 100 followers",
    ],
    [
      "threads",
      null,
      "Profile views, likes, replies, link clicks, followers by day",
      [M.views, M.likes, M.comments, M.linkClicks, M.followers],
      "account",
      "reach",
      "waiting",
      "/me/threads_insights, yesterday",
    ],
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
  { id: "facebook", label: "Facebook", platform: "facebook" },
  { id: "threads", label: "Threads", platform: "threads" },
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

/** Live, Waiting, Needs scope, Needs William, Not built and No API per table: the doc's Counts. */
export function catalogCounts(): Array<{ label: string } & Record<CatalogState, number>> {
  return CATALOG_TABLES.map((t) => {
    const n = { live: 0, waiting: 0, needs_scope: 0, needs_william: 0, not_built: 0, no_api: 0 };
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
  platform === "youtube" && kind !== "community" ? (kind === "short" ? "short" : "long") : "post";

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

export const FORMATS = [
  "long",
  "short",
  "reel",
  "video",
  "carousel",
  "thread",
  "story",
  "post",
] as const;
export type Format = (typeof FORMATS)[number];

/**
 * A draft's format from its platform, shape kind and file; `formatSql` in the schema is the same.
 * A video on X or LinkedIn is a video post, on Facebook a Reel.
 */
export function formatOf(
  platform: string,
  kind: string | null | undefined,
  media?: string | null,
): Format {
  if (platform === "youtube" && kind !== "community") return kind === "short" ? "short" : "long";
  if (platform === "tiktok") return "video";
  if ((platform === "instagram" || platform === "facebook") && kind === "story") return "story";
  if (platform === "instagram" && kind === "video") return "reel";
  if (
    (platform === "instagram" && kind === "carousel") ||
    (platform === "linkedin" && kind === "document")
  )
    return "carousel";
  if (platform === "x" && kind === "thread") return "thread";
  if (platform === "facebook" && media === "video") return "reel";
  if ((platform === "x" || platform === "linkedin") && media === "video") return "video";
  return "post";
}

/** Where a goal posts: a platform, or one Wren doesn't post to yet. */
export type GoalPlace = Platform | "newsletter";

export interface CadenceGoal {
  id: string;
  platform: GoalPlace;
  /** The format, under its platform: "Shorts". */
  label: string;
  /** With its platform, for a line that stands alone: "YouTube Shorts". */
  name: string;
  /** Per week, the low end of a range. */
  goal: number;
  /** A range's top: 3 for "2 to 3". */
  upTo?: number;
  /** Per posting day, for today's count; null when it's a few days a week. */
  daily: number | null;
  /** How often, as he says it. */
  pace: string;
  /** How it's made. */
  how: string;
  /**
   * The piece he makes that feeds it: one vertical clip goes out as Shorts, Reels and TikTok, one
   * written post adapts per platform. Goals sharing a piece share the work.
   */
  piece: string;
  /** Where the next one starts: his words (Write), a video (Videos), a thread (Engage). */
  starts: "words" | "video" | "thread";
  /**
   * What counts: a published post in one of these formats, any post, or a thread comment we
   * posted. Null: Wren can't post it yet, so nothing is counted.
   */
  counts: readonly Format[] | "any" | "thread_comment" | null;
}

/**
 * William's posting plan, per week (10-13): what cadence is measured against, in his order by
 * platform. Formats Wren can't post yet stay on it, uncounted, so the gap shows.
 */
/** What each piece is called on Plan; a piece not named here shows as its key. */
export const PIECE_NAMES: Readonly<Record<string, string>> = {
  long: "Long video",
  vertical: "Vertical clip",
  written: "Written post",
  story: "Story",
  replies: "Thread replies",
  newsletter: "Blog post",
};

export const CADENCE_GOALS: readonly CadenceGoal[] = [
  {
    id: "youtube-long",
    piece: "long",
    platform: "youtube",
    label: "Long videos",
    name: "YouTube long videos",
    goal: 2,
    upTo: 3,
    daily: null,
    pace: "2 to 3 days a week",
    how: "The main authority piece",
    starts: "video",
    counts: ["long"],
  },
  {
    id: "youtube-short",
    piece: "vertical",
    platform: "youtube",
    label: "Shorts",
    name: "YouTube Shorts",
    goal: 21,
    daily: 3,
    pace: "3 a day",
    how: "Spaced 5 to 6 hours apart",
    starts: "video",
    counts: ["short"],
  },
  {
    id: "youtube-community",
    piece: "written",
    platform: "youtube",
    label: "Community posts",
    name: "YouTube Community posts",
    goal: 7,
    daily: 1,
    pace: "1 a day",
    how: "Quotes, diagrams or poll teasers",
    starts: "words",
    counts: ["post"],
  },
  {
    id: "instagram-reel",
    piece: "vertical",
    platform: "instagram",
    label: "Reels",
    name: "Instagram Reels",
    goal: 21,
    daily: 3,
    pace: "3 a day",
    how: "Native 9:16 vertical video",
    starts: "video",
    counts: ["reel"],
  },
  {
    id: "instagram-story",
    piece: "story",
    platform: "instagram",
    label: "Stories",
    name: "Instagram Stories",
    goal: 21,
    daily: 3,
    pace: "3 a day",
    how: "2 clip shares and 1 behind the scenes or poll",
    starts: "video",
    counts: ["story"],
  },
  {
    id: "tiktok",
    piece: "vertical",
    platform: "tiktok",
    label: "Videos",
    name: "TikTok videos",
    goal: 21,
    daily: 3,
    pace: "3 a day",
    how: "Native upload, trend audio optional",
    starts: "video",
    counts: ["video"],
  },
  {
    id: "facebook-reel",
    piece: "vertical",
    platform: "facebook",
    label: "Reels",
    name: "Facebook Reels",
    goal: 21,
    daily: 3,
    pace: "3 a day",
    how: "The Instagram Reels, posted again",
    starts: "video",
    counts: ["reel"],
  },
  {
    id: "facebook-post",
    piece: "written",
    platform: "facebook",
    label: "Page posts",
    name: "Facebook Page posts",
    goal: 14,
    daily: 2,
    pace: "2 a day",
    how: "Cross-posted from LinkedIn and X",
    starts: "words",
    counts: ["post"],
  },
  {
    id: "facebook-story",
    piece: "story",
    platform: "facebook",
    label: "Stories",
    name: "Facebook Stories",
    goal: 21,
    daily: 3,
    pace: "3 a day",
    how: "Mirrored from Instagram Stories",
    starts: "video",
    counts: ["story"],
  },
  {
    id: "linkedin-video",
    piece: "vertical",
    platform: "linkedin",
    label: "Vertical videos",
    name: "LinkedIn vertical videos",
    goal: 7,
    upTo: 14,
    daily: 1,
    pace: "1 to 2 a day",
    how: "The day's best 1 or 2 clips",
    starts: "video",
    counts: ["video"],
  },
  {
    id: "linkedin",
    piece: "written",
    platform: "linkedin",
    label: "Text posts and carousels",
    name: "LinkedIn text posts and carousels",
    goal: 7,
    daily: 1,
    pace: "1 a day",
    how: "Text posts and PDF carousels",
    starts: "words",
    counts: ["post", "carousel"],
  },
  {
    id: "x-video",
    piece: "vertical",
    platform: "x",
    label: "Video posts",
    name: "X video posts",
    goal: 21,
    daily: 3,
    pace: "3 a day",
    how: "The vertical clips, uploaded natively",
    starts: "video",
    counts: ["video"],
  },
  {
    id: "x",
    piece: "written",
    platform: "x",
    label: "Text posts and threads",
    name: "X text posts and threads",
    goal: 28,
    daily: 4,
    pace: "4 a day",
    how: "3 standalone takes and 1 thread",
    starts: "words",
    counts: ["post", "thread"],
  },
  {
    id: "threads",
    piece: "written",
    platform: "threads",
    label: "Text and clips",
    name: "Threads posts",
    goal: 28,
    daily: 4,
    pace: "4 a day",
    how: "Posted again from X and Instagram",
    starts: "words",
    counts: "any",
  },
  {
    id: "reddit",
    piece: "written",
    platform: "reddit",
    label: "Breakdowns and case studies",
    name: "Reddit posts",
    goal: 2,
    daily: null,
    pace: "2 days a week",
    how: "Value first, in the subreddits that fit",
    starts: "words",
    counts: "any",
  },
  {
    id: "reddit-comments",
    piece: "replies",
    platform: "reddit",
    label: "Thread comments",
    name: "Reddit comments",
    goal: 35,
    daily: 5,
    pace: "5 a day",
    how: "Answers in threads that fit",
    starts: "thread",
    counts: "thread_comment",
  },
  {
    id: "newsletter",
    piece: "newsletter",
    platform: "newsletter",
    label: "TLDRs and deep posts",
    name: "Blog posts",
    goal: 3,
    daily: null,
    pace: "3 days a week",
    how: "Built from the long videos and the LinkedIn and X posts, then emailed",
    starts: "words",
    counts: "any",
  },
];

/** Whether a published post of this format counts toward the goal. */
export const countsFor = (g: CadenceGoal, platform: string, format: Format): boolean =>
  g.platform === platform &&
  (g.counts === "any" || (Array.isArray(g.counts) && g.counts.includes(format)));
