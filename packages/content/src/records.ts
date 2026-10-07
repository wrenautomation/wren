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
  link,
  number,
  rate,
  type State,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { DRAFT_CALLS } from "./draft-calls.js";
import { PLATFORM_SPECS } from "./platforms.js";
import { contentDrafts, type DraftStatus } from "./schema.js";

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

const DRAFT_STATES: Record<DraftStatus, State> = {
  draft: { label: "Waiting on you", tone: "warn" },
  failed: { label: "Failed to post", tone: "bad" },
  approved: { label: "Scheduled", tone: "good" },
  publishing: { label: "Posting", tone: "neutral" },
  published: { label: "Posted", tone: "good" },
  rejected: { label: "Rejected", tone: "neutral" },
};

export { DRAFT_CALLS };

export const draftRecord = defineRecord({
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
  activity: { view: "draft_activity", by: "draft" },
  drafts: (id) => [`draft:${id}`],
  actions: [
    "marketing.approveDraft",
    "marketing.redraft",
    "marketing.rejectDraft",
    "marketing.draftSet",
    "marketing.draftAsk",
    "marketing.draftUndo",
  ],
  calls: DRAFT_CALLS,
  /** The preview, and Ask Claude's thread on it. */
  load: async (db, id) => ({
    post: await postOf(db, id),
    ask: await draftTurns(db, "draft", id),
    record: await recordOfPage(db, "draft", id),
  }),
});

export const postRecord = defineRecord({
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
    views: number(),
    reactions: number(),
    comments: number(),
    shares: number(),
    engagement: rate("views", "Engagement", { from: "engaged" }),
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
    { id: "platform", label: "By platform", sort: "platform", at: "published" },
  ],
  activity: { view: "draft_activity", by: "post" },
  drafts: (id) => [`draft:${id.split("/").at(-1)}`],
  actions: ["marketing.draftAgain"],
  load: async (db, id) => ({ post: await postOf(db, id.split("/")[2] ?? "") }),
});

export const CONTENT_RECORDS = [draftRecord, postRecord];
export { mediaRecord, sopRecord } from "./library.js";
export * from "./social/records.js";
export { type VideoSigner, videoRecord } from "./video.js";
