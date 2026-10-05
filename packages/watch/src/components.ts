/** The Watch: Wren's first routed workflow (designs/2026-10-05-workflows.md, The Watch). */
import { defineComponent } from "@wren/core/components";
import { defineWorkflow } from "@wren/core/workflows";

const OWN = "Reads William's own inboxes; never a client's";
const from = "William's two inboxes, 2026-10";

export const WATCH_COMPONENTS = [
  defineComponent({
    id: "watch.read",
    stage: "run",
    channels: ["email"],
    name: "Mail reader",
    blurb: "Reads new mail in each inbox every 15 minutes, skipping promotions and social.",
    icon: "mail",
    for: "wren",
    ready: false,
    missing: [OWN],
    provides: { services: ["Watch"], loops: ["Watch"] },
    out: [{ id: "mail", label: "new mail", kind: "mail" }],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "Which inboxes.", built: "env WREN_WATCH_MAILBOXES" },
        { is: "change", says: "Feeds, RSS and Atom, from the radar.", built: null },
        { is: "fixed", says: "Promotions and social mail are never read." },
      ],
    },
  }),
  defineComponent({
    id: "watch.triage",
    stage: "run",
    channels: ["email"],
    name: "Mail triage",
    blurb:
      "Shows only what needs you, by rules in plain words; a model reads what rules can't settle.",
    icon: "mail",
    for: "wren",
    ready: false,
    missing: [OWN],
    requires: { components: ["watch.read"] },
    effects: ["spends"],
    provides: {
      services: ["WatchConsole"],
      records: ["watch.mail", "watch.rule"],
    },
    in: [{ id: "mail", label: "mail", kind: "mail" }],
    out: [
      { id: "show", label: "needs you", kind: "mail" },
      { id: "hold", label: "held", kind: "mail" },
      { id: "drop", label: "dropped", kind: "mail" },
    ],
    hypothesis: {
      from,
      guesses: [
        {
          is: "change",
          says: "Rules, added from any row with Hide like this or Show like this.",
          built: "watch.rules, from WatchConsole hide and show",
        },
        {
          is: "needs",
          says: "A model for what rules can't settle; Cohere by default.",
          built: "env WREN_WATCH_LLM",
        },
        { is: "fixed", says: "Keeps sender, subject and a summary, never bodies." },
        { is: "fixed", says: "What it can't settle shows." },
      ],
    },
  }),
];

export const WATCH_WORKFLOWS = [
  defineWorkflow({
    id: "watch",
    stage: "run",
    name: "The Watch",
    blurb: "Reads the inboxes and shows only what needs you, by rules in plain words.",
    icon: "mail",
    for: "wren",
    out: [
      { id: "needs_you", label: "needs you", kind: "mail" },
      { id: "held", label: "held", kind: "mail" },
    ],
    nodes: [
      { id: "read", uses: "watch.read" },
      { id: "triage", uses: "watch.triage" },
    ],
    wires: [
      { from: "read.mail", to: "triage.mail", via: "events" },
      { from: "triage.show", to: "out.needs_you", via: "events" },
      { from: "triage.hold", to: "out.held", via: "events" },
    ],
  }),
];
