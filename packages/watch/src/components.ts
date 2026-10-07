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
    name: "Mail and feed reader",
    blurb:
      "Reads new mail in each inbox every 15 minutes, skipping promotions and social, and each feed Wren follows hourly.",
    icon: "mail",
    for: "wren",
    ready: false,
    missing: [OWN],
    provides: { services: ["Watch"], loops: ["Watch"] },
    out: [
      { id: "mail", label: "new mail", kind: "mail" },
      { id: "items", label: "new feed items", kind: "item" },
    ],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "Which inboxes.", built: "env WREN_WATCH_MAILBOXES" },
        {
          is: "change",
          says: "Feeds, RSS and Atom, from the radar.",
          built: "watch.feeds, followed from Inbox → Feeds",
        },
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
  defineComponent({
    id: "watch.score",
    stage: "run",
    channels: ["web"],
    name: "Feed scoring",
    blurb:
      "Scores each new feed item 0 to 10 on how much it should change how Wren works, against its SOPs.",
    icon: "search",
    for: "wren",
    ready: false,
    missing: ["Scores against Wren's own SOPs; a client's would need theirs"],
    requires: { components: ["watch.read"] },
    effects: ["spends"],
    // Its hands are WatchConsole's, which triage owns.
    provides: { records: ["watch.item", "watch.feed"] },
    in: [{ id: "item", label: "feed items", kind: "item" }],
    out: [
      { id: "show", label: "worth reading", kind: "item" },
      { id: "hold", label: "worth knowing", kind: "item" },
      { id: "drop", label: "dropped", kind: "item" },
    ],
    hypothesis: {
      from: "Wren's radar, 2026-10",
      guesses: [
        { is: "change", says: "Which feeds.", built: "watch.feeds, from Inbox → Feeds" },
        {
          is: "change",
          says: "What it scores against: the SOPs pushed with wren sop push.",
          built: "content_playbooks, from wren sop push",
        },
        { is: "needs", says: "A model; Cohere by default.", built: "env WREN_WATCH_LLM" },
        { is: "fixed", says: "7 and up shows, 4 to 6 holds, the rest drops." },
        { is: "fixed", says: "Following a feed scores what comes next, not its back catalog." },
      ],
    },
  }),
];

export const WATCH_WORKFLOWS = [
  defineWorkflow({
    id: "watch",
    stage: "run",
    name: "The Watch",
    blurb:
      "Reads the inboxes and the feeds Wren follows, and shows only what needs you or should change how Wren works.",
    icon: "mail",
    for: "wren",
    out: [
      { id: "needs_you", label: "needs you", kind: "mail" },
      { id: "held", label: "held", kind: "mail" },
      { id: "to_read", label: "worth reading", kind: "item" },
    ],
    nodes: [
      { id: "read", uses: "watch.read" },
      { id: "triage", uses: "watch.triage" },
      { id: "score", uses: "watch.score" },
      { id: "bills", uses: "books.bills" },
    ],
    wires: [
      { from: "read.mail", to: "triage.mail", via: "events" },
      { from: "read.mail", to: "bills.mail", via: "events" },
      { from: "triage.show", to: "out.needs_you", via: "events" },
      { from: "triage.hold", to: "out.held", via: "events" },
      { from: "read.items", to: "score.item", via: "events" },
      { from: "score.show", to: "out.to_read", via: "events" },
    ],
  }),
];
