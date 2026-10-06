/** Cold outreach on social sites: a person's warmed account, paced. Comments on our posts. */
import { defineComponent } from "@wren/core/components";
import { defineWorkflow } from "@wren/core/workflows";

export const OUTREACH_COMPONENTS = [
  defineComponent({
    id: "reach.outreach",
    stage: "reach",
    channels: ["dm"],
    name: "Social outreach",
    blurb: "Writes to people on social sites from a warmed account, paced.",
    icon: "people",
    for: "client",
    ready: false,
    missing: ["Held: no targeting yet, and it runs on Wren's accounts only"],
    provides: {
      services: ["ReachSender", "ReachWatch", "ReachDesk"],
      loops: ["ReachSender", "ReachWatch"],
    },
    effects: ["sends"],
    in: [{ id: "people", label: "people", kind: "person" }],
    out: [{ id: "replied", label: "DM replies", kind: "reply" }],
    hypothesis: {
      from: "Wren's DM tests, 2026-10",
      guesses: [
        { is: "change", says: "Which sites: LinkedIn, Reddit, X.", built: null },
        { is: "change", says: "Caps and ramp per account.", built: "the caps ledger" },
        { is: "change", says: "Who to write to.", built: null },
        { is: "needs", says: "Warmed accounts the client owns.", built: null },
        { is: "fixed", says: "Each account is paced by its own caps." },
      ],
    },
  }),
  defineComponent({
    id: "reach.touch",
    stage: "follow",
    channels: ["dm"],
    name: "DM step",
    blurb: "One DM of a follow-up, queued when its wait is over, unless they answered.",
    icon: "people",
    for: "client",
    ready: false,
    missing: ["Held with Social outreach"],
    requires: { components: ["reach.outreach"] },
    effects: ["sends"],
    in: [{ id: "lead", label: "lead", kind: "lead" }],
    out: [
      { id: "sent", label: "sent", kind: "lead" },
      { id: "replied", label: "answered", kind: "reply" },
    ],
    hypothesis: {
      from: "Wren's DM sequences, moved onto the spine 2026-10-05",
      guesses: [
        {
          is: "change",
          says: "Which step of the sequence's copy it sends: the node's step.",
          built: null,
        },
        {
          is: "needs",
          says: "One person across channels, so a cadence can mix DMs with texts and email.",
          built: null,
        },
        { is: "fixed", says: "The sender still paces every DM and waits on LinkedIn's accept." },
      ],
    },
  }),
  defineComponent({
    id: "comments.read",
    stage: "follow",
    channels: ["dm"],
    name: "Comment reader",
    blurb:
      "Reads each account's inbox every 2 minutes after a touch, easing to 30: comments on our posts and under our comments.",
    icon: "people",
    for: "wren",
    ready: false,
    missing: ["Reads Wren's own Reddit accounts; never a client's"],
    // ReachWatch is Social outreach's loop; this part is its inbox read.
    requires: { components: ["reach.outreach"] },
    provides: { records: ["marketing.comment"] },
    out: [{ id: "comment", label: "new comments", kind: "comment" }],
    hypothesis: {
      from: "Wren's Reddit posts, 2026-10",
      guesses: [
        {
          is: "change",
          says: "Which accounts: every reach account's inbox.",
          built: "the reach_accounts rows",
        },
        { is: "change", says: "LinkedIn, X and IG comments, as another reader.", built: null },
        {
          is: "change",
          says: "How fast it checks: 2 min for 15 min after a touch, then 5, 15, 30.",
          built: "WARM_TIERS in @wren/core/warm",
        },
        {
          is: "fixed",
          says: "One inbox read per account serves DMs and comments; nothing is marked read.",
        },
      ],
    },
  }),
  defineComponent({
    id: "comments.sort",
    stage: "follow",
    channels: ["dm"],
    name: "Comment sort",
    blurb:
      "Reads each comment as asked, question, chat or hostile, and drafts an answer to the first two.",
    icon: "people",
    for: "wren",
    ready: false,
    missing: ["Reads Wren's own Reddit accounts; never a client's"],
    requires: { components: ["comments.read"] },
    effects: ["spends"],
    in: [{ id: "comment", label: "comment", kind: "comment" }],
    out: [
      { id: "asked", label: "asked", kind: "comment" },
      { id: "question", label: "question", kind: "comment" },
      { id: "chat", label: "chat", kind: "comment" },
      { id: "hostile", label: "hostile", kind: "comment" },
    ],
    hypothesis: {
      from: "Wren's Reddit posts, 2026-10",
      guesses: [
        {
          is: "needs",
          says: "A model for what words can't settle; Cohere by default.",
          built: "env WREN_WATCH_LLM",
        },
        { is: "change", says: "The words that mean they asked.", built: null },
        { is: "fixed", says: "Every answer and DM waits on William's click." },
        { is: "fixed", says: "Our two accounts never write in one thread." },
      ],
    },
  }),
];

export const OUTREACH_WORKFLOWS = [
  defineWorkflow({
    id: "reach.comments",
    stage: "follow",
    name: "Comments",
    blurb: "Every comment on our posts lands in Replies, sorted, with a draft when they asked.",
    icon: "people",
    for: "wren",
    out: [
      { id: "needs_you", label: "needs you", kind: "comment" },
      { id: "chat", label: "chat", kind: "comment" },
    ],
    nodes: [
      { id: "read", uses: "comments.read" },
      { id: "sort", uses: "comments.sort" },
    ],
    wires: [
      { from: "read.comment", to: "sort.comment", via: "events" },
      { from: "sort.asked", to: "out.needs_you", via: "events" },
      { from: "sort.question", to: "out.needs_you", via: "events" },
      { from: "sort.chat", to: "out.chat", via: "events" },
      { from: "sort.hostile", to: "out.chat", via: "events" },
    ],
  }),
];
