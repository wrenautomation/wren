/**
 * A post's row actions: drafts (approve, reject, edit, pass), promos, swaps and sends that may have
 * gone out; ads and texts. `said` and the shared forms the other files take live here.
 */

import { TIKTOK_COPY } from "@wren/core/content/tiktok";
import { PASS_LABELS, PASS_REASONS } from "@wren/core/pass-reasons";
import { REJECT_LABELS, REJECT_NOTE_MAX, REJECT_REASONS } from "@wren/core/reject-reasons";
import { type Action, type FormField, said } from "@wren/ui";
import { draftActions } from "./ask.js";
import { ATTACH, FIELDS } from "./fields.js";
import { FUNNEL } from "./funnel.js";
import { SLIDES } from "./slides.js";

/**
 * A video's promo (designs/2026-10-07-content-funnel.md): a post per channel, an X thread or a
 * carousel, each pointing at the video. None posts.
 */
export const PROMOTE_CONFIRM =
  "Draft promos for this video? Each waits in To approve. Nothing posts.";
export const PROMOTE_DONE = said("Drafting. The promos show in To approve in a minute.");
export const PROMOTE_FORM: readonly FormField[] = [
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
export const SWAP_ACTIONS: Action[] = [
  {
    id: "marketing.swapApprove",
    label: "Change it",
    icon: "edit",
    handler: "marketing/swapApprove",
    confirm: "Change it on the live post now?",
    key: "a",
    done: said("Changed. Its window starts tomorrow."),
  },
  {
    id: "marketing.swapSkip",
    label: "Skip",
    icon: "close",
    handler: "marketing/swapSkip",
    bulk: true,
    key: "e",
    done: said("Skipped. The post stays as it is."),
  },
];

/** A send that may have gone out (designs/2026-10-16-maybe-sent.md): he checks the site. */
export const UNSURE_ACTIONS: Action[] = [
  {
    id: "marketing.sendPosted",
    label: "Mark posted",
    handler: "marketing/sendPosted",
    confirm: "Did you see it on the site? We'll record it as sent and never send it again.",
    key: "a",
    // It leaves To approve, and its open panel closes, the moment it's sent.
    optimistic: "Marked posted",
  },
  {
    id: "marketing.sendAgain",
    label: "Send again",
    icon: "retry",
    handler: "marketing/sendAgain",
    confirm:
      "Send it again? We ask the site first, but if it went out and the site can't tell, it posts twice.",
    optimistic: "Sending again",
  },
  {
    id: "marketing.sendDrop",
    label: "Not sent, drop",
    icon: "close",
    handler: "marketing/sendDrop",
    confirm: "Did it not go out? We'll close it as not sent and never send it.",
    done: said("Dropped. It was not sent."),
  },
];

export const POST_ACTIONS: Action[] = [
  {
    id: "marketing.draftAgain",
    label: "Draft again",
    icon: "edit",
    handler: "marketing/draftAgain",
    confirm: "Draft this idea again for this platform?",
    done: said("Drafting. It shows in the content desk."),
  },
  {
    id: "marketing.postPromote",
    label: "Promote",
    icon: "megaphone",
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
    icon: "edit",
    handler: "marketing/swapAsk",
    each: true,
    form: SWAP_FORM,
    when: { platform: ["youtube"] },
    done: said("Asked. It waits in To approve."),
  },
];

const WAITING = { state: ["draft", "failed"] };
export const OPEN = { state: ["draft", "failed", "approved"] };
/** A post's fields and files, saved from inside the detail (fields.tsx), never from the head. */
export const fieldActions = (when: NonNullable<Action["when"]>): Action[] => [
  { id: FIELDS, label: "Save", handler: "marketing/draftFields", inline: true, when },
  { id: ATTACH, label: "Upload", handler: "marketing/draftAttach", inline: true, when },
  { id: FUNNEL, label: "Save", handler: "marketing/draftFunnel", inline: true, when },
  { id: SLIDES, label: "Save", handler: "marketing/draftSlides", inline: true, when },
];
/** A reject's why, both optional: a quick pick and a few words. */
export const REJECT_FORM: readonly FormField[] = [
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

/**
 * Done with a person, not just a draft: this row and everything open of theirs closes, and what
 * the reads find from them later lands closed (`ReachDesk.passOn`).
 */
export const PASS_ACTION: Action = {
  id: "marketing.pass",
  label: "Pass on them",
  icon: "passOn",
  handler: "marketing/pass",
  form: [
    { field: "reason", label: "Why", type: "select", options: PASS_REASONS, labels: PASS_LABELS },
    { field: "note", label: "Note", optional: true, hint: `Up to ${REJECT_NOTE_MAX} characters` },
  ],
  each: true,
  bulk: true,
  key: "x",
  optimistic: "Passed",
  done: said("Passed. Nothing of theirs comes back."),
};

export const DRAFT_ACTIONS: Action[] = [
  {
    id: "marketing.approveDraft",
    label: "Approve",
    icon: "check",
    handler: "marketing/approveDraft",
    confirm: "Post this at its platform's next slot?",
    key: "a",
    bulk: true,
    when: WAITING,
    // TikTok's Direct Post rules: no yes before who can see it, nor with a disclosure left empty.
    blocked: {
      missing: { privacy: "Pick who can see it first.", disclosure: TIKTOK_COPY.pickOne },
    },
    // Over the words on screen: words written since refuse it.
    expect: true,
    done: said("Scheduled at its next slot"),
  },
  {
    id: "marketing.scheduleDraft",
    label: "Schedule",
    icon: "reschedule",
    handler: "marketing/scheduleDraft",
    form: [
      { field: "day", label: "Day", type: "date" },
      { field: "time", label: "Time", hint: "Your time, like 15:00. Blank: 9:00.", optional: true },
    ],
    each: true,
    when: OPEN,
    blocked: {
      missing: { privacy: "Pick who can see it first.", disclosure: TIKTOK_COPY.pickOne },
    },
    expect: true,
    done: said("Scheduled"),
  },
  {
    id: "marketing.postNow",
    label: "Post now",
    handler: "marketing/postNow",
    confirm: "Post this on the next pass, within a few minutes?",
    when: OPEN,
    blocked: {
      missing: { privacy: "Pick who can see it first.", disclosure: TIKTOK_COPY.pickOne },
    },
    expect: true,
    done: said("Posting on the next pass"),
  },
  {
    id: "marketing.redraft",
    label: "Redraft",
    icon: "chat",
    handler: "marketing/redraft",
    ask: { field: "note", label: "What to change" },
    when: OPEN,
    done: said("Redrafting. The new one shows here."),
  },
  {
    id: "marketing.rejectDraft",
    label: "Reject",
    icon: "close",
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

export const AD_ACTIONS: Action[] = [
  {
    id: "marketing.pause",
    label: "Pause",
    icon: "pause",
    handler: "marketing/pause",
    ask: { field: "reason", label: "Why?" },
    when: { state: ["active"] },
    done: said("Paused"),
  },
  {
    // It spends again: asked every time, never an undo.
    id: "marketing.resume",
    label: "Resume",
    icon: "play",
    handler: "marketing/resume",
    confirm: "Start spending on it again at its budget?",
    when: { state: ["paused", "stopped"] },
    done: said("Running again"),
  },
];

export const TEXT_ACTIONS: Action[] = [
  {
    id: "marketing.markRead",
    label: "Mark read",
    icon: "read",
    handler: "marketing/markRead",
    bulk: true,
    key: "e",
    when: { waiting: ["waiting"] },
    done: said("Marked read"),
  },
];
