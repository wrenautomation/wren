/**
 * The Inbox's row actions: typed ids, waiting states, the thread's assign, close and snooze.
 */
import type { Action } from "@wren/ui";
import { REPLY_ACTIONS, REPLY_WAITING } from "../wren/replies.js";
import { DRAFT_BOX } from "./ask.js";
import { ACTIVITY_ACTIONS, COMMENT_ACTIONS, THREAD_VIEW_ACTIONS } from "./comments.js";
import { DM_ACTIONS } from "./dm.js";
import { said, TEXT_ACTIONS } from "./drafts.js";

/** An Inbox id carries its type (`dm:5`); a preview reads the row's own id after the colon. */
const bare = (id: string | number) => String(id).slice(String(id).indexOf(":") + 1);

/** Each action on the rows of its own type, its preview on the row's own id. */
export const only = (type: string, a: Action, when: Action["when"] = a.when): Action => {
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
export const WAITS = { state: ["waiting"] };
/** A thread comment a subreddit's karma or age rule holds can be edited or skipped, not sent. */
const HELD = { state: ["waiting", "held"] };
export const threadWhen = (a: Action) => (a.id === "marketing.threadComment" ? WAITS : HELD);
/** A page's own draft box and its Read now stay there; the Inbox has one box of each kind. */
export const own = (a: Action) => !a.form && !DRAFT_BOX.includes(a.id);
/** What the Inbox's thread does (designs/2026-10-07-inbox-reply.md): assign, close, snooze. */
const THREAD_LIVE = { status: ["open", "waiting", "snoozed"] };
export const INBOX_THREAD_ACTIONS: Action[] = [
  {
    id: "inbox.take",
    label: "Take it",
    icon: "addPerson",
    handler: "inbox/take",
    bulk: true,
    key: "t",
    done: said("It's yours"),
  },
  {
    id: "inbox.assign",
    label: "Assign",
    icon: "addPerson",
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
    icon: "selected",
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
    icon: "undo",
    handler: "inbox/open",
    bulk: true,
    when: { status: ["closed", "waiting"] },
    sets: { status: "open" },
    done: said("Open"),
  },
  {
    id: "inbox.snooze",
    label: "Snooze",
    icon: "clock",
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
    icon: "undo",
    handler: "inbox/wake",
    bulk: true,
    when: { status: ["snoozed"] },
    done: said("Back in the Inbox"),
  },
  // The conversation's boxes: never a button or a key.
  { id: "inbox.reply", label: "Send", icon: "send", handler: "inbox/reply", inline: true },
  { id: "inbox.ask", label: "Ask to send", icon: "send", handler: "inbox/ask", inline: true },
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
export const INBOX_ACTIONS: Action[] = [
  ...INBOX_THREAD_ACTIONS,
  ...[
    ...COMMENT_ACTIONS.map((a) => only("comment", a)),
    ...THREAD_VIEW_ACTIONS.map((a) => only("comment", a)),
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
      {
        id: "mail.done",
        label: "Done",
        icon: "selected",
        handler: "mail/done",
        bulk: true,
        done: said("Done"),
      },
      WAITS,
    ),
  ]
    .filter((a) => !BOXED.includes(a.id))
    .map(unkeyed),
];
