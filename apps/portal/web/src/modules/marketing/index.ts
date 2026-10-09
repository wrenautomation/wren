/**
 * Marketing (designs/2026-10-05-marketing-app.md): content, ads, search, texts and site visits
 * as one funnel, in Wren's workspace. Records and templates only; the console serves them.
 */
import { KEYWORDS } from "@wren/channel-sms/templates";
import { TIKTOK_COPY } from "@wren/core/content/tiktok";
import { REJECT_LABELS, REJECT_NOTE_MAX, REJECT_REASONS } from "@wren/core/reject-reasons";
import type { Action, FormField } from "@wren/ui";
import type { DayPage, ListPage, Module, PageAcross } from "../../module.js";
import { REPLY_ACTIONS, REPLY_WAITING } from "../wren/replies.js";
import { withAnalytics } from "./analytics.js";
import { DRAFT_BOX, type DraftOf, draftActions, withDraft } from "./ask.js";
import { AutoReplyPage } from "./auto-reply.js";
import { NumbersBelow } from "./chart.js";
import { askedReplyExtras, conversationExtras } from "./conversation.js";
import { copyExtras, dmExtras, dmLooks } from "./dms.js";
import { EXPERIMENT_ACTIONS } from "./experiments.js";
import { FactsPage, factsDropped } from "./facts.js";
import { ATTACH, FIELDS, withShape } from "./fields.js";
import { FUNNEL } from "./funnel.js";
import { heatExtras } from "./heat.js";
import { postExtras, postLooks } from "./posts.js";
import { sessionExtras } from "./sessions.js";
import { SLIDES } from "./slides.js";
import { SURVEY_ACTIONS } from "./surveys.js";
import { textCopyExtras, textCopyPreview } from "./texts.js";
import { threadEditorOf } from "./thread.js";
import { videoExtras } from "./videos.js";

const said = (line: string) => () => line;

/**
 * A video's promo (designs/2026-10-07-content-funnel.md): a post per channel, an X thread or a
 * carousel, each pointing at the video. None posts.
 */
const PROMOTE_CONFIRM = "Draft promos for this video? Each waits in To approve. Nothing posts.";
const PROMOTE_DONE = said("Drafting. The promos show in To approve in a minute.");
const PROMOTE_FORM: readonly FormField[] = [
  {
    field: "pieces",
    label: "What to draft",
    type: "select",
    options: ["posts", "thread", "carousel", "all"],
    from: () => "posts",
    labels: {
      posts: "A post on each channel",
      thread: "An X thread",
      carousel: "A carousel for LinkedIn and Instagram",
      all: "All three",
    },
  },
];

/** A new title, thumbnail or hook for a live YouTube post: it waits in To approve. */
const SWAP_FORM: readonly FormField[] = [
  {
    field: "field",
    label: "What to change",
    type: "select",
    options: ["title", "thumbnail", "hook"],
    from: () => "title",
    labels: {
      title: "The title",
      thumbnail: "The thumbnail (a stored image)",
      hook: "The hook (the description's first line)",
    },
  },
  { field: "value", label: "New one", hint: "A title is 100 characters at most" },
  { field: "why", label: "What it tests", optional: true },
];
const SWAP_ACTIONS: Action[] = [
  {
    id: "marketing.swapApprove",
    label: "Change it",
    handler: "marketing/swapApprove",
    confirm: "Change it on the live post now?",
    key: "a",
    done: said("Changed. Its window starts tomorrow."),
  },
  {
    id: "marketing.swapSkip",
    label: "Skip",
    handler: "marketing/swapSkip",
    bulk: true,
    key: "e",
    done: said("Skipped. The post stays as it is."),
  },
];

const POST_ACTIONS: Action[] = [
  {
    id: "marketing.draftAgain",
    label: "Draft again",
    handler: "marketing/draftAgain",
    confirm: "Draft this idea again for this platform?",
    done: said("Drafting. It shows in the content desk."),
  },
  {
    id: "marketing.postPromote",
    label: "Promote",
    handler: "marketing/postPromote",
    confirm: PROMOTE_CONFIRM,
    each: true,
    form: PROMOTE_FORM,
    when: { platform: ["youtube"] },
    done: PROMOTE_DONE,
  },
  {
    id: "marketing.swapAsk",
    label: "Try a new title",
    handler: "marketing/swapAsk",
    each: true,
    form: SWAP_FORM,
    when: { platform: ["youtube"] },
    done: said("Asked. It waits in To approve."),
  },
];

const WAITING = { state: ["draft", "failed"] };
const OPEN = { state: ["draft", "failed", "approved"] };
/** A post's fields and files, saved from inside the detail (fields.tsx), never from the head. */
const fieldActions = (when: NonNullable<Action["when"]>): Action[] => [
  { id: FIELDS, label: "Save", handler: "marketing/draftFields", inline: true, when },
  { id: ATTACH, label: "Upload", handler: "marketing/draftAttach", inline: true, when },
  { id: FUNNEL, label: "Save", handler: "marketing/draftFunnel", inline: true, when },
  { id: SLIDES, label: "Save", handler: "marketing/draftSlides", inline: true, when },
];
/** A reject's why, both optional: a quick pick and a few words. */
const REJECT_FORM: readonly FormField[] = [
  {
    field: "reason",
    label: "Why",
    type: "select",
    optional: true,
    options: REJECT_REASONS,
    labels: REJECT_LABELS,
  },
  { field: "note", label: "Note", optional: true, hint: `Up to ${REJECT_NOTE_MAX} characters` },
];

const DRAFT_ACTIONS: Action[] = [
  {
    id: "marketing.approveDraft",
    label: "Approve",
    handler: "marketing/approveDraft",
    confirm: "Post this at its platform's next slot?",
    key: "a",
    bulk: true,
    when: WAITING,
    // TikTok's Direct Post rules: no yes before who can see it, nor with a disclosure left empty.
    blocked: {
      missing: { privacy: "Pick who can see it first.", disclosure: TIKTOK_COPY.pickOne },
    },
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
    // Why is optional: it teaches later drafts.
    form: REJECT_FORM,
    each: true,
    key: "r",
    bulk: true,
    when: OPEN,
    done: said("Rejected"),
  },
  ...draftActions("post", OPEN),
  ...fieldActions(OPEN),
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

/** Who sees an upload (content VIDEO_PRIVACY); blank is private. */
const PRIVACY = {
  field: "privacy",
  label: "Who sees it",
  type: "select",
  options: ["private", "unlisted", "public"],
  optional: true,
  hint: "Blank: private.",
} as const;

/** Approve is his yes: the file uploads to YouTube on the next pass, private unless he picks. */
const VIDEO_APPROVE: Action = {
  id: "marketing.videoApprove",
  label: "Approve",
  handler: "marketing/videoApprove",
  confirm: "Upload the long video to YouTube?",
  key: "a",
  form: [PRIVACY],
  when: { state: ["rendered"] },
  done: said("Approved. It uploads on the next pass."),
};
const VIDEO_ACTIONS: Action[] = [
  VIDEO_APPROVE,
  {
    id: "marketing.videoApproveShort",
    label: "Approve a Short",
    handler: "marketing/videoApproveShort",
    each: true,
    form: [
      { field: "short", label: "Short", type: "number", hint: "1 is the first Short." },
      PRIVACY,
    ],
    when: { state: ["rendered", "approved", "uploaded"] },
    done: said("Approved. The Short uploads on the next pass."),
  },
  {
    id: "marketing.videoApproveVertical",
    label: "Approve vertical",
    handler: "marketing/videoApproveVertical",
    confirm: "Upload the vertical video to YouTube, and draft its Reel for To approve?",
    form: [PRIVACY],
    when: { state: ["rendered", "approved", "uploaded"], vertical: ["yes"] },
    done: said("Approved. It uploads on the next pass; its Reel waits in To approve."),
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
    id: "marketing.videoPromote",
    label: "Promote",
    handler: "marketing/videoPromote",
    confirm: PROMOTE_CONFIRM,
    each: true,
    form: PROMOTE_FORM,
    when: { state: ["approved", "uploaded"] },
    done: PROMOTE_DONE,
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
      ["videoWords", "Fix word"],
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

/** An invite the sweep proposed: only his yes sends it, under the day's cap. */
const CONNECT_ACTIONS: Action[] = [
  {
    id: "marketing.connectApprove",
    label: "Send invite",
    handler: "marketing/connectApprove",
    confirm: "Send these invites? They go out under the day's cap.",
    bulk: true,
    key: "a",
    when: { status: ["proposed"] },
    done: said("Approved. They go out on the next ticks."),
  },
  {
    id: "marketing.connectSkip",
    label: "Skip",
    handler: "marketing/connectSkip",
    bulk: true,
    key: "e",
    when: { status: ["proposed"] },
    done: said("Skipped. They won't be proposed again."),
  },
];

/** A comment drafted on someone else's post (LinkedIn, X, Instagram): his click posts it, with a like and follow when set. */
const ONPOST_ACTIONS: Action[] = [
  {
    id: "marketing.onpostComment",
    label: "Comment",
    handler: "marketing/onpostComment",
    confirm: "Post this comment on their post?",
    key: "r",
    done: said("Commented"),
  },
  {
    id: "marketing.onpostSkip",
    label: "Skip",
    handler: "marketing/onpostSkip",
    form: REJECT_FORM,
    each: true,
    bulk: true,
    key: "e",
    done: said("Skipped"),
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
/** What the Inbox's thread does (designs/2026-10-07-inbox-reply.md): assign, close, snooze. */
const THREAD_LIVE = { status: ["open", "waiting", "snoozed"] };
const INBOX_THREAD_ACTIONS: Action[] = [
  {
    id: "inbox.take",
    label: "Take it",
    handler: "inbox/take",
    bulk: true,
    key: "t",
    done: said("It's yours"),
  },
  {
    id: "inbox.assign",
    label: "Assign",
    handler: "inbox/assign",
    form: [
      {
        field: "assignee",
        label: "Teammate's email",
        optional: true,
        hint: "Leave it empty for nobody.",
      },
    ],
    each: true,
    bulk: true,
    key: "a",
    done: said("Assigned"),
  },
  {
    id: "inbox.close",
    label: "Close",
    handler: "inbox/close",
    bulk: true,
    key: "e",
    when: THREAD_LIVE,
    sets: { status: "closed" },
    done: said("Closed. It opens again when they write."),
  },
  {
    id: "inbox.open",
    label: "Open again",
    handler: "inbox/open",
    bulk: true,
    when: { status: ["closed", "waiting"] },
    sets: { status: "open" },
    done: said("Open"),
  },
  {
    id: "inbox.snooze",
    label: "Snooze",
    handler: "inbox/snooze",
    form: [
      {
        field: "until",
        label: "Until",
        type: "select",
        options: ["1h", "4h", "tomorrow", "monday"],
        labels: {
          "1h": "In an hour",
          "4h": "In 4 hours",
          tomorrow: "Tomorrow at 9:00",
          monday: "Monday at 9:00",
        },
      },
    ],
    each: true,
    bulk: true,
    key: "z",
    when: { status: ["open", "waiting"] },
    done: said("Snoozed. It comes back then, or when they write."),
  },
  {
    id: "inbox.wake",
    label: "Wake",
    handler: "inbox/wake",
    bulk: true,
    when: { status: ["snoozed"] },
    done: said("Back in the Inbox"),
  },
  // The conversation's boxes: never a button or a key.
  { id: "inbox.reply", label: "Send", handler: "inbox/reply", inline: true },
  { id: "inbox.ask", label: "Ask to send", handler: "inbox/ask", inline: true },
  { id: "inbox.suggest", label: "Suggest", handler: "inbox/suggest", inline: true },
  { id: "inbox.note", label: "Add note", handler: "inbox/note", inline: true },
];
/** The box sends now: a page's own send is left out, and R and E are the thread's. */
const BOXED = ["marketing.dmReply", "marketing.commentAnswer", "email.approve"];
const unkeyed = (a: Action): Action => {
  if (a.key !== "r" && a.key !== "e") return a;
  const { key: _, ...rest } = a;
  return rest;
};
const INBOX_ACTIONS: Action[] = [
  ...INBOX_THREAD_ACTIONS,
  ...[
    ...COMMENT_ACTIONS.map((a) => only("comment", a)),
    ...DM_ACTIONS.filter(own).map((a) => only("dm", a, WAITS)),
    // SMS copy is William's: Mark read only.
    ...TEXT_ACTIONS.map((a) => only("text", a, WAITS)),
    // A reply's call invite, as its replies page answers it; a reply with none has no actions.
    ...REPLY_ACTIONS.map((a) => only("email", a, { answer: REPLY_WAITING.state })),
    ...ACTIVITY_ACTIONS.map((a) => (a.form ? a : only("activity", a))),
    // Mail to the client's own mailboxes (designs/2026-10-07-mail-access.md): answered in Gmail or
    // Outlook, then Done here.
    only(
      "mail",
      { id: "mail.done", label: "Done", handler: "mail/done", bulk: true, done: said("Done") },
      WAITS,
    ),
  ]
    .filter((a) => !BOXED.includes(a.id))
    .map(unkeyed),
];
/** A template version asked to go live (`templates/publish`): only a person's yes makes it live. */
const TEMPLATE_ACTIONS: Action[] = [
  {
    id: "templates.approve",
    label: "Approve",
    handler: "templates/approve",
    confirm: "Make this version live? The next message composed uses it.",
    key: "a",
    done: said("Live. The next message composed uses it."),
  },
  {
    id: "templates.decline",
    label: "Decline",
    handler: "templates/decline",
    key: "x",
    done: said("Declined. The version stays in its history."),
  },
];
/** A client's workflow from a template: a yes makes it live (designs/2026-10-07-template-install.md). */
const WORKFLOW_ACTIONS: Action[] = [
  {
    id: "workflows.approve",
    label: "Approve",
    handler: "console/templateApprove",
    confirm: "Make it live? Its door opens and its parts start.",
    key: "a",
    done: said("Live. Its door is open and its parts are on."),
  },
  {
    id: "workflows.decline",
    label: "Decline",
    handler: "console/templateDecline",
    key: "x",
    done: said("Declined. It stays installed as a draft."),
  },
];
/** A page's copy asked to go live (Sites): a yes puts that version at its URL. */
const PAGE_ACTIONS: Action[] = [
  {
    id: "sites.approve",
    label: "Approve",
    handler: "sites/approve",
    confirm: "Make this version live? Its URL shows it within a minute.",
    key: "a",
    done: said("Live. Its URL shows it within a minute."),
  },
  {
    id: "sites.decline",
    label: "Decline",
    handler: "sites/decline",
    key: "x",
    done: said("Declined. The version stays in its history."),
  },
];
/** A stopped split's page asked to come down (Sites): a yes takes it off its URL. */
const RETIRE_ACTIONS: Action[] = [
  {
    id: "sites.retireApprove",
    label: "Approve",
    handler: "sites/approve",
    confirm: "Take this page down? Its URL answers gone. Its numbers stay.",
    key: "a",
    done: said("Retired. Its URL answers gone within a minute."),
  },
  {
    id: "sites.retireDecline",
    label: "Decline",
    handler: "sites/decline",
    key: "x",
    done: said("Declined. The page stays up."),
  },
];
/** A reply typed in the Inbox that waits on a yes: Approve sends it on its channel. */
const ASKED_REPLY_ACTIONS: Action[] = [
  {
    id: "inbox.replyApprove",
    label: "Approve",
    handler: "inbox/replyApprove",
    confirm: "Send this reply on its channel now?",
    key: "a",
    done: said("Sent"),
  },
  {
    id: "inbox.replyDrop",
    label: "Drop",
    handler: "inbox/replyDrop",
    key: "x",
    done: said("Dropped. Nothing was sent."),
  },
];
/** To approve: what we'd send, each with its own page's yes and edit. */
const APPROVAL_ACTIONS: Action[] = [
  // A post's words are the row's body here.
  ...DRAFT_ACTIONS.filter(own).map((a) =>
    only("draft", a.ask?.from ? { ...a, ask: { ...a.ask, from: "body" } } : a, WAITS),
  ),
  // The long video's yes; Shorts and thumbnails are picked on its Videos page.
  only("video", VIDEO_APPROVE, WAITS),
  ...TEMPLATE_ACTIONS.map((a) => only("template", a, WAITS)),
  ...WORKFLOW_ACTIONS.map((a) => only("workflow", a, WAITS)),
  ...PAGE_ACTIONS.map((a) => only("page", a, WAITS)),
  ...RETIRE_ACTIONS.map((a) => only("retire", a, WAITS)),
  ...THREAD_ACTIONS.filter(own).map((a) => only("thread", a, WAITS)),
  ...INVITE_ACTIONS.filter((a) => own(a) && a.id !== "marketing.inviteWithdraw").map((a) =>
    only("invite", a, a.id === "marketing.inviteMessage" ? { state: ["waiting", "read"] } : WAITS),
  ),
  ...CONNECT_ACTIONS.map((a) => only("connect", a, WAITS)),
  ...ONPOST_ACTIONS.map((a) => only("onpost", a, WAITS)),
  ...ASKED_REPLY_ACTIONS.map((a) => only("reply", a, WAITS)),
  ...SWAP_ACTIONS.map((a) => only("swap", a, WAITS)),
  ...fieldActions({ type: ["draft"], state: ["new", "waiting", "read"] }),
  // The typed-id box, as the Inbox's: `draft:3` is a post, `invite:7` an invite.
  ...draftActions("inbox", {
    type: ["draft", "thread", "invite", "onpost"],
    state: ["new", "waiting", "read"],
  }),
];

/** Each page's draft box: its field, its words' label and what sends it. */
const POST_DRAFT: DraftOf = {
  field: "text",
  label: "The post",
  send: "marketing.approveDraft",
  preview: postLooks,
  editor: threadEditorOf,
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
const NOTE_DRAFT: DraftOf = {
  field: "draft",
  label: "Your invite note, 200 characters at most",
  send: "marketing.connectApprove",
};
const ONPOST_DRAFT: DraftOf = {
  field: "draft",
  label: "Your comment, posted under their post",
  send: "marketing.onpostComment",
};
/** To approve's row type picks its box; a post's words are the row's body there. */
const APPROVAL_DRAFT: Record<string, DraftOf> = {
  draft: { ...POST_DRAFT, field: "body" },
  invite: INVITE_DRAFT,
  thread: THREAD_DRAFT,
  onpost: ONPOST_DRAFT,
  connect: NOTE_DRAFT,
};

/**
 * What other people sent us (`marketing.inbox`): Marketing → Inbox and the Inbox app's "Waiting
 * on you" are this page, each under its own id.
 */
export const INBOX_PAGE: Omit<ListPage, "id"> = {
  label: "Inbox",
  template: "list",
  record: "marketing.inbox",
  // Their words preview under who; Kind, Where and Open sit on the thread itself.
  columns: ["who", "platform", "type", "state", "postTitle", "assignee", "at"],
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
  // The whole conversation with its reply and note boxes; activity has none.
  extras: conversationExtras,
  count: { status: ["open"] },
};

/** What we'd send, waiting on William's yes (`marketing.approval`): Marketing → To approve. */
const APPROVAL_PAGE: ListPage = {
  id: "approve",
  label: "To approve",
  template: "list",
  record: "marketing.approval",
  // Kind says what Type does, in more words.
  columns: ["who", "platform", "kind", "state", "at", "due"],
  empty: {
    waiting: "Nothing waits on your yes.",
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
        ? askedReplyExtras(detail)
        : (detail as { messages?: unknown } | null)?.messages
          ? dmExtras(detail, at)
          : { sections: [] },
    ),
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

/** Content's platform switch: what waits on him on each platform, kept from page to page. */
const BY_PLATFORM: PageAcross = {
  field: "platform",
  label: "Platform",
  waits: [
    { record: "marketing.draft", view: "waiting" },
    { record: "marketing.comment", view: "waiting" },
    { record: "marketing.dm", view: "waiting" },
    { record: "marketing.video", view: "waiting" },
  ],
};

/**
 * Content's day, by platform: what posts and posted, and what waits on him. Waiting work dated
 * before today (a draft by when it was drafted, a comment or DM by when it came, a video by its
 * last change) sits on today until it's done.
 */
const TODAY: DayPage = {
  id: "today",
  label: "Today",
  group: "Content",
  template: "day",
  by: "platform",
  across: BY_PLATFORM,
  sources: [
    {
      record: "marketing.draft",
      label: "Scheduled",
      view: "scheduled",
      at: "scheduled",
      open: "/marketing/drafts",
    },
    {
      record: "marketing.post",
      label: "Posted",
      view: "all",
      at: "published",
      open: "/marketing/content",
    },
    {
      record: "marketing.draft",
      label: "Drafts waiting",
      view: "waiting",
      at: "created",
      carry: true,
      action: "marketing.approveDraft",
      open: "/marketing/drafts",
    },
    {
      record: "marketing.comment",
      label: "Comments to answer",
      view: "waiting",
      at: "at",
      carry: true,
      action: "marketing.commentAnswer",
      open: "/marketing/comments",
    },
    {
      record: "marketing.dm",
      label: "DMs to answer",
      view: "waiting",
      at: "lastAt",
      carry: true,
      action: "marketing.dmReply",
      open: "/marketing/dms",
    },
    {
      record: "marketing.video",
      label: "Videos to approve",
      view: "waiting",
      at: "updated",
      carry: true,
      action: "marketing.videoApprove",
      open: "/marketing/videos",
    },
  ],
  actions: [...DRAFT_ACTIONS, ...COMMENT_ACTIONS, ...DM_ACTIONS, VIDEO_APPROVE],
};

/** Comment and DM rates, last 30 days: on Marketing's and the Inbox's Overviews. */
export const CONVERSATION_TOP = {
  label: "Conversation, last 30 days",
  record: "marketing.conversation",
  href: "/marketing/conversation?view=30d",
  fields: ["answered", "replySecs", "dmed", "booked"],
  units: { answered: "answered", replySecs: "to reply", dmed: "to DM", booked: "booked" },
  empty: "No comments from others or DMs in 30 days.",
};

/** Reviews of the business with their stars; a reply is drafted as each lands. */
const REVIEWS_PAGE: ListPage = {
  id: "reviews",
  label: "Reviews",
  group: "People",
  template: "list",
  record: "marketing.review",
  columns: ["who", "stars", "words", "reply", "platform", "at"],
  empty: {
    waiting: "Every review has a reply.",
    low: "No review under 4 stars.",
    all: "Reviews show here once a Business Profile is connected.",
  },
};

export const marketing: Module = {
  id: "marketing",
  name: "Marketing",
  component: "marketing.stats",
  icon: "board",
  blurb: "Every platform in one place: what came in, what to approve, people and the numbers.",
  requires: { audience: "team" },
  pages: [
    { id: "inbox", ...INBOX_PAGE },
    { id: "auto-reply", label: "Auto-reply", Page: AutoReplyPage },
    REVIEWS_PAGE,
    APPROVAL_PAGE,
    TODAY,
    {
      id: "drafts",
      label: "Drafts",
      group: "Content",
      across: BY_PLATFORM,
      template: "list",
      record: "marketing.draft",
      empty: {
        waiting: "No draft waits on you.",
        scheduled: "Nothing is scheduled.",
        rejected: "Nothing was turned down.",
      },
      actions: DRAFT_ACTIONS,
      extras: withDraft(POST_DRAFT, withShape()),
    },
    {
      id: "content",
      label: "Posts",
      group: "Content",
      across: BY_PLATFORM,
      template: "list",
      record: "marketing.post",
      // The rest of its numbers sit on the post, under How it did.
      columns: [
        "title",
        "platform",
        "published",
        "format",
        "stage",
        "views",
        "engagement",
        "clicks",
      ],
      empty: {
        leaderboard: "Posts with views show here, best first.",
        site: "Posts whose link brought a visitor show here.",
        all: "Posts show here once one is published.",
      },
      actions: POST_ACTIONS,
      extras: withAnalytics(withShape(postExtras)),
    },
    {
      id: "comments",
      label: "Comments",
      group: "Content",
      across: BY_PLATFORM,
      template: "list",
      record: "marketing.comment",
      // Their words preview under who; Where, On and Open sit on the comment itself.
      columns: ["who", "platform", "kind", "postTitle", "sort", "state", "at"],
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
      across: BY_PLATFORM,
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
    // What every draft may claim; the guard's drop reason on a draft links here.
    { id: "facts", label: "Facts", group: "Content", Page: FactsPage },
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
        proposed: "No invite waits on you. The sweep proposes the day's every 6 hours.",
        queued: "Nothing to send. Invites queue once you approve them.",
        pending: "No invite waits on an answer.",
        accepted: "Accepted invites show here, ready for a first message.",
        withdrawn: "Withdrawn and ended invites show here.",
        all: "LinkedIn invites show here.",
      },
      actions: [
        ...CONNECT_ACTIONS,
        ...INVITE_ACTIONS,
        ...draftActions("invite", { status: ["accepted"] }),
      ],
      // Only an accepted invite takes a message.
      extras: withDraft((row) => (row.status === "accepted" ? INVITE_DRAFT : null)),
    },
    {
      id: "followers",
      label: "Followers",
      group: "People",
      template: "list",
      record: "marketing.audience",
      empty: "No follower count yet. Counts are read once a day; LinkedIn's on Read now.",
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
      extras: withDraft(THREAD_DRAFT, factsDropped("dropped", "Dropped because")),
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
          label: "Site visitors from posts",
          record: "marketing.link_day",
          href: "/marketing/links?view=posts",
          period: "month",
          sum: "clicks",
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
          label: "To approve",
          record: "marketing.approval",
          href: "/marketing/approve?view=waiting",
          needs: true,
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
          empty: "No follower count yet. Counts are read once a day.",
        },
        {
          label: "This week against goals",
          record: "marketing.cadence",
          href: "/marketing/cadence?view=week",
          fields: ["done", "goal"],
          empty: "No goals set.",
        },
        {
          label: "What worked last week",
          record: "marketing.digest",
          href: "/marketing/digest?view=worked",
          fields: ["kind"],
          empty: "The first digest lands on Monday.",
        },
        {
          label: "Top posts",
          record: "marketing.post",
          href: "/marketing/content?view=leaderboard",
          fields: ["views", "engagement", "format"],
          empty: "No post has numbers yet.",
        },
        {
          label: "Posts that brought visitors",
          record: "marketing.post",
          href: "/marketing/content?view=site",
          fields: ["clicks", "toSite"],
          units: { toSite: "of views" },
          empty: "No post's link has brought a visitor yet.",
        },
        CONVERSATION_TOP,
        {
          label: "Numbers not read yet",
          record: "marketing.metric",
          href: "/marketing/metrics?view=scope",
          fields: ["state"],
          line: "step",
          empty: "Every number that needs a step is read.",
        },
        {
          label: "Top keywords",
          record: "marketing.keyword",
          href: "/marketing/keywords?view=active",
          fields: ["clicks", "impressions"],
          empty: "No keyword has impressions yet.",
        },
      ],
      below: NumbersBelow,
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
      empty: "Site visits show here a day after they happen.",
    },
    {
      id: "funnel",
      label: "Funnel",
      group: "Numbers",
      template: "list",
      record: "marketing.funnel",
      empty: "Funnels show here a day after the site's first visit.",
    },
    {
      id: "links",
      label: "Links",
      group: "Numbers",
      hidden: true,
      template: "list",
      record: "marketing.link_day",
      empty: {
        month: "Clicks show here a day after they happen.",
        posts: "Visitors from a post's link show here.",
        all: "Clicks show here a day after they happen.",
      },
    },
    {
      id: "conversation",
      label: "Conversation",
      group: "Numbers",
      hidden: true,
      template: "list",
      record: "marketing.conversation",
      empty: "Comments from others and DMs we sent show here.",
    },
    {
      id: "cadence",
      label: "Cadence",
      group: "Numbers",
      hidden: true,
      template: "list",
      record: "marketing.cadence",
      empty: "No goals set.",
    },
    {
      id: "digest",
      label: "What worked",
      group: "Numbers",
      hidden: true,
      template: "list",
      record: "marketing.digest",
      empty: "The first digest lands on Monday.",
    },
    {
      id: "metrics",
      label: "Every number",
      group: "Numbers",
      hidden: true,
      template: "list",
      record: "marketing.metric",
      empty: { gaps: "Every number is read.", scope: "No number waits on a step." },
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
      id: "heatmaps",
      label: "Heatmaps",
      group: "Numbers",
      template: "list",
      record: "marketing.heat",
      empty: "Heatmaps show here a day after visitors click on the site.",
      extras: heatExtras,
    },
    {
      id: "experiments",
      label: "Experiments",
      group: "Numbers",
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
      group: "Numbers",
      template: "list",
      record: "marketing.survey",
      empty: {
        all: "No surveys yet. New survey asks site visitors or client logins one question.",
        live: "Nothing live.",
      },
      actions: SURVEY_ACTIONS,
    },
    {
      id: "survey-answers",
      label: "Survey answers",
      group: "Numbers",
      template: "list",
      record: "marketing.survey_answer",
      empty: "Site answers show here once a live survey is answered.",
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

const VERDICTS = new Set(["marketing.approveDraft", "marketing.redraft", "marketing.rejectDraft"]);
/** One of Wren's Marketing pages, as a client's: its records from its own database, read only. */
const asClient = (id: string, more: Partial<ListPage> = {}): ListPage => {
  const page = marketing.pages.find((p) => p.id === id) as ListPage;
  const { actions: _a, extras: _e, ...rest } = page;
  return { ...rest, ...more };
};

/**
 * A client's own Inbox action: the same as Wren's, on `MarketingConsole`'s `inbox*` routes, which
 * run InboxDesk on the client's database (`inbox/take` -> `marketing/inboxTake`). Each needs
 * `act`; a send also needs `effect` and the approver, which the desk checks.
 */
const clientInbox = (a: Action): Action => {
  const verb = a.handler.slice(a.handler.indexOf("/") + 1);
  return {
    ...a,
    handler: `marketing/inbox${verb.charAt(0).toUpperCase()}${verb.slice(1)}`,
    requires: { ...a.requires, needs: "act" },
  };
};

/** A client's To approve: Inbox replies waiting on a yes, from whoever its approver setting names. */
const CLIENT_APPROVE: ListPage = {
  id: "approve",
  label: "To approve",
  template: "list",
  record: "marketing.asked_reply",
  columns: ["who", "kind", "why", "account", "at"],
  empty: {
    waiting: "No Inbox reply waits on a yes.",
    all: "Replies asked from the Inbox show here.",
  },
  actions: ASKED_REPLY_ACTIONS.map(clientInbox),
  extras: askedReplyExtras,
};

/**
 * A client's Marketing, once `marketing.stats` is installed: its Inbox, the replies there that
 * wait on a yes, its drafts, posts, ads and search (`MarketingConsole`, its own database). Drafts take its approver's verdict, a YouTube post its
 * approver's Promote (drafts on its own logins); the rest read only.
 * Same address as Wren's; the workspace picks which.
 */
export const clientMarketing: Module = {
  id: marketing.id,
  name: marketing.name,
  component: "marketing.stats",
  icon: marketing.icon,
  blurb: "Your posts, drafts, ads and search in one place.",
  pages: [
    // Its own threads: reply, Suggest, notes, assign, close and snooze.
    asClient("inbox", {
      actions: INBOX_THREAD_ACTIONS.map(clientInbox),
      extras: conversationExtras,
    }),
    { id: "auto-reply", label: "Auto-reply", Page: AutoReplyPage },
    REVIEWS_PAGE,
    CLIENT_APPROVE,
    asClient("drafts", { actions: DRAFT_ACTIONS.filter((a) => VERDICTS.has(a.id)) }),
    asClient("content", { actions: POST_ACTIONS.filter((a) => a.id === "marketing.postPromote") }),
    asClient("ads", { empty: "In development: ads show here once your ad account is connected." }),
    asClient("search"),
    asClient("keywords"),
  ],
};
