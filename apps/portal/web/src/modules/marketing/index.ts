/**
 * Marketing (designs/2026-10-05-marketing-app.md): content, ads, search, texts and site visits
 * as one funnel, in Wren's workspace. Records and templates only; the console serves them.
 */
import { KEYWORDS } from "@wren/channel-sms/templates";
import type { Action } from "@wren/ui";
import type { ListPage, Module } from "../../module.js";
import { threadExtras } from "../texts/index.js";
import { REPLY_ACTIONS, REPLY_WAITING } from "../wren/replies.js";
import { DRAFT_BOX, type DraftOf, draftActions, withDraft } from "./ask.js";
import { WeeklyBookings } from "./chart.js";
import { copyExtras, dmExtras, dmLooks } from "./dms.js";
import { postExtras, postLooks } from "./posts.js";
import { sessionExtras } from "./sessions.js";
import { textCopyExtras, textCopyPreview } from "./texts.js";
import { videoExtras } from "./videos.js";

const said = (line: string) => () => line;

const POST_ACTIONS: Action[] = [
  {
    id: "marketing.draftAgain",
    label: "Draft again",
    handler: "marketing/draftAgain",
    confirm: "Draft this idea again for this platform?",
    done: said("Drafting. It shows in the content desk."),
  },
];

const WAITING = { state: ["draft", "failed"] };
const OPEN = { state: ["draft", "failed", "approved"] };
const DRAFT_ACTIONS: Action[] = [
  {
    id: "marketing.approveDraft",
    label: "Approve",
    handler: "marketing/approveDraft",
    confirm: "Post this at its platform's next slot?",
    key: "a",
    bulk: true,
    when: WAITING,
    done: said("Scheduled at its next slot"),
  },
  {
    id: "marketing.redraft",
    label: "Redraft",
    handler: "marketing/redraft",
    ask: { field: "note", label: "What to change" },
    when: OPEN,
    done: said("Redrafting. The new one shows here."),
  },
  {
    id: "marketing.rejectDraft",
    label: "Reject",
    handler: "marketing/rejectDraft",
    confirm: "Turn this draft down?",
    key: "r",
    bulk: true,
    when: OPEN,
    done: said("Rejected"),
  },
  ...draftActions("post", OPEN),
];

const AD_ACTIONS: Action[] = [
  {
    id: "marketing.pause",
    label: "Pause",
    handler: "marketing/pause",
    ask: { field: "reason", label: "Why?" },
    when: { state: ["active"] },
    done: said("Paused"),
  },
  {
    // It spends again: asked every time, never an undo.
    id: "marketing.resume",
    label: "Resume",
    handler: "marketing/resume",
    confirm: "Start spending on it again at its budget?",
    when: { state: ["paused", "stopped"] },
    done: said("Running again"),
  },
];

const TEXT_ACTIONS: Action[] = [
  {
    id: "marketing.markRead",
    label: "Mark read",
    handler: "marketing/markRead",
    bulk: true,
    key: "e",
    when: { waiting: ["waiting"] },
    done: said("Marked read"),
  },
];

const DM_ACTIONS: Action[] = [
  {
    id: "marketing.dmReply",
    label: "Reply",
    handler: "marketing/dmReply",
    // The draft box holds the words; this sends what it saved.
    confirm: "Send this reply?",
    key: "r",
    done: said("Queued. It leaves on the next tick."),
  },
  {
    id: "marketing.dmRead",
    label: "Mark read",
    handler: "marketing/dmRead",
    bulk: true,
    key: "e",
    when: { waiting: ["waiting"] },
    done: said("Marked read"),
  },
];

const COMMENT_ACTIONS: Action[] = [
  {
    id: "marketing.commentAnswer",
    label: "Answer",
    handler: "marketing/commentAnswer",
    confirm: "Post this answer under their comment?",
    key: "r",
    when: { state: ["new", "waiting"] },
    done: said("Answered in the thread"),
  },
  {
    id: "marketing.commentDm",
    label: "DM them",
    handler: "marketing/commentDm",
    ask: { field: "body", label: "Your DM" },
    key: "m",
    when: { state: ["new", "waiting", "answered"], channel: ["reach"] },
    done: said("Queued. It leaves on the next tick."),
  },
  {
    id: "marketing.commentDrop",
    label: "Drop",
    handler: "marketing/commentDrop",
    bulk: true,
    key: "e",
    when: { state: ["new", "waiting"] },
    done: said("Dropped"),
  },
];
/** Comments waiting on him: the draft answer in its box. */
const COMMENT_ASK = draftActions("comment", { state: ["new", "waiting"] });

const ACTIVITY_ACTIONS: Action[] = [
  {
    id: "marketing.activitySeen",
    label: "Mark seen",
    handler: "marketing/activitySeen",
    bulk: true,
    key: "e",
    when: { state: ["new"] },
    done: said("Marked seen"),
  },
  {
    id: "marketing.activityAllSeen",
    label: "Mark all seen",
    handler: "marketing/activityAllSeen",
    form: [],
    done: said("Every new activity marked seen"),
  },
];

/** Approve is his yes: the file uploads to YouTube, private, on the next pass. */
const VIDEO_APPROVE: Action = {
  id: "marketing.videoApprove",
  label: "Approve",
  handler: "marketing/videoApprove",
  confirm: "Upload the long video to YouTube, private?",
  key: "a",
  when: { state: ["rendered"] },
  done: said("Approved. It uploads, private, on the next pass."),
};
const VIDEO_ACTIONS: Action[] = [
  VIDEO_APPROVE,
  {
    id: "marketing.videoApproveShort",
    label: "Approve a Short",
    handler: "marketing/videoApproveShort",
    each: true,
    form: [{ field: "short", label: "Short", type: "number", hint: "1 is the first Short." }],
    when: { state: ["rendered", "approved", "uploaded"] },
    done: said("Approved. The Short uploads, private, on the next pass."),
  },
  {
    id: "marketing.videoThumbnail",
    label: "Pick thumbnail",
    handler: "marketing/videoThumbnail",
    each: true,
    form: [{ field: "n", label: "Thumbnail", type: "select", options: ["1", "2", "3"] }],
    when: { state: ["rendered", "approved"] },
    done: said("Picked. It goes up with the video."),
  },
  {
    id: "marketing.videoRender",
    label: "Render",
    handler: "marketing/videoRender",
    key: "r",
    confirm:
      "Cut and render it on the Mac? It takes a few minutes, and waits while the Mac is off.",
    when: { state: ["added", "edited", "rendered"] },
    done: said("Queued. The Mac renders it; it waits while the Mac is off."),
  },
  // The page's editor runs these from inside the detail (videos.tsx), never from the head.
  ...(
    [
      ["videoSet", "Save"],
      ["videoCut", "Cut"],
      ["videoAsk", "Ask Claude"],
      ["videoUndo", "Undo"],
    ] as const
  ).map(([id, label]) => ({
    id: `marketing.${id}`,
    label,
    handler: `marketing/${id}`,
    inline: true as const,
  })),
];

/** One read on his click; the loops behind these pages stay as they are. */
const readNow = (id: string, handler: string, done: (answer: unknown) => string): Action => ({
  id,
  label: "Read now",
  handler,
  form: [],
  done,
});
const AUDIENCE_ACTIONS: Action[] = [
  readNow(
    "marketing.audienceRead",
    "marketing/audienceRead",
    (a) => `LinkedIn: ${(a as { followers?: number } | null)?.followers ?? "no"} followers`,
  ),
];
const DISCOVERY_READ = readNow(
  "marketing.discoveryRead",
  "marketing/discoveryRead",
  () => "Reading. Places and Threads fill in over a few minutes.",
);

const PLACE_ACTIONS: Action[] = [
  {
    id: "marketing.placeWatch",
    label: "Watch",
    handler: "marketing/placeWatch",
    bulk: true,
    key: "w",
    when: { state: ["found", "skipped"] },
    done: said("Watching. Its threads are read every 2 hours."),
  },
  {
    id: "marketing.placeSkip",
    label: "Skip",
    handler: "marketing/placeSkip",
    bulk: true,
    key: "e",
    when: { state: ["found", "watching"] },
    done: said("Skipped"),
  },
  {
    id: "marketing.placeMove",
    label: "Move account",
    handler: "marketing/placeMove",
    each: true,
    form: [
      {
        field: "account",
        label: "Account",
        hint: "One of ours in Reach: reddit@alt or its handle.",
      },
    ],
    when: { state: ["watching"] },
    done: said("Moved"),
  },
  DISCOVERY_READ,
];

const INVITE_ACTIONS: Action[] = [
  {
    id: "marketing.inviteMessage",
    label: "Message",
    handler: "marketing/dmReply",
    confirm: "Send this message?",
    key: "r",
    when: { status: ["accepted"] },
    done: said("Queued. It leaves on the next tick."),
  },
  {
    id: "marketing.inviteRead",
    label: "Mark read",
    handler: "marketing/dmRead",
    bulk: true,
    key: "e",
    when: { status: ["accepted"] },
    done: said("Marked read"),
  },
  {
    id: "marketing.inviteWithdraw",
    label: "Withdraw",
    handler: "marketing/inviteWithdraw",
    key: "w",
    when: { status: ["pending"] },
    done: said("Withdrawn"),
  },
];

const THREAD_ACTIONS: Action[] = [
  {
    id: "marketing.threadComment",
    label: "Comment",
    handler: "marketing/threadComment",
    confirm: "Post this comment in the thread?",
    key: "r",
    when: { state: ["queued"] },
    done: said("Commented"),
  },
  {
    id: "marketing.threadSkip",
    label: "Skip",
    handler: "marketing/threadSkip",
    bulk: true,
    key: "e",
    when: { state: ["new", "ranked", "queued"] },
    done: said("Skipped"),
  },
  ...draftActions("thread", { state: ["new", "ranked", "queued"] }),
  DISCOVERY_READ,
];

/** An Inbox id carries its type (`dm:5`); a preview reads the row's own id after the colon. */
const bare = (id: string | number) => String(id).slice(String(id).indexOf(":") + 1);

/** Each action on the rows of its own type, its preview on the row's own id. */
const only = (type: string, a: Action, when: Action["when"] = a.when): Action => {
  const preview = a.ask?.preview;
  return {
    ...a,
    ...(a.ask && typeof preview === "function"
      ? { ask: { ...a.ask, preview: (id: string | number) => preview(bare(id)) } }
      : {}),
    when: { ...when, type: [type] },
  };
};
/** Every Inbox row but activity reads as waiting or not; each page's states are mapped to it. */
const WAITS = { state: ["waiting"] };
/** A page's own draft box and its Read now stay there; the Inbox has one box of each kind. */
const own = (a: Action) => !a.form && !DRAFT_BOX.includes(a.id);
const INBOX_ACTIONS: Action[] = [
  // A post's words are the row's body here.
  ...DRAFT_ACTIONS.filter(own).map((a) =>
    only("draft", a.ask?.from ? { ...a, ask: { ...a.ask, from: "body" } } : a, WAITS),
  ),
  ...COMMENT_ACTIONS.map((a) => only("comment", a)),
  ...DM_ACTIONS.filter(own).map((a) =>
    only("dm", a, a.id === "marketing.dmReply" ? a.when : WAITS),
  ),
  ...THREAD_ACTIONS.filter(own).map((a) => only("thread", a, WAITS)),
  ...INVITE_ACTIONS.filter((a) => own(a) && a.id !== "marketing.inviteWithdraw").map((a) =>
    only("invite", a, a.id === "marketing.inviteMessage" ? { state: ["waiting", "read"] } : WAITS),
  ),
  // SMS copy is William's: Mark read only, no Ask Claude.
  ...TEXT_ACTIONS.map((a) => only("text", a, WAITS)),
  // A reply's call invite, as its replies page answers it; a reply with none has no actions.
  ...REPLY_ACTIONS.map((a) => only("email", a, { answer: REPLY_WAITING.state })),
  ...ACTIVITY_ACTIONS.map((a) => (a.form ? a : only("activity", a))),
  // The long video's yes; Shorts and thumbnails are picked on its Videos page.
  only("video", VIDEO_APPROVE, WAITS),
  ...draftActions("inbox", {
    type: ["comment", "draft", "thread", "dm", "invite"],
    state: ["new", "waiting", "read"],
  }),
];

/** Each page's draft box: its field, its words' label and what sends it. */
const POST_DRAFT: DraftOf = {
  field: "text",
  label: "The post",
  send: "marketing.approveDraft",
  preview: postLooks,
};
const COMMENT_DRAFT: DraftOf = {
  field: "draft",
  label: "Your answer, posted under their comment",
  send: "marketing.commentAnswer",
};
const DM_DRAFT: DraftOf = {
  field: "draft",
  label: "Your reply",
  send: "marketing.dmReply",
  preview: dmLooks,
};
const INVITE_DRAFT: DraftOf = {
  field: "draft",
  label: "Your message",
  send: "marketing.inviteMessage",
  preview: dmLooks,
};
const THREAD_DRAFT: DraftOf = {
  field: "draft",
  label: "Your comment, posted in the thread",
  send: "marketing.threadComment",
};
/** The Inbox row's type picks its box; a post's words are the row's body there. */
const INBOX_DRAFT: Record<string, DraftOf> = {
  draft: { ...POST_DRAFT, field: "body" },
  comment: COMMENT_DRAFT,
  dm: DM_DRAFT,
  invite: INVITE_DRAFT,
  thread: THREAD_DRAFT,
};

/**
 * The one queue (`marketing.inbox`): Marketing → Inbox and the Inbox app's "Waiting on you" are
 * this page, each under its own id.
 */
export const INBOX_PAGE: Omit<ListPage, "id"> = {
  label: "Inbox",
  template: "list",
  record: "marketing.inbox",
  empty: {
    waiting: "Nothing waits on you.",
    posts: "No post draft waits on you.",
    comments: "Comments on our posts show here.",
    dms: "Threads show here once reach messages someone.",
    threads: "No thread to answer.",
    invites: "No accepted invite waits on a first message.",
    email: "Email replies from leads show here.",
    texts: "Text threads show here once someone texts back.",
    videos: "No rendered video waits on your Approve.",
    activity: "Follows, mentions and notices show here.",
    all: "Drafts, comments, DMs, threads, invites, replies, texts and activity show here.",
  },
  actions: INBOX_ACTIONS,
  extras: withDraft(
    (row) => INBOX_DRAFT[String(row.type)] ?? null,
    (detail, at) =>
      at.row.type === "text"
        ? threadExtras(detail, at)
        : (detail as { messages?: unknown } | null)?.messages
          ? dmExtras(detail, at)
          : { sections: [] },
  ),
  count: { state: ["new", "waiting"] },
};

const PERSON_ACTIONS: Action[] = [
  {
    id: "marketing.personDraft",
    label: "Draft",
    handler: "marketing/personDraft",
    key: "d",
    when: { can: ["message"] },
    done: said("Drafted. Message opens with it."),
  },
  {
    id: "marketing.personMessage",
    label: "Message",
    handler: "marketing/personMessage",
    ask: { field: "body", label: "Your message", from: "draft" },
    key: "r",
    when: { can: ["message"] },
    done: said("Queued. It leaves on the next tick."),
  },
  {
    id: "marketing.personInvite",
    label: "Invite",
    handler: "marketing/personInvite",
    confirm: "Send them a LinkedIn invite?",
    key: "i",
    when: { can: ["invite"] },
    done: said("Queued. It leaves under the day's invite cap."),
  },
];

// Texts and DM slots edit in place (the record's `edits`): History, Undo, Ask Claude. A keyword
// reply keeps Edit, since saving it sets the provider's answer too.
const TEXT_COPY_ACTIONS: Action[] = [
  {
    id: "marketing.textCopy",
    label: "Edit",
    when: { id: KEYWORDS.map((k) => `keyword.${k}`) },
    handler: "marketing/textCopy",
    ask: { field: "body", label: "Your words", from: "body", preview: textCopyPreview },
    key: "e",
    done: said("Saved"),
  },
];

export const marketing: Module = {
  id: "marketing",
  name: "Marketing",
  component: "marketing.stats",
  icon: "board",
  blurb: "Every platform in one place: what waits on you, drafts, people and the numbers.",
  requires: { audience: "team" },
  pages: [
    { id: "inbox", ...INBOX_PAGE },
    {
      id: "drafts",
      label: "Drafts",
      group: "Content",
      template: "list",
      record: "marketing.draft",
      empty: {
        waiting: "No draft waits on you.",
        scheduled: "Nothing is scheduled.",
        rejected: "Nothing was turned down.",
      },
      actions: DRAFT_ACTIONS,
      extras: withDraft(POST_DRAFT),
    },
    {
      id: "content",
      label: "Posts",
      group: "Content",
      template: "list",
      record: "marketing.post",
      empty: "Posts show here once one is published.",
      actions: POST_ACTIONS,
      extras: postExtras,
    },
    {
      id: "comments",
      label: "Comments",
      group: "Content",
      template: "list",
      record: "marketing.comment",
      empty: {
        waiting: "No comment waits on you.",
        answered: "Comments you answered show here.",
        all: "Comments on our posts and under our comments show here.",
      },
      actions: [...COMMENT_ACTIONS, ...COMMENT_ASK],
      extras: withDraft(COMMENT_DRAFT),
    },
    {
      id: "videos",
      label: "Videos",
      group: "Content",
      template: "list",
      record: "marketing.video",
      empty: {
        waiting: "No rendered video waits on you.",
        all: "Videos show here a minute after OBS or Cap stops recording on the Mac.",
      },
      actions: VIDEO_ACTIONS,
      extras: videoExtras,
    },
    {
      id: "topics",
      label: "Topics",
      group: "Content",
      template: "list",
      record: "marketing.topic",
      empty: "Email topics people can sign up for show here.",
    },
    {
      id: "people",
      label: "People",
      group: "People",
      template: "list",
      record: "marketing.person",
      empty: {
        message: "No one to message yet. Accepted invites and Reddit people show here.",
        invite: "No one to invite. People with a LinkedIn page show here.",
        all: "People with a LinkedIn page or a Reddit read show here.",
      },
      actions: PERSON_ACTIONS,
    },
    {
      id: "dms",
      label: "DMs",
      group: "People",
      template: "list",
      record: "marketing.dm",
      empty: {
        waiting: "No DM waits on you.",
        replied: "Threads where they wrote back show here.",
        all: "Threads show here once reach messages someone.",
      },
      actions: [
        ...DM_ACTIONS,
        ...draftActions("dm", { state: ["new", "enrolled", "connected", "replied", "finished"] }),
      ],
      extras: withDraft(DM_DRAFT, dmExtras),
    },
    {
      id: "invites",
      label: "Invites",
      group: "People",
      template: "list",
      record: "marketing.invite",
      empty: {
        queued: "Nothing to send. Invites queue once an account is set in Shop → LinkedIn invites.",
        pending: "No invite waits on an answer.",
        accepted: "Accepted invites show here, ready for a first message.",
        withdrawn: "Withdrawn and ended invites show here.",
        all: "LinkedIn invites show here.",
      },
      actions: [...INVITE_ACTIONS, ...draftActions("invite", { status: ["accepted"] })],
      // Only an accepted invite takes a message.
      extras: withDraft((row) => (row.status === "accepted" ? INVITE_DRAFT : null)),
    },
    {
      id: "followers",
      label: "Followers",
      group: "People",
      template: "list",
      record: "marketing.audience",
      empty: "No follower count yet. SocialWatch reads one a day; LinkedIn's on Read now.",
      actions: AUDIENCE_ACTIONS,
    },
    {
      id: "subscribers",
      label: "Subscribers",
      group: "People",
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
    {
      id: "dm-copy",
      label: "DM copy",
      group: "People",
      template: "list",
      record: "marketing.dm_copy",
      empty: { empty: "Every slot has words.", all: "No reach sequence has slots." },
      extras: copyExtras,
    },
    {
      id: "threads",
      label: "Threads",
      group: "Discover",
      template: "list",
      record: "marketing.thread",
      empty: {
        queued: "No thread to answer. Watch a place to read its new posts.",
        commented: "Threads we commented in show here.",
        all: "New posts in watched places show here.",
      },
      actions: THREAD_ACTIONS,
      extras: withDraft(THREAD_DRAFT),
    },
    {
      id: "places",
      label: "Places",
      group: "Discover",
      template: "list",
      record: "marketing.place",
      empty: {
        found: "Nothing to pick. Places are found once a month from the audience.",
        watching: "No place watched yet. Pick one under To pick.",
        all: "Subreddits found for the audience show here.",
      },
      actions: PLACE_ACTIONS,
    },
    {
      id: "texts",
      label: "Texts",
      group: "Texts",
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
    {
      id: "text-copy",
      label: "Text copy",
      group: "Texts",
      template: "list",
      record: "marketing.text_copy",
      empty: { empty: "Every text has words.", all: "No sequence has texts." },
      actions: TEXT_COPY_ACTIONS,
      extras: textCopyExtras,
    },
    {
      id: "overview",
      label: "Overview",
      group: "Numbers",
      template: "overview",
      tiles: [
        {
          label: "Content views",
          record: "marketing.post",
          href: "/marketing/content?view=all",
          period: "month",
          sum: "views",
        },
        {
          label: "Ad impressions",
          record: "marketing.ad_day",
          href: "/marketing/ads?view=campaign",
          period: "month",
          sum: "impressions",
        },
        {
          label: "Search impressions",
          record: "marketing.search_day",
          href: "/marketing/search-days?view=all",
          period: "month",
          sum: "impressions",
        },
        {
          label: "Site visits",
          record: "marketing.site_day",
          href: "/marketing/site?view=channel",
          period: "month",
          sum: "visits",
        },
        {
          label: "Forms",
          record: "marketing.site_day",
          href: "/marketing/site?view=channel",
          period: "month",
          sum: "forms",
        },
        {
          label: "Booking clicks",
          record: "marketing.site_day",
          href: "/marketing/site?view=channel",
          period: "month",
          sum: "bookings",
        },
        {
          label: "Calls booked",
          record: "marketing.site_day",
          href: "/marketing/funnel?view=30d",
          period: "month",
          sum: "calls",
        },
        {
          label: "Paid",
          record: "marketing.site_day",
          href: "/marketing/funnel?view=30d",
          period: "month",
          sum: "paid",
        },
        {
          label: "Ad spend",
          record: "marketing.ad_day",
          href: "/marketing/ads?view=campaign",
          period: "month",
          sum: "spend",
        },
        {
          label: "Drafts waiting",
          record: "marketing.draft",
          href: "/marketing/drafts?view=waiting",
          needs: true,
        },
        {
          label: "Texts waiting",
          record: "marketing.text_contact",
          href: "/marketing/texts?view=waiting",
          needs: true,
        },
        {
          label: "DMs waiting",
          record: "marketing.dm",
          href: "/marketing/dms?view=waiting",
          needs: true,
        },
        {
          label: "Comments waiting",
          record: "marketing.comment",
          href: "/marketing/comments?view=waiting",
          needs: true,
        },
        {
          label: "New activity",
          record: "marketing.activity",
          href: "/marketing/inbox?view=activity",
          needs: true,
        },
      ],
      top: [
        {
          label: "Followers",
          record: "marketing.audience",
          href: "/marketing/followers",
          fields: ["followers", "week"],
          empty: "No follower count yet. SocialWatch reads one a day.",
        },
        {
          label: "Top posts",
          record: "marketing.post",
          href: "/marketing/content?view=top",
          fields: ["views", "engagement"],
          empty: "No post has numbers yet.",
        },
        {
          label: "Top keywords",
          record: "marketing.keyword",
          href: "/marketing/keywords?view=active",
          fields: ["clicks", "impressions"],
          empty: "No keyword has impressions yet.",
        },
      ],
      below: WeeklyBookings,
    },
    {
      id: "ads",
      label: "Ads",
      group: "Numbers",
      template: "list",
      record: "marketing.ad_day",
      empty: "Ad days show here once an ad runs.",
      actions: AD_ACTIONS,
      extras: postExtras,
    },
    {
      id: "site",
      label: "Site",
      group: "Numbers",
      template: "list",
      record: "marketing.site_day",
      empty: "Site days show here once the lander export is read.",
    },
    {
      id: "funnel",
      label: "Funnel",
      group: "Numbers",
      template: "list",
      record: "marketing.funnel",
      empty: "Funnels show here once the lander export is read.",
    },
    {
      id: "sessions",
      label: "Sessions",
      group: "Numbers",
      template: "list",
      record: "marketing.session",
      empty: {
        applied: "No recorded visitor applied yet.",
        recent: "Replays show here once a visitor says yes to cookies.",
      },
      extras: sessionExtras,
    },
    {
      id: "search-days",
      label: "Search days",
      group: "Numbers",
      hidden: true,
      template: "list",
      record: "marketing.search_day",
      empty: "Search days show here once Search Console is read.",
    },
    {
      id: "search",
      label: "Search",
      group: "Search",
      template: "list",
      record: "marketing.search_page",
      empty: { not_indexed: "Every checked page is indexed.", all: "No page checked yet." },
    },
    {
      id: "keywords",
      label: "Keywords",
      group: "Search",
      template: "list",
      record: "marketing.keyword",
      empty: "Keywords show here once search runs.",
    },
    {
      id: "answers",
      label: "AI answers",
      group: "Search",
      template: "list",
      record: "marketing.answer",
      empty: {
        latest: "AI answers show here once a keyword is asked.",
        cited: "No AI answer names Wren yet.",
        all: "AI answers show here once a keyword is asked.",
      },
    },
  ],
};
