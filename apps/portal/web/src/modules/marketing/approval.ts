/**
 * To approve: templates, workflows, pages and retires asked to go live, replies waiting on a yes, the
 * combined action list, and each page's draft box.
 */
import type { Action } from "@wren/ui";
import { DOC_ACTIONS } from "../documents/documents.js";
import { PAY_ACTIONS } from "../payments/index.js";
import { BROADCAST_DECIDE_ACTIONS } from "../people/broadcasts.js";
import { CREDIT_ACTIONS } from "../wren/credits.js";
import { type DraftOf, draftActions } from "./ask.js";
import { dmLooks } from "./dms.js";
import { DRAFT_ACTIONS, fieldActions, SWAP_ACTIONS, said, UNSURE_ACTIONS } from "./drafts.js";
import { only, own, threadWhen, WAITS } from "./inbox.js";
import { postLooks } from "./posts.js";
import { CONNECT_ACTIONS, INVITE_ACTIONS } from "./social.js";
import { threadEditorOf } from "./thread.js";
import { ONPOST_ACTIONS, THREAD_ACTIONS } from "./threads.js";
import { VIDEO_APPROVE } from "./video.js";

/** A template version asked to go live (`templates/publish`): only a person's yes makes it live. */
const TEMPLATE_ACTIONS: Action[] = [
  {
    id: "templates.approve",
    label: "Approve",
    icon: "check",
    handler: "templates/approve",
    confirm: "Make this version live? The next message composed uses it.",
    key: "a",
    done: said("Live. The next message composed uses it."),
  },
  {
    id: "templates.decline",
    label: "Decline",
    icon: "close",
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
    icon: "check",
    handler: "console/templateApprove",
    confirm: "Make it live? Its door opens and its parts start.",
    key: "a",
    done: said("Live. Its door is open and its parts are on."),
  },
  {
    id: "workflows.decline",
    label: "Decline",
    icon: "close",
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
    icon: "check",
    handler: "sites/approve",
    confirm: "Make this version live? Its URL shows it within a minute.",
    key: "a",
    done: said("Live. Its URL shows it within a minute."),
  },
  {
    id: "sites.decline",
    label: "Decline",
    icon: "close",
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
    icon: "check",
    handler: "sites/approve",
    confirm: "Take this page down? Its URL answers gone. Its numbers stay.",
    key: "a",
    done: said("Retired. Its URL answers gone within a minute."),
  },
  {
    id: "sites.retireDecline",
    label: "Decline",
    icon: "close",
    handler: "sites/decline",
    key: "x",
    done: said("Declined. The page stays up."),
  },
];
/**
 * A reply typed in the Inbox that waits on a yes: Approve sends it on its channel. One the cap
 * holds after the yes is queued: no second Approve, and Drop cancels it.
 */
export const ASKED_REPLY_ACTIONS: Action[] = [
  {
    id: "inbox.replyApprove",
    label: "Approve",
    icon: "check",
    handler: "inbox/replyApprove",
    confirm: "Send this reply on its channel now?",
    key: "a",
    when: WAITS,
    // An email the frequency cap holds is queued and sends itself (`InboxDesk.approve`).
    done: (answer) =>
      (answer as { queued?: string } | null)?.queued
        ? "Queued. It sends itself once the cap has room."
        : "Sent",
    // Armed when asked (designs/2026-10-12-push-everywhere.md): it goes out in seconds.
    optimistic: "Sending",
  },
  {
    id: "inbox.replyDrop",
    label: "Skip",
    icon: "close",
    handler: "inbox/replyDrop",
    key: "x",
    when: { state: ["waiting", "queued"] },
    done: said("Skipped. Nothing was sent."),
  },
];
/** To approve: what we'd send, each with its own page's yes and edit. */
export const APPROVAL_ACTIONS: Action[] = [
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
  ...THREAD_ACTIONS.filter(own).map((a) => only("thread", a, threadWhen(a))),
  ...INVITE_ACTIONS.filter((a) => own(a) && a.id !== "marketing.inviteWithdraw").map((a) =>
    only("invite", a, a.id === "marketing.inviteMessage" ? { state: ["waiting", "read"] } : WAITS),
  ),
  ...CONNECT_ACTIONS.map((a) => only("connect", a, WAITS)),
  ...ONPOST_ACTIONS.map((a) => only("onpost", a, WAITS)),
  ...ASKED_REPLY_ACTIONS.map((a) => only("reply", a)),
  ...SWAP_ACTIONS.map((a) => only("swap", a, WAITS)),
  ...UNSURE_ACTIONS.map((a) => only("unsure", a, WAITS)),
  // Payments: a pay link or a document someone without the yes asked to send.
  ...PAY_ACTIONS.map((a) => only("pay", a, WAITS)),
  // A bank transfer that waits: put it on its likely invoice, or another, or set it aside.
  ...CREDIT_ACTIONS.map((a) => only("credit", a, WAITS)),
  // A broadcast to a segment: People's own yes and no.
  ...BROADCAST_DECIDE_ACTIONS.map((a) => only("broadcast", a, WAITS)),
  ...DOC_ACTIONS.filter((a) => a.id === "documents.approve" || a.id === "documents.decline").map(
    (a) => only("doc", a, WAITS),
  ),
  ...fieldActions({ type: ["draft"], state: ["new", "waiting", "read"] }),
  // The typed-id box, as the Inbox's: `draft:3` is a post, `invite:7` an invite.
  ...draftActions("inbox", {
    type: ["draft", "thread", "invite", "onpost"],
    state: ["new", "waiting", "read"],
  }),
];

/** Each page's draft box: its field, its words' label and what sends it. */
export const POST_DRAFT: DraftOf = {
  field: "text",
  label: "The post",
  send: "marketing.approveDraft",
  preview: postLooks,
  editor: threadEditorOf,
};
export const COMMENT_DRAFT: DraftOf = {
  field: "draft",
  label: "Your answer, posted under their comment",
  send: "marketing.commentAnswer",
};
export const DM_DRAFT: DraftOf = {
  field: "draft",
  label: "Your reply",
  send: "marketing.dmReply",
  preview: dmLooks,
};
export const INVITE_DRAFT: DraftOf = {
  field: "draft",
  label: "Your message",
  send: "marketing.inviteMessage",
  preview: dmLooks,
};
export const THREAD_DRAFT: DraftOf = {
  field: "draft",
  label: "Your comment, posted in the thread",
  send: "marketing.threadComment",
};
const NOTE_DRAFT: DraftOf = {
  field: "draft",
  label: "Your invite note, 200 characters at most",
  send: "marketing.connectApprove",
};
export const ONPOST_DRAFT: DraftOf = {
  field: "draft",
  label: "Your comment, posted under their post",
  send: "marketing.onpostComment",
};
/** To approve's row type picks its box; a post's words are the row's body there. */
export const APPROVAL_DRAFT: Record<string, DraftOf> = {
  draft: { ...POST_DRAFT, field: "body" },
  invite: INVITE_DRAFT,
  thread: THREAD_DRAFT,
  onpost: ONPOST_DRAFT,
  connect: NOTE_DRAFT,
};
