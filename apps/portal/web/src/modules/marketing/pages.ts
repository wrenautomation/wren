/** The pages: Inbox, To approve, and `MARKETING_PAGES`, the one list the products take from. */

import type { ListPage, ModulePage } from "../../module.js";
import { queueLate } from "../inbox-queues.js";
import { withAnalytics } from "./analytics.js";
import { APPROVAL_ACTIONS, APPROVAL_DRAFT, COMMENT_DRAFT, POST_DRAFT } from "./approval.js";
import { withDraft } from "./ask.js";
import { COMMENT_ACTIONS, COMMENT_ASK, THREAD_VIEW_ACTIONS } from "./comments.js";
import { askedReplyExtras, conversationExtras, conversationReply } from "./conversation.js";
import { dmExtras } from "./dms.js";
import { DRAFT_ACTIONS, POST_ACTIONS } from "./drafts.js";
import { FactsPage } from "./facts.js";
import { withShape } from "./fields.js";
import { INBOX_ACTIONS } from "./inbox.js";
import { AUDIENCE_ACTIONS } from "./places.js";
import { PlanPage } from "./plan.js";
import { postExtras } from "./posts.js";
import { withSiblings } from "./siblings.js";
import { StudioPage, WritePage } from "./studio.js";
import { withThread } from "./thread-context.js";
import { VIDEO_ACTIONS } from "./video.js";
import { studioVideos } from "./video-shelf.js";
import { videoExtras } from "./videos.js";

/**
 * What other people sent us (`marketing.inbox`): Marketing → Inbox and the Inbox app's "Waiting
 * on you" are this page, each under its own id.
 */
export const INBOX_PAGE: Omit<ListPage, "id"> = {
  label: "Inbox",
  about: "Messages, comments and replies waiting on you, from every channel.",
  template: "list",
  record: "marketing.inbox",
  late: queueLate("marketing.inbox"),
  // F1 of the design language: who (their words under), type, site, owner, waiting. State, post, suggests and the rest wait in Display. The person's stage is not on the row.
  columns: ["who", "type", "platform", "assignee", "due"],
  empty: {
    waiting: "Nothing waits on you.",
    mine: "Nothing is assigned to you. Take a thread with T.",
    unassigned: "Every open thread has someone.",
    snoozed: "Nothing is snoozed.",
    comments: "Comments on our posts show here.",
    dms: "Threads show here once reach messages someone.",
    email: "Email replies from leads show here.",
    mail: "Mail to the mailboxes you connected on Account → Mail shows here.",
    texts: "Text threads show here once someone texts back.",
    chats: "Chats from your site show here. The tag is on Account → Setup.",
    activity: "Follows, mentions and notices show here.",
    all: "Comments, DMs, email replies, mail, texts, site chats and activity show here.",
  },
  actions: INBOX_ACTIONS,
  // The whole conversation with its reply and note boxes; activity has none. A comment adds its
  // whole thread under it.
  extras: withThread(conversationExtras),
  reply: conversationReply,
  count: { status: ["open"] },
};

/** What we'd send, waiting on William's yes (`marketing.approval`): Marketing → To approve. */
const APPROVAL_PAGE: ListPage = {
  id: "approve",
  label: "To approve",
  about: "Drafts, replies and posts that wait on your yes before they go out.",
  template: "list",
  record: "marketing.approval",
  late: queueLate("marketing.approval"),
  // New and waiting rows wait on a yes; queued ones are for info.
  needs: { state: ["new", "waiting"] },
  // Kind says what Type does, in more words.
  // Held and Sends at fill only for Queued; a column blank on every row shown is dropped.
  columns: ["who", "platform", "kind", "state", "pick", "sendAt", "held", "at", "due"],
  empty: {
    waiting: "Nothing waits on your yes.",
    queued:
      "Nothing is queued. A reply you approved shows here when the frequency cap holds it, and a Reddit comment shows here when the subreddit's karma or age rule holds it.",
    posts: "No post draft waits on you.",
    videos: "No rendered video waits on your Approve.",
    threads: "No thread comment waits on you.",
    comments:
      "No LinkedIn comment waits on you. The watch drafts the day's once Shop → LinkedIn comments names an account.",
    invites: "No accepted invite waits on a first message.",
    templates: "No template version waits on a yes.",
    workflows: "No client workflow waits on a yes.",
    replies: "No Inbox reply waits on a yes.",
    swaps: "No title, thumbnail or hook swap waits on a yes.",
    all: "Post drafts, videos, thread comments, first messages, copy, workflows, replies and swaps show here.",
  },
  actions: APPROVAL_ACTIONS,
  extras: withDraft(
    (row) => APPROVAL_DRAFT[String(row.type)] ?? null,
    withShape((detail, at) =>
      at.row.type === "reply"
        ? askedReplyExtras(detail, at.row)
        : (detail as { messages?: unknown } | null)?.messages
          ? dmExtras(detail, at)
          : { sections: [] },
    ),
  ),
  count: { state: ["new", "waiting"] },
};

/** Comment and DM rates, last 30 days: on Marketing's and the Inbox's Overviews. */
export const CONVERSATION_TOP = {
  label: "Conversation, last 30 days",
  record: "marketing.conversation",
  href: "/campaigns/conversation?view=30d",
  fields: ["answered", "replySecs", "dmed", "booked"],
  units: { answered: "answered", replySecs: "to reply", dmed: "to DM", booked: "booked" },
  empty: "No comments from others or DMs in 30 days.",
};

/**
 * Wren's Marketing pages, by id (designs/2026-10-19-portal-reshape.md). The old Marketing app is
 * gone: Content, Engage, Outbound and Analytics each take the pages they show, so a page is
 * declared once. A page keeps its id, so `moved.ts` sends an old address on. A group and a
 * "link only" flag are the taking app's to set. A client's Marketing reads a few of these too.
 */
export const MARKETING_PAGES = {
  inbox: { id: "inbox", ...INBOX_PAGE },
  approve: APPROVAL_PAGE,
  plan: {
    id: "plan",
    label: "Plan",
    about: "What to make today, what waits on you, and what went out.",
    Page: PlanPage,
  },
  studio: {
    id: "studio",
    label: "Studio",
    about: "Make posts, threads, carousels, stories, blog posts and videos, and finish drafts.",
    Page: StudioPage,
    wide: true,
  },
  // Write folded into Studio; its old links land in Studio's New.
  write: {
    id: "write",
    label: "Write",
    about: "Opens Studio's New.",
    hidden: true,
    lights: "studio",
    Page: WritePage,
  },
  // Every post draft, one row per platform: each draft's own page (Pieces links here). Off the
  // tabs: Pieces shows each thing made once, its platforms under it, so the list isn't N copies.
  drafts: {
    id: "drafts",
    label: "Drafts",
    about: "Every post draft: edit it, approve it, it goes out.",
    hidden: true,
    lights: "pieces",
    template: "list",
    record: "marketing.draft",
    empty: {
      next: "Nothing waits on you or is scheduled. Make something in Studio.",
      waiting: "No draft waits on you.",
      scheduled: "Nothing is scheduled.",
      rejected: "Nothing was turned down.",
    },
    actions: DRAFT_ACTIONS,
    // One editor for a post wherever it was opened: words, fields, preview, versions, and the
    // same idea on its other platforms.
    extras: withDraft(POST_DRAFT, withSiblings(withShape())),
  },
  content: {
    id: "content",
    label: "Posts",
    about: "Every post that went out, best first.",
    template: "list",
    record: "marketing.post",
    // The rest of its numbers sit on the post, under How it did.
    columns: ["title", "platform", "published", "format", "stage", "views", "engagement", "clicks"],
    empty: {
      leaderboard: "Posts with views show here, best first.",
      site: "Posts whose link brought a visitor show here.",
      all: "Posts show here once one is published.",
    },
    actions: POST_ACTIONS,
    extras: withAnalytics(withShape(postExtras)),
  },
  comments: {
    id: "comments",
    label: "Comments",
    about: "Comments on your posts, waiting on a reply.",
    template: "list",
    record: "marketing.comment",
    // Their words preview under who; Where, On and Open sit on the comment itself.
    columns: ["who", "platform", "kind", "postTitle", "sort", "state", "at"],
    empty: {
      waiting: "No comment waits on you.",
      answered: "Comments you answered show here.",
      all: "Comments on our posts and under our comments show here.",
    },
    actions: [...COMMENT_ACTIONS, ...COMMENT_ASK, ...THREAD_VIEW_ACTIONS],
    // A click opens the whole comment beside the list: their words, then our answer to edit.
    peek: false,
    // An answered comment shows our answer as sent ("Our answer"), not an empty box.
    extras: withDraft(
      (row) => (row.state === "answered" ? null : COMMENT_DRAFT),
      withThread(() => ({})),
    ),
  },
  // Every recording; Studio's Videos shows the newest and opens each in this page's editor.
  videos: studioVideos({
    id: "videos",
    label: "Recordings",
    about: "Recordings: the agent edits, you review, they go out as videos and Shorts.",
    hidden: true,
    lights: "studio",
    template: "list",
    record: "marketing.video",
    empty: {
      waiting: "No rendered video waits on you.",
      all: "Videos show here a minute after OBS or Cap stops recording on the Mac.",
    },
    actions: VIDEO_ACTIONS,
    extras: videoExtras,
  }),
  // What every draft may claim; the guard's drop reason on a draft links here.
  facts: {
    id: "facts",
    label: "Facts",
    about: "What drafts may say about you and Wren.",
    Page: FactsPage,
  },
  followers: {
    id: "followers",
    label: "Followers",
    about: "Your followers on each platform, and the change in a week.",
    template: "list",
    record: "marketing.audience",
    empty: "No follower count yet. Counts are read once a day; LinkedIn's on Read now.",
    actions: AUDIENCE_ACTIONS,
  },
  conversation: {
    id: "conversation",
    label: "Conversation",
    about: "How fast and how often we answer comments and DMs.",
    template: "list",
    record: "marketing.conversation",
    empty: "Comments from others and DMs we sent show here.",
  },
} satisfies Record<string, ModulePage>;
