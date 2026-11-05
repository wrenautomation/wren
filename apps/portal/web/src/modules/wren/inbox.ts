/**
 * What waits on the team outside the drafts: William's own mail and its rules, warm email replies,
 * @mentions, issues and access asks. One source for Today's tab and its detail pages
 * (designs/2026-11-04-portal-places.md); no sidebar place of its own.
 */
import { type Action, said } from "@wren/ui";
import type { Module } from "../../module.js";
import { inboxPages } from "../access/index.js";
import { queueLate } from "../inbox-queues.js";
import { MENTION_ACTIONS, mentionExtras } from "./mentions.js";
import { REPLY_ACTIONS, REPLY_WAITING } from "./replies.js";

// The Monitor's hands (WatchConsole); William's own mail, so admins only.
const MAIL_ACTIONS: Action[] = [
  {
    id: "watch.done",
    label: "Done",
    icon: "selected",
    handler: "watch/done",
    undo: "watch/undone",
    bulk: true,
    key: "e",
    when: { queue: ["needs_you"] },
    done: said("Done"),
  },
  {
    id: "watch.hide",
    label: "Hide like this",
    icon: "close",
    handler: "watch/hide",
    each: true,
    bulk: true,
    form: [
      {
        field: "subject",
        label: "Subject has",
        optional: true,
        hint: "Blank hides everything from this sender.",
      },
    ],
    when: { queue: ["needs_you", "done"] },
    done: said("Hidden. A rule holds mail like it from now on."),
  },
  {
    id: "watch.show",
    label: "Show like this",
    icon: "heart",
    handler: "watch/show",
    each: true,
    bulk: true,
    form: [
      {
        field: "subject",
        label: "Subject has",
        optional: true,
        hint: "Blank shows everything from this sender.",
      },
    ],
    when: { queue: ["held", "dropped"] },
    done: said("Shown. A rule shows mail like it from now on."),
  },
  {
    id: "watch.sort",
    label: "Sort again",
    icon: "retry",
    handler: "watch/sort",
    bulk: true,
    when: { queue: ["needs_you"] },
    done: said("Sorted again under today's rules."),
  },
];

const RULE_ACTIONS: Action[] = [
  {
    id: "watch.addRule",
    label: "Add rule",
    handler: "watch/addRule",
    form: [
      {
        field: "words",
        label: "Rule",
        hint: 'In plain words: "Inbox Insiders: hold invoices and receipts. Show order status changes."',
      },
      {
        field: "sender",
        label: "Sender",
        optional: true,
        hint: "An address or a domain. With a verdict, code settles it for $0.",
      },
      { field: "subject", label: "Subject has", optional: true },
      {
        field: "verdict",
        label: "Verdict",
        optional: true,
        hint: "show, hold or drop. Blank leaves it to the model.",
      },
    ],
    done: said("Rule added"),
  },
  {
    id: "watch.removeRule",
    label: "Remove",
    icon: "trash",
    handler: "watch/removeRule",
    bulk: true,
    confirm: "Remove this rule? Mail it settled keeps its verdict.",
    done: said("Removed"),
  },
];

export const inbox: Module = {
  id: "inbox",
  name: "Inbox",
  component: "email.replies",
  icon: "inbox",
  blurb: "Your mail, warm replies, mentions and asks.",
  requires: { audience: "team" },
  pages: [
    {
      id: "mail",
      label: "Mail",
      about: "Your own email that needs you, pulled from the rest.",
      template: "list",
      record: "watch.mail",
      late: queueLate("watch.mail"),
      empty: {
        needs_you: "Nothing in your inboxes needs you.",
        held: "Mail the Monitor holds shows here, searchable.",
        done: "Mail you mark done shows here.",
        all: "Mail the Monitor reads shows here.",
      },
      actions: MAIL_ACTIONS,
    },
    {
      id: "rules",
      label: "Mail rules",
      about: "Rules that hide email you don't need to see.",
      template: "list",
      record: "watch.rule",
      empty: { all: "No rules yet. Hide like this on any email writes one." },
      actions: RULE_ACTIONS,
    },
    {
      id: "replies",
      label: "Email replies",
      about: "Warm email replies, each with a drafted answer.",
      template: "queue",
      record: "email.reply",
      empty: {
        waiting: "Warm replies wait here, each with a draft answer.",
        booked: "Calls booked from a reply show here.",
        all: "Warm replies show here.",
      },
      actions: REPLY_ACTIONS,
      // Today's moves: Reply, name.
      count: REPLY_WAITING,
    },
    {
      id: "mentions",
      label: "Mentions",
      about: "Inbox notes where someone tagged you with @.",
      template: "list",
      record: "inbox.mention",
      late: queueLate("inbox.mention"),
      empty: {
        unread: "Nothing new. When someone tags you with @ in an Inbox note, it shows here.",
        all: "When someone tags you with @ in an Inbox note, it shows here.",
      },
      columns: ["words", "by", "at"],
      actions: MENTION_ACTIONS,
      extras: mentionExtras,
      count: { state: ["unread"] },
    },
    ...inboxPages(),
  ],
};
