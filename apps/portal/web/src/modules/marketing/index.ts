/**
 * Marketing (designs/2026-10-05-marketing-app.md): content, ads, search, texts and site visits
 * as one funnel, in Wren's workspace. Records and templates only; the console serves them.
 */
import type { Action } from "@wren/ui";
import type { Module } from "../../module.js";
import { askActions, withAsk } from "./ask.js";
import { WeeklyBookings } from "./chart.js";
import { copyExtras, copyPreview, dmExtras, dmPreview } from "./dms.js";
import { draftPreview, postExtras } from "./posts.js";
import { sessionExtras } from "./sessions.js";
import { textCopyExtras, textCopyPreview } from "./texts.js";

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
    id: "marketing.editDraft",
    label: "Edit",
    handler: "marketing/editDraft",
    ask: { field: "text", label: "Your words", from: "text", preview: draftPreview },
    key: "e",
    when: OPEN,
    done: said("Saved. It waits for your yes again."),
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
  ...askActions("post", OPEN),
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
    ask: { field: "body", label: "Your reply", preview: dmPreview },
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
    ask: { field: "body", label: "Your answer, posted under their comment", from: "draft" },
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
/** Comments waiting on him: Ask Claude on the draft answer. */
const COMMENT_ASK = askActions("comment", { state: ["new", "waiting"] });

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

/** The reply box's preview for an Inbox DM: its id is `dm:<contact>`. */
const inboxDmPreview = (id: string | number) => dmPreview(String(id).replace(/^dm:/, ""));

/** Each action on the rows of its own type; DM them only from a reach account's inbox. */
const only = (type: string, a: Action, when: Action["when"] = a.when): Action => ({
  ...a,
  when: { ...when, type: [type] },
});
const INBOX_ACTIONS: Action[] = [
  ...COMMENT_ACTIONS.map((a) => only("comment", a)),
  ...DM_ACTIONS.map((a) =>
    a.ask?.preview
      ? only("dm", { ...a, ask: { ...a.ask, preview: inboxDmPreview } })
      : only("dm", a, { state: ["waiting"] }),
  ),
  ...ACTIVITY_ACTIONS.map((a) => (a.form ? a : only("activity", a))),
  // TODO(content-desk-queue): dm and invite once their drafts land (packages/content/src/draft-ask.ts).
  ...askActions("inbox", { type: ["comment", "draft", "thread"], state: ["new", "waiting"] }),
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
    ask: { field: "body", label: "Your message", preview: dmPreview },
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
    ask: { field: "body", label: "Your comment, posted in the thread", from: "draft" },
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
  ...askActions("thread", { state: ["new", "ranked", "queued"] }),
  DISCOVERY_READ,
];

const TEXT_COPY_ACTIONS: Action[] = [
  {
    id: "marketing.textCopy",
    label: "Edit",
    handler: "marketing/textCopy",
    ask: { field: "body", label: "Your words", from: "body", preview: textCopyPreview },
    key: "e",
    done: said("Saved"),
  },
];

const DM_COPY_ACTIONS: Action[] = [
  {
    id: "marketing.dmCopy",
    label: "Edit",
    handler: "marketing/dmCopy",
    ask: { field: "body", label: "Your words", from: "body", preview: copyPreview },
    key: "e",
    done: said("Saved"),
  },
];

export const marketing: Module = {
  id: "marketing",
  name: "Marketing",
  component: "marketing.stats",
  icon: "board",
  blurb: "What content, ads, search and texts bring to the site, and what they cost.",
  requires: { audience: "team" },
  pages: [
    {
      id: "overview",
      label: "Overview",
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
      id: "inbox",
      label: "Inbox",
      template: "list",
      record: "marketing.inbox",
      empty: {
        comments: "Comments on our posts show here.",
        dms: "Threads show here once reach messages someone.",
        activity: "Follows, mentions and notices show here.",
        all: "Comments, DMs and activity from every platform show here.",
      },
      actions: INBOX_ACTIONS,
      extras: withAsk((detail, at) =>
        (detail as { messages?: unknown } | null)?.messages
          ? dmExtras(detail, at)
          : { sections: [] },
      ),
      count: { state: ["new", "waiting"] },
    },
    {
      id: "content",
      label: "Content",
      template: "list",
      record: "marketing.post",
      empty: "Posts show here once one is published.",
      actions: POST_ACTIONS,
      extras: postExtras,
    },
    {
      id: "drafts",
      label: "Drafts",
      template: "list",
      record: "marketing.draft",
      empty: {
        waiting: "No draft waits on you.",
        scheduled: "Nothing is scheduled.",
        rejected: "Nothing was turned down.",
      },
      actions: DRAFT_ACTIONS,
      extras: withAsk(postExtras),
    },
    {
      id: "ads",
      label: "Ads",
      template: "list",
      record: "marketing.ad_day",
      empty: "Ad days show here once an ad runs.",
      actions: AD_ACTIONS,
      extras: postExtras,
    },
    {
      id: "subscribers",
      label: "Subscribers",
      template: "list",
      record: "marketing.subscriber",
      empty: {
        confirmed: "No one has confirmed yet.",
        pending: "No signup waits on a confirm.",
        all: "Signups show here from the site, forms and texts.",
      },
    },
    {
      id: "topics",
      label: "Topics",
      template: "list",
      record: "marketing.topic",
      empty: "No topic yet.",
    },
    {
      id: "search",
      label: "Search",
      template: "list",
      record: "marketing.search_page",
      empty: { not_indexed: "Every checked page is indexed.", all: "No page checked yet." },
    },
    {
      id: "keywords",
      label: "Keywords",
      template: "list",
      record: "marketing.keyword",
      empty: "Keywords show here once search runs.",
    },
    {
      id: "answers",
      label: "AI answers",
      template: "list",
      record: "marketing.answer",
      empty: "AI answers show here once one is asked.",
    },
    {
      id: "texts",
      label: "Texts",
      template: "list",
      record: "marketing.text_contact",
      empty: { waiting: "No reply waits on you.", texted: "No one texted yet." },
      actions: TEXT_ACTIONS,
    },
    {
      id: "text-copy",
      label: "Text copy",
      template: "list",
      record: "marketing.text_copy",
      empty: { empty: "Every text has words.", all: "No sequence has texts." },
      actions: TEXT_COPY_ACTIONS,
      extras: textCopyExtras,
    },
    {
      id: "dms",
      label: "DMs",
      template: "list",
      record: "marketing.dm",
      empty: {
        waiting: "No DM waits on you.",
        replied: "No one replied yet.",
        all: "Threads show here once reach messages someone.",
      },
      actions: DM_ACTIONS,
      extras: dmExtras,
    },
    {
      id: "followers",
      label: "Followers",
      template: "list",
      record: "marketing.audience",
      empty: "No follower count yet. SocialWatch reads one a day; LinkedIn's on Read now.",
      actions: AUDIENCE_ACTIONS,
    },
    {
      id: "comments",
      label: "Comments",
      template: "list",
      record: "marketing.comment",
      empty: {
        waiting: "No comment waits on you.",
        answered: "Nothing answered yet.",
        all: "Comments on our posts and under our comments show here.",
      },
      actions: [...COMMENT_ACTIONS, ...COMMENT_ASK],
      extras: withAsk(),
    },
    {
      id: "threads",
      label: "Threads",
      template: "list",
      record: "marketing.thread",
      empty: {
        queued: "No thread to answer. Watch a place to read its new posts.",
        commented: "No comment yet.",
        all: "New posts in watched places show here.",
      },
      actions: THREAD_ACTIONS,
      extras: withAsk(),
    },
    {
      id: "invites",
      label: "Invites",
      template: "list",
      record: "marketing.invite",
      empty: {
        queued: "Nothing to send. Invites queue once an account is set in Shop → LinkedIn invites.",
        pending: "No invite waits on an answer.",
        accepted: "No one accepted yet.",
        withdrawn: "Nothing withdrawn yet.",
        all: "LinkedIn invites show here.",
      },
      actions: INVITE_ACTIONS,
    },
    {
      id: "places",
      label: "Places",
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
      id: "dm-copy",
      label: "DM copy",
      template: "list",
      record: "marketing.dm_copy",
      empty: { empty: "Every slot has words.", all: "No reach sequence has slots." },
      actions: DM_COPY_ACTIONS,
      extras: copyExtras,
    },
    {
      id: "site",
      label: "Site",
      template: "list",
      record: "marketing.site_day",
      empty: "Site days show here once the lander export is read.",
    },
    {
      id: "funnel",
      label: "Funnel",
      template: "list",
      record: "marketing.funnel",
      empty: "Funnels show here once the lander export is read.",
    },
    {
      id: "sessions",
      label: "Sessions",
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
      hidden: true,
      template: "list",
      record: "marketing.search_day",
      empty: "Search days show here once Search Console is read.",
    },
  ],
};
