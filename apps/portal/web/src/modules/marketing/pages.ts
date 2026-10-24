/**
 * The pages: Inbox, Done and To approve, Content's day, reviews, ad days, the site's pages, and
 * `MARKETING_PAGES`, the one list the team apps take from.
 */

import { KEYWORDS } from "@wren/channel-sms/templates";
import type { Action } from "@wren/ui";
import type { DayPage, ListPage, ModulePage } from "../../module.js";
import { queueLate } from "../inbox-queues.js";
import { withAnalytics } from "./analytics.js";
import { APPROVAL_ACTIONS, APPROVAL_DRAFT, COMMENT_DRAFT, POST_DRAFT } from "./approval.js";
import { withDraft } from "./ask.js";
import { AutoReplyPage } from "./auto-reply.js";
import { NumbersBelow } from "./chart.js";
import { COMMENT_ACTIONS, COMMENT_ASK, THREAD_VIEW_ACTIONS } from "./comments.js";
import { askedReplyExtras, conversationExtras, conversationReply } from "./conversation.js";
import { DM_ACTIONS } from "./dm.js";
import { dmExtras } from "./dms.js";
import { AD_ACTIONS, DRAFT_ACTIONS, POST_ACTIONS, said, TEXT_ACTIONS } from "./drafts.js";
import { EXPLORE_PAGE } from "./engage.js";
import { EXPERIMENT_ACTIONS } from "./experiments.js";
import { FactsPage } from "./facts.js";
import { FeedPage } from "./feed.js";
import { withShape } from "./fields.js";
import { heatExtras } from "./heat.js";
import { INBOX_ACTIONS } from "./inbox.js";
import { PiecesPage } from "./pieces.js";
import { AUDIENCE_ACTIONS, KEYWORD_ACTIONS } from "./places.js";
import { PlanPage } from "./plan.js";
import { postExtras } from "./posts.js";
import { ReportsPage } from "./reports.js";
import { sessionExtras } from "./sessions.js";
import { withSiblings } from "./siblings.js";
import { StudioPage, WritePage } from "./studio.js";
import { SURVEY_ACTIONS } from "./surveys.js";
import { textCopyExtras, textCopyPreview } from "./texts.js";
import { withThread } from "./thread-context.js";
import { VIDEO_ACTIONS, VIDEO_APPROVE } from "./video.js";
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

/**
 * What was done (`marketing.done`, designs/2026-10-11-done.md): every approve, reject, edit and
 * send, today first. Inbox → Done, beside To approve.
 */
export const DONE_PAGE: ListPage = {
  id: "done",
  label: "Done",
  about: "What you approved, rejected, edited or sent, newest first.",
  template: "list",
  record: "marketing.done",
  columns: ["what", "event", "kind", "platform", "via", "at", "url", "open"],
  empty: {
    today: "Nothing done yet today. Approve, reject or edit something and it lands here.",
    week: "Nothing done this week.",
    approved: "Nothing approved yet.",
    rejected: "Nothing rejected yet.",
    sent: "Nothing sent yet.",
    all: "Every approve, reject, edit and send shows here.",
  },
};

/** What we'd send, waiting on William's yes (`marketing.approval`): Marketing → To approve. */
export const APPROVAL_PAGE: ListPage = {
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

// Texts and DM slots edit in place (the record's `edits`): History, Undo, Ask Claude. A keyword
// reply keeps Edit, since saving it sets the provider's answer too.
const TEXT_COPY_ACTIONS: Action[] = [
  {
    id: "marketing.textCopy",
    label: "Edit",
    icon: "edit",
    when: { id: KEYWORDS.map((k) => `keyword.${k}`) },
    handler: "marketing/textCopy",
    ask: { field: "body", label: "Your words", from: "body", preview: textCopyPreview },
    key: "e",
    done: said("Saved"),
  },
];

/**
 * Content's day, by platform: what posts and posted, and what waits on him. Waiting work dated
 * before today (a draft by when it was drafted, a comment or DM by when it came, a video by its
 * last change) sits on today until it's done.
 */
const TODAY: DayPage = {
  id: "today",
  label: "Today",
  about: "Each platform's day: what went out and what waits on you.",
  // Platform is a filter, not a page (2026-10-14-content-types.md); Today (plan) replaces it.
  hidden: true,
  template: "day",
  by: "platform",
  sources: [
    {
      record: "marketing.draft",
      label: "Scheduled",
      view: "scheduled",
      at: "scheduled",
      open: "/content/drafts",
    },
    {
      record: "marketing.post",
      label: "Posted",
      view: "all",
      at: "published",
      open: "/content/content",
    },
    {
      record: "marketing.draft",
      label: "Drafts waiting",
      view: "waiting",
      at: "created",
      carry: true,
      action: "marketing.approveDraft",
      open: "/content/drafts",
    },
    {
      record: "marketing.comment",
      label: "Comments to answer",
      view: "waiting",
      at: "at",
      carry: true,
      action: "marketing.commentAnswer",
      open: "/engage/comments",
    },
    {
      record: "marketing.dm",
      label: "DMs to answer",
      view: "waiting",
      at: "lastAt",
      carry: true,
      action: "marketing.dmReply",
      open: "/engage/dms",
    },
    {
      record: "marketing.video",
      label: "Videos to approve",
      view: "waiting",
      at: "updated",
      carry: true,
      action: "marketing.videoApprove",
      open: "/content/videos",
    },
  ],
  actions: [...DRAFT_ACTIONS, ...COMMENT_ACTIONS, ...DM_ACTIONS, VIDEO_APPROVE],
};

/** Comment and DM rates, last 30 days: on Marketing's and the Inbox's Overviews. */
export const CONVERSATION_TOP = {
  label: "Conversation, last 30 days",
  record: "marketing.conversation",
  href: "/engage/conversation?view=30d",
  fields: ["answered", "replySecs", "dmed", "booked"],
  units: { answered: "answered", replySecs: "to reply", dmed: "to DM", booked: "booked" },
  empty: "No comments from others or DMs in 30 days.",
};

/** Reviews of the business with their stars; a reply is drafted as each lands. */
export const REVIEWS_PAGE: ListPage = {
  id: "reviews",
  label: "Reviews",
  about: "Reviews of your business, each with a reply to send.",
  group: "Reach",
  template: "list",
  record: "marketing.review",
  columns: ["who", "stars", "words", "reply", "platform", "at"],
  empty: {
    waiting: "Every review has a reply.",
    low: "No review under 4 stars.",
    all: "Reviews show here once a Business Profile is connected.",
  },
};

/** Ad set days (`marketing.ad_day`): Wren's Ads app, and a client's Marketing → Ads. */
export const AD_DAYS: ListPage = {
  id: "ads",
  label: "Ads",
  about: "How each ad set did, day by day.",
  template: "list",
  record: "marketing.ad_day",
  empty: "Ad days show here once an ad runs.",
  actions: AD_ACTIONS,
  extras: postExtras,
};

/** The site's visitors and search: Wren's Sites app, under Visitors and Search. */
export const SITE_PAGES: ListPage[] = [
  {
    id: "visits",
    label: "Visits",
    about: "Visits to your site, day by day.",
    group: "Visitors",
    template: "list",
    record: "marketing.site_day",
    empty: "Site visits show here a day after they happen.",
  },
  {
    id: "sessions",
    label: "Sessions",
    about: "Recordings of single visits to your site, to replay.",
    group: "Visitors",
    template: "list",
    record: "marketing.session",
    empty: {
      applied: "No recorded visitor applied yet.",
      recent: "Replays show here once a visitor says yes to cookies.",
    },
    extras: sessionExtras,
  },
  {
    id: "heatmaps",
    label: "Heatmaps",
    about: "Where visitors click and how far they scroll, per page.",
    group: "Visitors",
    template: "list",
    record: "marketing.heat",
    empty: "Heatmaps show here a day after visitors click on the site.",
    extras: heatExtras,
  },
  {
    id: "experiments",
    label: "Experiments",
    about: "Tests of a site's variants, and which one wins.",
    group: "Visitors",
    template: "list",
    record: "marketing.experiment",
    empty: {
      all: "No experiments yet. New experiment tests a site flag's variants.",
      running: "Nothing running.",
    },
    actions: EXPERIMENT_ACTIONS,
  },
  {
    id: "surveys",
    label: "Surveys",
    about: "One-question surveys for site visitors or clients.",
    group: "Visitors",
    template: "list",
    record: "marketing.survey",
    // The key is each question's second line; the rule and the dates are a Display pick away.
    columns: ["question", "kind", "surface", "state", "answers", "startedAt"],
    empty: {
      all: "No surveys yet. New survey asks site visitors or client logins one question.",
      live: "Nothing live.",
    },
    actions: SURVEY_ACTIONS,
  },
  {
    id: "survey-answers",
    label: "Survey answers",
    about: "The answers your surveys got.",
    group: "Visitors",
    template: "list",
    record: "marketing.survey_answer",
    empty: "Site answers show here once a live survey is answered.",
  },
  {
    id: "search-days",
    label: "Search days",
    about: "Your Google search numbers, day by day.",
    group: "Search",
    hidden: true,
    template: "list",
    record: "marketing.search_day",
    empty: "Search days show here once Search Console is read.",
  },
  {
    id: "search",
    label: "Search",
    about: "Your site's pages, and whether Google has them.",
    group: "Search",
    template: "list",
    record: "marketing.search_page",
    empty: { not_indexed: "Every checked page is indexed.", all: "No page checked yet." },
  },
  {
    id: "keywords",
    label: "Keywords",
    about: "The searches you show up for, and where you rank.",
    group: "Search",
    template: "list",
    record: "marketing.keyword",
    empty: "Keywords show here once search runs.",
  },
  {
    id: "answers",
    label: "AI answers",
    about: "What AI assistants say when asked your keywords.",
    group: "Search",
    template: "list",
    record: "marketing.answer",
    empty: {
      latest: "AI answers show here once a keyword is asked.",
      cited: "No AI answer names Wren yet.",
      all: "AI answers show here once a keyword is asked.",
    },
  },
];

/**
 * Wren's Marketing pages, by id (designs/2026-10-19-portal-reshape.md). The old Marketing app is
 * gone: Content, Engage, Outbound and Analytics each take the pages they show, so a page is
 * declared once. A page keeps its id, so `moved.ts` sends an old address on. A group and a
 * "link only" flag are the taking app's to set. A client's Marketing reads a few of these too.
 */
export const MARKETING_PAGES = {
  inbox: { id: "inbox", ...INBOX_PAGE },
  approve: APPROVAL_PAGE,
  "auto-reply": {
    id: "auto-reply",
    label: "Auto-reply",
    about: "What happens when someone writes in, per channel.",
    Page: AutoReplyPage,
  },
  keywords: {
    id: "keywords",
    label: "Comment keywords",
    about: "Words that get a commenter your DM when they say them.",
    template: "list",
    record: "marketing.comment_keyword",
    actions: KEYWORD_ACTIONS,
    empty: "No keywords yet. Add one: a comment that says it gets your DM.",
  },
  "keyword-dms": {
    id: "keyword-dms",
    label: "Keyword DMs",
    about: "Comments that said a keyword, and the DM each one got.",
    template: "list",
    record: "marketing.keyword_hit",
    empty: "No comment has said a keyword yet.",
  },
  reviews: REVIEWS_PAGE,
  today: TODAY,
  plan: {
    id: "plan",
    label: "Plan",
    about: "What to make today, what waits on you, and what went out.",
    Page: PlanPage,
  },
  pieces: {
    id: "pieces",
    label: "Pieces",
    about: "Everything you made, each with everywhere it went.",
    Page: PiecesPage,
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
  feed: {
    id: "feed",
    label: "Feed",
    about: "Posts from the people and topics you follow.",
    Page: FeedPage,
    wide: true,
  },
  explore: EXPLORE_PAGE,
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
  topics: {
    id: "topics",
    label: "Topics",
    about: "The email topics people can sign up for.",
    template: "list",
    record: "marketing.topic",
    empty: "Email topics people can sign up for show here.",
  },
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
  subscribers: {
    id: "subscribers",
    label: "Subscribers",
    about: "People who signed up for your email topics.",
    template: "list",
    record: "marketing.subscriber",
    empty: {
      confirmed: "No one has confirmed yet.",
      pending: "No signup waits on a confirm.",
      withdrawn: "No one has left.",
      paused: "No one has paused.",
      all: "Signups show here from the site, forms and texts.",
    },
  },
  texts: {
    id: "texts",
    label: "Texts",
    about: "Text conversations waiting on your reply.",
    template: "list",
    record: "marketing.text_contact",
    empty: {
      waiting: "No reply waits on you.",
      texted: "No one texted yet.",
      replied: "People who texted back show here.",
      opted_out: "No one has opted out.",
    },
    actions: TEXT_ACTIONS,
  },
  "text-copy": {
    id: "text-copy",
    label: "Text copy",
    about: "The words of every text we send.",
    template: "list",
    record: "marketing.text_copy",
    empty: { empty: "Every text has words.", all: "No sequence has texts." },
    actions: TEXT_COPY_ACTIONS,
    extras: textCopyExtras,
  },
  overview: {
    id: "overview",
    label: "Numbers",
    about: "Your marketing numbers at a glance.",
    template: "overview",
    tiles: [
      {
        label: "Content views",
        record: "marketing.post",
        href: "/content/content?view=all",
        period: "month",
        sum: "views",
      },
      {
        label: "Site visitors from posts",
        record: "marketing.link_day",
        href: "/analytics/links?view=posts",
        period: "month",
        sum: "clicks",
      },
      {
        label: "Ad impressions",
        record: "marketing.ad_day",
        href: "/ads/sets?view=campaign",
        period: "month",
        sum: "impressions",
      },
      {
        label: "Search impressions",
        record: "marketing.search_day",
        href: "/analytics/search-days?view=all",
        period: "month",
        sum: "impressions",
      },
      {
        label: "Site visits",
        record: "marketing.site_day",
        href: "/analytics/visits?view=channel",
        period: "month",
        sum: "visits",
      },
      {
        label: "Forms",
        record: "marketing.site_day",
        href: "/analytics/visits?view=channel",
        period: "month",
        sum: "forms",
      },
      {
        label: "Booking clicks",
        record: "marketing.site_day",
        href: "/analytics/visits?view=channel",
        period: "month",
        sum: "bookings",
      },
      {
        label: "Calls booked",
        record: "marketing.site_day",
        href: "/analytics/funnel?view=30d",
        period: "month",
        sum: "calls",
      },
      {
        label: "Paid",
        record: "marketing.site_day",
        href: "/analytics/funnel?view=30d",
        period: "month",
        sum: "paid",
      },
      {
        label: "Ad spend",
        record: "marketing.ad_day",
        href: "/ads/sets?view=campaign",
        period: "month",
        sum: "spend",
      },
      {
        label: "To approve",
        record: "marketing.approval",
        href: "/engage/approve?view=waiting",
        needs: true,
      },
      {
        label: "Drafts waiting",
        record: "marketing.draft",
        href: "/content/pieces?show=waiting&sort=waiting",
        needs: true,
      },
      {
        label: "Texts waiting",
        record: "marketing.text_contact",
        href: "/outbound/texts?view=waiting",
        needs: true,
      },
      {
        label: "Comments waiting",
        record: "marketing.comment",
        href: "/engage/comments?view=waiting",
        needs: true,
      },
      {
        label: "New activity",
        record: "marketing.activity",
        href: "/engage/inbox?view=activity",
        needs: true,
      },
    ],
    top: [
      {
        label: "Followers",
        record: "marketing.audience",
        href: "/engage/followers",
        fields: ["followers", "week"],
        empty: "No follower count yet. Counts are read once a day.",
      },
      {
        label: "This week against goals",
        record: "marketing.cadence",
        href: "/content/cadence?view=week",
        fields: ["done", "goal"],
        empty: "No goals set.",
      },
      {
        label: "What worked last week",
        record: "marketing.digest",
        href: "/content/digest?view=worked",
        fields: ["kind"],
        empty: "The first digest lands on Monday.",
      },
      {
        label: "Top posts",
        record: "marketing.post",
        href: "/content/content?view=leaderboard",
        fields: ["views", "engagement", "format"],
        empty: "No post has numbers yet.",
      },
      {
        label: "Posts that brought visitors",
        record: "marketing.post",
        href: "/content/content?view=site",
        fields: ["clicks", "toSite"],
        units: { toSite: "of views" },
        empty: "No post's link has brought a visitor yet.",
      },
      CONVERSATION_TOP,
      {
        label: "Numbers not read yet",
        record: "marketing.metric",
        href: "/content/metrics?view=scope",
        fields: ["state"],
        line: "step",
        empty: "Every number that needs a step is read.",
      },
      {
        label: "Top keywords",
        record: "marketing.keyword",
        href: "/analytics/keywords?view=active",
        fields: ["clicks", "impressions"],
        empty: "No keyword has impressions yet.",
      },
    ],
    below: NumbersBelow,
  },
  funnel: {
    id: "funnel",
    label: "Funnel",
    about: "Each channel's funnel, from first visit to booking.",
    template: "list",
    record: "marketing.funnel",
    empty: "Funnels show here a day after the site's first visit.",
  },
  links: {
    id: "links",
    label: "Links",
    about: "Who came through each tracked link, and what they did next.",
    hidden: true,
    template: "list",
    record: "marketing.link_day",
    empty: {
      month: "Clicks show here a day after they happen.",
      posts: "Visitors from a post's link show here.",
      all: "Clicks show here a day after they happen.",
    },
  },
  conversation: {
    id: "conversation",
    label: "Conversation",
    about: "How fast and how often we answer comments and DMs.",
    template: "list",
    record: "marketing.conversation",
    empty: "Comments from others and DMs we sent show here.",
  },
  cadence: {
    id: "cadence",
    label: "Cadence",
    about: "Your posting goals against what went out this week.",
    hidden: true,
    template: "list",
    record: "marketing.cadence",
    empty: "No goals set.",
  },
  digest: {
    id: "digest",
    label: "What worked",
    about: "What worked last week, by platform.",
    hidden: true,
    template: "list",
    record: "marketing.digest",
    empty: "The first digest lands on Monday.",
  },
  metrics: {
    id: "metrics",
    label: "Every number",
    about: "Every number we track, and what each missing one needs.",
    hidden: true,
    template: "list",
    record: "marketing.metric",
    empty: { gaps: "Every number is read.", scope: "No number waits on a step." },
  },
  reports: {
    id: "reports",
    label: "Reports",
    about: "Your numbers by email each week or month, against the one before.",
    Page: ReportsPage,
    requires: { needs: "manage" },
  },
} satisfies Record<string, ModulePage>;
