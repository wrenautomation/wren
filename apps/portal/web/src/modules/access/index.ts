/**
 * Access's pages and actions (designs/2026-10-06-scoped-access.md, "Pages"): roles, grants,
 * issues and asks, the same for Wren's team (Team and Inbox) and a client's people (Account).
 * The console serves the four types for either; each action names its console handler, and
 * `ONE` in ../../records.tsx turns a row's id into its call.
 */
import { ACCESS_CHANNELS, APPS, CHANNEL_NAMES, type Permission } from "@wren/core/access";
import { type Action, type FormField, said } from "@wren/ui";
import type { ListPage } from "../../module.js";
import { queueLate } from "../inbox-queues.js";

/** Each is checked again on the row by the console: who manages, who can act, who can grant. */
const MANAGE = { needs: "manage", at: {} } as const;
const ANYONE = { needs: "read", at: {} } as const;

/** What each side may hand out: money and sends stay with Wren's admins; `team` is Wren's only. */
const VERBS = {
  wren: ["read", "comment", "act", "run", "manage", "team"],
  client: ["read", "comment", "act", "money", "manage"],
} as const satisfies Record<string, readonly Permission[]>;
const VERB_LABELS: Readonly<Record<string, string>> = {
  read: "See",
  comment: "Comment",
  act: "Act",
  run: "Run",
  manage: "Manage access",
  team: "Manage the team",
  money: "Money",
};
/** A semi-admin: people and access, never money or sends. */
const MANAGER = { wren: "read,comment,act,run,manage,team", client: "read,comment,act,manage" };

const grantForm = (wren: boolean): FormField[] => [
  {
    field: "verbs",
    label: "They can",
    type: "pick",
    options: VERBS[wren ? "wren" : "client"],
    labels: VERB_LABELS,
    hint: "Only what you hold yourself.",
  },
  {
    field: "apps",
    label: "In apps",
    type: "pick",
    optional: true,
    options: Object.keys(APPS),
    labels: APPS,
    hint: "None picked is every app.",
  },
  {
    field: "channels",
    label: "On channels",
    type: "pick",
    optional: true,
    options: ACCESS_CHANNELS,
    labels: CHANNEL_NAMES,
    hint: "None picked is every channel.",
  },
];

/** The role actions; giving a role is the team's seat at Wren, a membership at a client. */
function roleActions(wren: boolean): Action[] {
  return [
    {
      id: "access.roleNew",
      label: "New role",
      handler: "console/roleSave",
      requires: MANAGE,
      form: [
        { field: "name", label: "Name" },
        ...grantForm(wren),
        { field: "about", label: "About", optional: true, type: "long" },
      ],
      done: said("Role made"),
    },
    {
      // A manager to pass access on to: people and access, no money or sends.
      id: "access.roleManager",
      label: "New manager role",
      handler: "console/roleSave",
      requires: MANAGE,
      form: [
        { field: "name", label: "Name", from: () => "Manager" },
        ...grantForm(wren).map((f) =>
          f.field === "verbs" ? { ...f, from: () => MANAGER[wren ? "wren" : "client"] } : f,
        ),
        {
          field: "about",
          label: "About",
          optional: true,
          type: "long",
          from: () =>
            wren
              ? "Runs the team and access. No money or sends."
              : "Runs people and access. No money.",
        },
      ],
      done: said("Manager role made"),
    },
    {
      id: "access.roleCopy",
      label: "Copy",
      handler: "console/roleCopy",
      requires: MANAGE,
      each: true,
      form: [
        { field: "name", label: "Name", optional: true, hint: 'Blank names it "<role> copy".' },
      ],
      done: said("Copied"),
    },
    {
      id: "access.roleGrant",
      label: "Add a grant",
      handler: "console/roleGrant",
      requires: MANAGE,
      each: true,
      when: { kind: ["custom"] },
      form: grantForm(wren),
      done: said("Added"),
    },
    {
      id: "access.roleGive",
      label: "Give to",
      handler: wren ? "console/roleGive" : "delivery/roleGive",
      requires: MANAGE,
      each: true,
      form: [
        {
          field: "email",
          label: "Their email",
          hint: wren
            ? "Their team seat takes this role."
            : "They join with this role, or move to it.",
        },
      ],
      done: said("Given"),
    },
    {
      id: "access.roleRemove",
      label: "Remove",
      icon: "trash",
      handler: "console/roleRemove",
      requires: MANAGE,
      when: { kind: ["custom"] },
      confirm: "Remove this role? Move its people off it first.",
      done: said("Removed"),
    },
  ];
}

const grantActions = (wren: boolean): Action[] => [
  {
    id: "access.grantAdd",
    label: "Add grant",
    handler: "console/grantAdd",
    requires: MANAGE,
    form: [
      { field: "email", label: "Their email" },
      ...grantForm(wren),
      {
        field: "record",
        label: "One record",
        optional: true,
        hint: "Such as marketing.post:12. Blank is every record.",
      },
      { field: "until", label: "Ends", type: "date", optional: true },
      { field: "uses", label: "Uses", type: "number", optional: true, hint: "Blank is any." },
      { field: "reason", label: "Why", optional: true },
    ],
    done: said("Grant added"),
  },
  {
    id: "access.grantEnd",
    label: "End now",
    handler: "console/grantEnd",
    requires: MANAGE,
    when: { state: ["live"] },
    confirm: "End this grant now?",
    done: said("Ended"),
  },
];

const ISSUE_ACTIONS: Action[] = [
  {
    id: "access.issueResolve",
    label: "Resolve",
    icon: "selected",
    handler: "console/issueResolve",
    requires: ANYONE,
    when: { state: ["open"], yours: ["yes"] },
    key: "r",
    bulk: true,
    done: said("Resolved"),
  },
];

export const ASK_ACTIONS: Action[] = [
  {
    id: "access.askApprove",
    label: "Approve",
    icon: "check",
    handler: "console/askApprove",
    requires: ANYONE,
    when: { state: ["open"], yours: ["yes"] },
    key: "a",
    done: said("Approved"),
  },
  {
    id: "access.askDecline",
    label: "Decline",
    icon: "close",
    handler: "console/askDecline",
    requires: ANYONE,
    when: { state: ["open"], yours: ["yes"] },
    done: said("Declined"),
  },
];

/** Roles, Grants and Access review: for whoever manages the workspace. */
export function managePages(wren: boolean): ListPage[] {
  return [
    {
      id: "roles",
      label: "Roles",
      about: "The roles people can hold, and what each one may do.",
      requires: { needs: "manage" },
      template: "list",
      record: "access.role",
      empty: "Roles show here.",
      columns: ["name", "kind", "grants", "held"],
      actions: roleActions(wren),
    },
    {
      id: "grants",
      label: "Grants",
      about: "Extra access given to someone beyond their role.",
      requires: { needs: "manage" },
      template: "list",
      record: "access.grant",
      empty: {
        live: "No extra grants.",
        ending: "Nothing ends this week.",
        all: "Grants show here once someone gets one.",
      },
      columns: ["email", "what", "state", "until", "by"],
      actions: grantActions(wren),
    },
    {
      id: "review",
      label: "Access review",
      about: "Who can reach what, to check it's still right.",
      requires: { needs: "manage" },
      template: "list",
      record: "access.review",
      empty: {
        all: "People show here once they join.",
        ending: "No grant ends this week.",
      },
      columns: ["email", "role", "can", "ending"],
      count: { soon: ["yes"] },
    },
  ];
}

/** Issues and asks: anyone signed in sees theirs and the ones waiting on them. */
export function inboxPages(): ListPage[] {
  return [
    {
      id: "issues",
      label: "Issues",
      about: "Problems raised on a record, waiting on a fix.",
      template: "list",
      record: "access.issue",
      late: queueLate("access.issue"),
      empty: {
        waiting: "No issues wait on you.",
        open: "No open issues.",
        all: "Issues raised on any record show here.",
      },
      columns: ["body", "title", "state", "by", "at"],
      actions: ISSUE_ACTIONS,
    },
    {
      id: "asks",
      label: "Access asks",
      about: "Requests for access, waiting on an answer.",
      template: "list",
      record: "access.ask",
      late: queueLate("access.ask"),
      empty: {
        waiting: "Nobody is waiting on you for access.",
        mine: "You haven't asked for anything.",
        all: "Asks for access show here.",
      },
      columns: ["email", "what", "reason", "state", "at"],
      actions: ASK_ACTIONS,
      // Open asks this reader decides: Today's Answer.
      count: { state: ["open"], yours: ["yes"] },
    },
  ];
}
