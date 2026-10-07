/**
 * Posts as console records for the Marketing app: drafts waiting on a person
 * (`marketing_draft_records`) and published ones (`marketing_post_records`).
 */
import { draftTurns } from "@wren/core/ask";
import type { Platform } from "@wren/core/content";
import { recordOfPage } from "@wren/core/draft-record";
import {
  cued,
  date,
  defineRecord,
  duration,
  link,
  money,
  number,
  percent,
  rate,
  type State,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { postAnalytics } from "./analytics/records.js";
import { DRAFT_CALLS } from "./draft-calls.js";
import { PLATFORM_SPECS } from "./platforms.js";
import { contentDrafts, type DraftStatus } from "./schema.js";
import { shapeView } from "./shape-view.js";
import { FORMATS } from "./social/records.js";
import type { VideoSigner } from "./video.js";

const NAMES: Record<Platform, string> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  youtube: "YouTube",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};
const PLATFORM_STATES: Record<string, State> = cued(
  Object.fromEntries(Object.entries(NAMES).map(([p, label]) => [p, { label, tone: "neutral" }])),
);

/** What a preview needs past the row: the whole text, the platform's name, cap and feed cut. */
async function postOf(db: Queryable, draftId: string) {
  const [d] = await db
    .select({
      platform: contentDrafts.platform,
      text: contentDrafts.text,
      title: contentDrafts.title,
    })
    .from(contentDrafts)
    .where(eq(contentDrafts.id, draftId))
    .limit(1);
  if (!d) return null;
  const spec = PLATFORM_SPECS[d.platform];
  return {
    site: NAMES[d.platform],
    title: d.title,
    text: d.text,
    max: spec.maxChars,
    feed: spec.feed,
  };
}

const STAGE_STATES = {
  reach: { label: "Reach", tone: "neutral" },
  trust: { label: "Trust", tone: "neutral" },
  convert: { label: "Convert", tone: "neutral" },
} as const satisfies Record<string, State>;
/** A published post's format (`formatSql`): a long video and a Short read apart. */
const POST_FORMATS: Record<string, State> = {
  long: { label: "Long video", tone: "neutral" },
  short: { label: "Short", tone: "neutral" },
  reel: { label: "Reel", tone: "neutral" },
  video: { label: "Video", tone: "neutral" },
  carousel: { label: "Carousel", tone: "neutral" },
  thread: { label: "Thread", tone: "neutral" },
  post: { label: "Post", tone: "neutral" },
};

const DRAFT_STATES: Record<DraftStatus, State> = {
  draft: { label: "Waiting on you", tone: "warn" },
  failed: { label: "Failed to post", tone: "bad" },
  approved: { label: "Scheduled", tone: "good" },
  publishing: { label: "Posting", tone: "neutral" },
  published: { label: "Posted", tone: "good" },
  rejected: { label: "Rejected", tone: "neutral" },
};

export { DRAFT_CALLS };

/** Drafts; `signer` links the stored files (thumbnail, cover) the field editor shows. */
export const draftRecordOf = (signer?: VideoSigner) =>
  defineRecord({
    id: "marketing.draft",
    app: "marketing",
    channel: { field: "platform" },
    name: { one: "draft", many: "drafts" },
    view: "marketing_draft_records",
    key: "id",
    title: "title",
    subtitle: "platform",
    fields: {
      title: text("Post"),
      platform: status(PLATFORM_STATES),
      state: status(DRAFT_STATES),
      text: text("Text"),
      chars: number("Characters"),
      written: status(
        {
          model: { label: "Wren", tone: "neutral" },
          edited: { label: "You edited it", tone: "neutral" },
        },
        "Written by",
      ),
      stage: status(STAGE_STATES, "Stage"),
      to: status(
        {
          video: { label: "The video", tone: "neutral" },
          site: { label: "The site", tone: "neutral" },
          booking: { label: "Booking", tone: "neutral" },
        },
        "Points to",
      ),
      format: status(FORMATS, "Format"),
      note: text("Your redraft note"),
      error: text("Last error"),
      scheduled: date("Posts at"),
      created: date("Drafted"),
    },
    views: [
      {
        id: "waiting",
        label: "Waiting on you",
        where: { state: ["draft", "failed"] },
        sort: "-created",
        at: "created",
      },
      {
        id: "scheduled",
        label: "Scheduled",
        where: { state: ["approved", "publishing"] },
        sort: "scheduled",
        at: "scheduled",
      },
      {
        id: "rejected",
        label: "Rejected",
        where: { state: "rejected" },
        sort: "-created",
        at: "created",
      },
    ],
    activity: { view: "draft_activity", by: "draft", seq: "seq" },
    drafts: (id) => [`draft:${id}`],
    actions: [
      "marketing.approveDraft",
      "marketing.redraft",
      "marketing.rejectDraft",
      "marketing.draftSet",
      "marketing.draftAsk",
      "marketing.draftUndo",
      "marketing.draftFields",
      "marketing.draftFunnel",
      "marketing.draftAttach",
      "marketing.draftSlides",
    ],
    calls: DRAFT_CALLS,
    /** The preview, its fields, and Ask Claude's thread on it. */
    load: async (db, id) => ({
      post: await postOf(db, id),
      shape: await shapeView(db, id, signer),
      ask: await draftTurns(db, "draft", id),
      record: await recordOfPage(db, "draft", id),
    }),
  });

/** Published posts; the fields show what went out. */
export const postRecordOf = (signer?: VideoSigner) =>
  defineRecord({
    id: "marketing.post",
    app: "marketing",
    channel: { field: "platform" },
    name: { one: "post", many: "posts" },
    view: "marketing_post_records",
    key: "id",
    title: "title",
    subtitle: "platform",
    fields: {
      title: text("Post"),
      platform: status(PLATFORM_STATES),
      published: date(),
      format: status(POST_FORMATS, "Format"),
      stage: status(STAGE_STATES, "Stage", { listed: false }),
      views: number(),
      reactions: number(),
      comments: number(),
      shares: number(),
      engagement: rate("views", "Engagement", { from: "engaged" }),
      score: number("Per 100 views", { listed: false }),
      // The platform's deeper numbers, latest day (designs/2026-10-07-content-analytics.md).
      impressions: number("Impressions", { listed: false, group: "How it did" }),
      reach: number("Reach", { listed: false, group: "How it did" }),
      ctr: percent("Impression CTR", { listed: false, group: "How it did" }),
      avgViewPct: percent("Average % viewed", { listed: false, group: "How it did" }),
      avgViewSecs: duration("Average view", { listed: false, group: "How it did" }),
      hold: percent("Still watching at 30s", { listed: false, group: "How it did" }),
      watchMinutes: number("Watch minutes", { listed: false, group: "How it did" }),
      saves: number("Saves", { listed: false, group: "How it did" }),
      follows: number("Follows from it", { listed: false, group: "How it did" }),
      linkClicks: number("Link clicks (platform)", { listed: false, group: "How it did" }),
      // Its own link's visitors and what they did, by first touch; revenue by both.
      clicks: number("Site clicks", { group: "What it brought" }),
      toSite: rate("views", "Post to site", { from: "clicks", group: "What it brought" }),
      forms: number("Forms", { listed: false, group: "What it brought" }),
      calls: number("Calls booked", { listed: false, group: "What it brought" }),
      won: number("Clients won", { listed: false, group: "What it brought" }),
      revenueFirst: money("Revenue, first touch", { listed: false, group: "What it brought" }),
      revenueLast: money("Revenue, last touch", { listed: false, group: "What it brought" }),
      theirs: number("Their comments", { listed: false, group: "Its conversation" }),
      replied: rate("theirs", "Comments answered", { from: "answered", group: "Its conversation" }),
      // When the numbers were counted, and the week filter's key: in the detail, not the list.
      measured: date("Counted", { listed: false }),
      url: link("Link"),
      recent: status(
        {
          recent: { label: "Last 7 days", tone: "good" },
          earlier: { label: "Earlier", tone: "neutral" },
        },
        "When",
        { listed: false },
      ),
    },
    views: [
      { id: "all", label: "All", sort: "-published", at: "published" },
      {
        id: "week",
        label: "This week",
        where: { recent: "recent" },
        sort: "-published",
        at: "published",
      },
      { id: "top", label: "Top", sort: "-views", at: "published" },
      // The leaderboard: engagement per 100 views; filter it by format, stage and date.
      {
        id: "leaderboard",
        label: "Leaderboard",
        where: { views: { gte: 1 } },
        sort: "-score",
        at: "published",
      },
      {
        id: "site",
        label: "Brought visits",
        where: { clicks: { gte: 1 } },
        sort: "-clicks",
        at: "published",
      },
      { id: "platform", label: "By platform", sort: "platform", at: "published" },
    ],
    activity: { view: "draft_activity", by: "post", seq: "seq" },
    drafts: (id) => [`draft:${id.split("/").at(-1)}`],
    actions: ["marketing.draftAgain", "marketing.postPromote"],
    load: async (db, id) => ({
      post: await postOf(db, id.split("/")[2] ?? ""),
      shape: await shapeView(db, id.split("/")[2] ?? "", signer),
      analytics: await postAnalytics(db, id.split("/")[2] ?? ""),
    }),
  });

export const draftRecord = draftRecordOf();
export const postRecord = postRecordOf();
/** The posts' records; the worker's sign the stored files. */
export const contentRecords = (signer?: VideoSigner) => [
  draftRecordOf(signer),
  postRecordOf(signer),
];
export const CONTENT_RECORDS = contentRecords();
/** Wren's own analytics records: conversation, digest, cadence and every metric's state. */
export { ANALYTICS_RECORDS } from "./analytics/records.js";
export { mediaRecord, sopRecord } from "./library.js";
export { type ShapeView, shapeView } from "./shape-view.js";
export * from "./social/records.js";
export { type VideoSigner, videoRecord } from "./video.js";
