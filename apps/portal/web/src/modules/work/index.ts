/**
 * The engagement kit over the `delivery.*` records: the paperwork first, then the plan, updates,
 * asks, deliverables and results. A product's app adds these pages to its own; the work app
 * shows them for offers without an app. Wren's team posts, asks and hands over from the same
 * pages; the client answers and decides.
 */
import type { Access, Action } from "@wren/ui";
import type { Module, ModulePage } from "../../module.js";
import { Contract } from "./Contract.js";
import { askExtras, deliverableExtras, paperExtras, updateExtras } from "./extras.js";
import { Feedback } from "./Feedback.js";
import { Glance } from "./Glance.js";
import { WORK } from "./nav.js";
import { Welcome } from "./Welcome.js";

export { Feedback } from "./Feedback.js";

/** A signed-in client's own: never on the demo. */
const OWN: Access = { audience: "client" };
const TEAM: Access = { audience: "team" };
const OPEN = ["late", "now", "next"];
const PIECE = [
  { field: "title", label: "Title" },
  { field: "url", label: "Link", type: "url", optional: true },
  { field: "fileKey", label: "Or a file", type: "file", optional: true },
] as const;

const STEP_ACTIONS: Action[] = [
  {
    id: "delivery.done",
    label: "Mark done",
    handler: "delivery/done",
    undo: "delivery/undone",
    requires: TEAM,
    key: "d",
    when: { state: OPEN },
    sets: { state: "done" },
    done: () => "Marked done",
  },
  {
    id: "delivery.undone",
    label: "Not done",
    handler: "delivery/undone",
    requires: TEAM,
    when: { state: ["done"] },
    done: () => "Back on the plan",
  },
  {
    id: "delivery.slip",
    label: "Move",
    handler: "delivery/slip",
    requires: TEAM,
    each: true,
    form: [
      { field: "to", label: "New due date", type: "date" },
      { field: "reason", label: "Why it moved" },
    ],
    when: { state: OPEN },
    done: () => "Moved",
  },
];

const UPDATE_ACTIONS: Action[] = [
  {
    id: "delivery.post",
    label: "Post an update",
    handler: "delivery/post",
    requires: TEAM,
    form: [{ field: "body", label: "What we did", type: "long" }],
    done: () => "Posted",
  },
  {
    id: "delivery.note",
    label: "Add a team note",
    handler: "delivery/note",
    requires: TEAM,
    form: [{ field: "body", label: "Only Wren's team sees it", type: "long" }],
    done: () => "Noted",
  },
  {
    id: "delivery.hide",
    label: "Hide",
    handler: "delivery/hide",
    requires: TEAM,
    confirm: "Hide this update from everyone?",
    when: { seen: ["shared", "team"] },
    done: () => "Hidden",
  },
];

const ASK_ACTIONS: Action[] = [
  {
    id: "delivery.ask",
    label: "Ask the client",
    handler: "delivery/ask",
    requires: TEAM,
    form: [
      { field: "text", label: "What we need" },
      { field: "dueOn", label: "Due", type: "date", optional: true },
    ],
    done: () => "Asked",
  },
  {
    id: "delivery.answer",
    label: "Answer",
    handler: "delivery/answer",
    key: "a",
    each: true,
    form: [
      { field: "answer", label: "Your answer", type: "long", optional: true },
      { field: "fileKey", label: "Or a file", type: "file", optional: true },
    ],
    when: { state: ["open", "late"] },
    done: () => "Sent. Thank you.",
  },
];

const DELIVERABLE_ACTIONS: Action[] = [
  {
    id: "delivery.deliver",
    label: "Hand something over",
    handler: "delivery/deliver",
    requires: TEAM,
    form: PIECE,
    done: () => "Handed over",
  },
  {
    id: "delivery.approve",
    label: "Approve",
    handler: "delivery/approve",
    key: "a",
    when: { status: ["waiting"] },
    done: () => "Approved",
  },
  {
    id: "delivery.changes",
    label: "Ask for changes",
    handler: "delivery/changes",
    key: "c",
    ask: { field: "note", label: "What should change?" },
    when: { status: ["waiting"] },
    done: () => "Sent",
  },
  {
    id: "delivery.version",
    label: "New version",
    handler: "delivery/version",
    requires: TEAM,
    each: true,
    form: PIECE,
    done: () => "New version handed over",
  },
];

const PAPER_ACTIONS: Action[] = [
  {
    id: "delivery.grant",
    label: "I've given it",
    handler: "delivery/grant",
    key: "g",
    confirm: "Mark this access as given?",
    when: { state: ["open"] },
    done: () => "Thanks. We'll check it works.",
  },
  {
    id: "delivery.decline",
    label: "Decline",
    handler: "delivery/decline",
    ask: { field: "note", label: "Why not? We'll find another way." },
    when: { state: ["open"] },
    done: () => "Declined",
  },
  {
    id: "delivery.revoke",
    label: "I've taken it back",
    handler: "delivery/revoke",
    confirm: "Mark this access as taken back?",
    when: { state: ["granted"] },
    done: () => "Marked taken back",
  },
];

const RESULT_ACTIONS: Action[] = [
  {
    id: "delivery.result",
    label: "Record",
    handler: "delivery/result",
    requires: TEAM,
    each: true,
    form: [
      { field: "value", label: "So far", type: "number" },
      { field: "note", label: "Note", optional: true },
    ],
    done: () => "Recorded",
  },
];

/**
 * The plan's pages for a product's app: the ones a client opens often as tabs, the rest by
 * link. A client's own, so never on the demo.
 */
export const ENGAGEMENT_PAGES: ModulePage[] = [
  {
    id: "plan",
    label: "Plan",
    template: "list",
    record: "delivery.step",
    requires: OWN,
    empty: {
      all: "Your plan shows here on day one, step by step with its dates.",
      open: "Every step is done.",
      done: "Steps show here as they're done.",
    },
    columns: ["state", "starts", "due", "done", "why"],
    actions: STEP_ACTIONS,
  },
  {
    id: "updates",
    label: "Updates",
    template: "list",
    record: "delivery.update",
    requires: OWN,
    empty: "We post here as the work moves.",
    columns: ["at", "step", "author", "comments", "seen"],
    actions: UPDATE_ACTIONS,
    extras: updateExtras,
  },
  {
    id: "needs-you",
    label: "Needs you",
    template: "queue",
    record: "delivery.ask",
    requires: OWN,
    empty: { open: "Nothing waits on you right now.", answered: "What you answer shows here." },
    actions: ASK_ACTIONS,
    extras: askExtras,
  },
  {
    id: "paperwork",
    label: "Paperwork",
    template: "list",
    record: "delivery.paperwork",
    requires: OWN,
    empty: "The contract, the setup fee and the access we need show here.",
    columns: ["state", "scope", "answered"],
    actions: PAPER_ACTIONS,
    extras: paperExtras,
  },
  {
    id: "deliverables",
    label: "Deliverables",
    template: "queue",
    record: "delivery.deliverable",
    requires: OWN,
    hidden: true,
    empty: {
      waiting: "Nothing waits on your OK.",
      all: "Each piece we hand over shows here for your OK.",
    },
    actions: DELIVERABLE_ACTIONS,
    extras: deliverableExtras,
  },
  {
    id: "results",
    label: "Results",
    template: "list",
    record: "delivery.result",
    requires: OWN,
    hidden: true,
    empty: "The numbers that say whether this worked show here.",
    columns: ["value", "note", "at"],
    actions: RESULT_ACTIONS,
  },
  { id: "contract", label: "Contract", Page: Contract, requires: OWN, hidden: true },
  { id: "welcome", label: "Welcome guide", Page: Welcome, requires: OWN, hidden: true },
];

const page = (p: string, q: string) => `/${WORK}/${p}?${q}`;

export const work: Module = {
  id: WORK,
  name: "Your project",
  component: "delivery.portal",
  icon: "flag",
  blurb: "Your contract, the plan, how far along it is, and what we need from you next.",
  fallback: true,
  Glance,
  // The demo shows the products; a client's project lives on app. only.
  requires: OWN,
  pages: [
    {
      id: "overview",
      label: "Overview",
      template: "overview",
      tiles: [
        {
          label: "Needs you",
          record: "delivery.ask",
          href: page("needs-you", "view=open"),
          needs: true,
        },
        {
          label: "Waiting on your OK",
          record: "delivery.deliverable",
          href: page("deliverables", "view=waiting"),
          needs: true,
        },
        {
          label: "Paperwork to do",
          record: "delivery.paperwork",
          href: page("paperwork", "view=open"),
          needs: true,
        },
        { label: "Steps done", record: "delivery.step", href: page("plan", "view=done") },
      ],
      top: [
        {
          label: "What's next",
          record: "delivery.step",
          href: page("plan", "view=open"),
          fields: ["state", "due"],
          empty: "Every step is done.",
        },
        {
          label: "Latest updates",
          record: "delivery.update",
          href: page("updates", "view=all"),
          fields: ["at"],
          empty: "We post here as the work moves.",
        },
        {
          label: "Results so far",
          record: "delivery.result",
          href: page("results", "view=all"),
          fields: ["value"],
          empty: "The numbers that say whether this worked show here.",
        },
      ],
      below: Feedback,
    },
    // Its own app: deliverables and results get tabs too.
    ...ENGAGEMENT_PAGES.map(({ hidden, ...p }) =>
      p.id === "deliverables" || p.id === "results" ? p : { ...p, ...(hidden && { hidden }) },
    ),
  ],
};
