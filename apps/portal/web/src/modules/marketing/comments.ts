/**
 * Comment row actions, a comment's thread view, and activity.
 */
import { type Action, said } from "@wren/ui";
import { draftActions } from "./ask.js";
import { THREAD_READ, THREAD_REPLY } from "./thread-context.js";

/**
 * A comment's whole thread (thread-context.tsx): a reply to any comment in it, and reading it
 * on the site again. Run from inside the view only.
 */
export const THREAD_VIEW_ACTIONS: Action[] = [
  {
    id: THREAD_REPLY,
    label: "Reply from Wren",
    icon: "reply",
    handler: "marketing/threadReply",
    inline: true,
  },
  { id: THREAD_READ, label: "Refresh", handler: "marketing/threadRead", inline: true },
];

export const COMMENT_ACTIONS: Action[] = [
  {
    id: "marketing.commentAnswer",
    label: "Answer",
    icon: "reply",
    handler: "marketing/commentAnswer",
    confirm: "Post this answer under their comment?",
    key: "r",
    when: { state: ["new", "waiting"] },
    done: said("Answered in the thread"),
  },
  {
    id: "marketing.commentDm",
    label: "DM them",
    icon: "dm",
    handler: "marketing/commentDm",
    ask: { field: "body", label: "Your DM" },
    key: "m",
    when: { state: ["new", "waiting", "answered"], door: ["reach", "private_reply"] },
    done: said("Sent, or queued for the reach account's next tick."),
  },
  {
    id: "marketing.commentDrop",
    label: "Skip",
    icon: "close",
    handler: "marketing/commentDrop",
    bulk: true,
    key: "e",
    when: { state: ["new", "waiting"] },
    done: said("Skipped. They can still show up again."),
  },
];
/** Comments waiting on him: the draft answer in its box. */
export const COMMENT_ASK = draftActions("comment", { state: ["new", "waiting"] });

export const ACTIVITY_ACTIONS: Action[] = [
  {
    id: "marketing.activitySeen",
    label: "Mark seen",
    icon: "read",
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
