/**
 * Access's pages and actions (designs/2026-10-06-scoped-access.md, "Pages"): roles, grants,
 * issues and asks, the same for Wren's team (Team and Inbox) and a client's people (Account).
 * The console serves the four types for either; each action names its console handler, and
 * `ONE` in ../../records.tsx turns a row's id into its call.
 */
import type { Action } from "@wren/ui";
import type { ListPage } from "../../module.js";

const said = (word: string) => () => word;
/** Each is checked again on the row by the console: who manages, who can act, who can grant. */
const MANAGE = { needs: "manage", at: {} } as const;
const ANYONE = { needs: "read", at: {} } as const;

const VERBS_HINT = "Any of: read, comment, act, run. Split by commas.";
const APPS_HINT = "App ids split by commas, such as marketing. Blank is every app.";
const CHANNELS_HINT = "Such as youtube or linkedin. Blank is every channel.";

const grantForm = [
  { field: "verbs", label: "They can", hint: VERBS_HINT },
  { field: "apps", label: "In apps", optional: true, hint: APPS_HINT },
  { field: "channels", label: "On channels", optional: true, hint: CHANNELS_HINT },
] as const;

/** The role actions; giving a role is the team's seat at Wren, a membership at a client. */
export function roleActions(wren: boolean): Action[] {
  return [
    {
      id: "access.roleNew",
      label: "New role",
      handler: "console/roleSave",
      requires: MANAGE,
      form: [
        { field: "name", label: "Name" },
        ...grantForm,
        { field: "about", label: "About", optional: true, type: "long" },
      ],
      done: said("Role made"),
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
      form: [...grantForm],
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
      handler: "console/roleRemove",
      requires: MANAGE,
      when: { kind: ["custom"] },
      confirm: "Remove this role? Move its people off it first.",
      done: said("Removed"),
    },
  ];
}

export const GRANT_ACTIONS: Action[] = [
  {
    id: "access.grantAdd",
    label: "Add grant",
    handler: "console/grantAdd",
    requires: MANAGE,
    form: [
      { field: "email", label: "Their email" },
      ...grantForm,
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

export const ISSUE_ACTIONS: Action[] = [
  {
    id: "access.issueResolve",
    label: "Resolve",
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
    handler: "console/askApprove",
    requires: ANYONE,
    when: { state: ["open"], yours: ["yes"] },
    key: "a",
    done: said("Approved"),
  },
  {
    id: "access.askDecline",
    label: "Decline",
    handler: "console/askDecline",
    requires: ANYONE,
    when: { state: ["open"], yours: ["yes"] },
    done: said("Declined"),
  },
];

/** Roles and Grants: for whoever manages the workspace. */
export function managePages(wren: boolean): ListPage[] {
  return [
    {
      id: "roles",
      label: "Roles",
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
      requires: { needs: "manage" },
      template: "list",
      record: "access.grant",
      empty: {
        live: "No extra grants.",
        ending: "Nothing ends this week.",
        all: "Grants show here once someone gets one.",
      },
      columns: ["email", "what", "state", "until", "by"],
      actions: GRANT_ACTIONS,
    },
  ];
}

/** Issues and asks: anyone signed in sees theirs and the ones waiting on them. */
export function inboxPages(): ListPage[] {
  return [
    {
      id: "issues",
      label: "Issues",
      template: "list",
      record: "access.issue",
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
      template: "list",
      record: "access.ask",
      empty: {
        waiting: "Nobody is waiting on you for access.",
        mine: "You haven't asked for anything.",
        all: "Asks for access show here.",
      },
      columns: ["email", "what", "reason", "state", "at"],
      actions: ASK_ACTIONS,
    },
  ];
}
