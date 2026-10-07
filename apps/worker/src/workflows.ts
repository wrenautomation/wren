/**
 * Every workflow (designs/2026-10-05-workflows.md): each package's own, and here the ones that
 * cross packages. Shared blocks first, then what's sold, then Wren's own business on top.
 * `components.test.ts` checks them against the catalog.
 */
import { emailCadence } from "@wren/channel-email";
import { textCadence } from "@wren/channel-sms";
import { CONTENT_WORKFLOWS } from "@wren/content/components";
import { setupWorkflow } from "@wren/core/setup";
import { defineWorkflow, type Workflow } from "@wren/core/workflows";
import { DELIVERY_WORKFLOWS } from "@wren/delivery/components";
import { NICHES, SMS_SEQUENCES } from "@wren/niches";
import { REACH_SEQUENCES, reachCadence } from "@wren/outreach";
import { OUTREACH_WORKFLOWS } from "@wren/outreach/components";
import { RESEARCH_WORKFLOWS } from "@wren/research/components";
import { WATCH_WORKFLOWS } from "@wren/watch/components";
import { SETUPS } from "./setups.js";

/** Shared blocks: what every funnel needs. */
const BLOCKS = [
  defineWorkflow({
    id: "signals",
    stage: "find",
    name: "Trigger leads",
    blurb: "Site visitors and buying signals, each turned into a lead with its reason.",
    icon: "pulse",
    for: "client",
    out: [{ id: "leads", label: "leads with a reason", kind: "lead" }],
    nodes: [
      { id: "visitors", uses: "signals.visitors" },
      { id: "triggers", uses: "signals.triggers" },
    ],
    wires: [
      { from: "visitors.leads", to: "out.leads", via: "events" },
      { from: "triggers.leads", to: "out.leads", via: "events" },
    ],
  }),
  defineWorkflow({
    id: "keep_warm",
    stage: "follow",
    name: "Keep warm",
    blurb: "Follows up on a quiet lead, then nurtures them for months, until they answer and book.",
    icon: "cycle",
    for: "client",
    in: [{ id: "leads", label: "leads who went quiet", kind: "lead" }],
    out: [{ id: "booked", label: "calls booked", kind: "call" }],
    nodes: [
      { id: "follow", uses: "follow_up" },
      { id: "nurture", uses: "nurture" },
      { id: "replies", uses: "email.replies" },
    ],
    wires: [
      { from: "in.leads", to: "follow.leads", via: "events" },
      { from: "follow.replied", to: "replies.replies", via: "events" },
      { from: "follow.quiet", to: "nurture.leads", via: "events" },
      { from: "nurture.replied", to: "replies.replies", via: "events" },
      { from: "replies.booked", to: "out.booked", via: "events" },
    ],
  }),
  defineWorkflow({
    id: "close",
    stage: "book",
    name: "Booked call",
    blurb: "Reminds them, briefs us, marks how it went, and keeps a not-yet warm.",
    icon: "check",
    for: "client",
    in: [{ id: "calls", label: "booked calls", kind: "call" }],
    out: [{ id: "won", label: "clients won", kind: "client" }],
    nodes: [
      { id: "reminders", uses: "sms.reminders" },
      { id: "brief", uses: "calls.brief" },
      { id: "outcome", uses: "calls.outcome" },
      { id: "warm", uses: "keep_warm", note: "A month after a not yet." },
    ],
    wires: [
      { from: "in.calls", to: "reminders.calls", via: "code" },
      { from: "in.calls", to: "brief.calls", via: "events" },
      { from: "reminders.reminded", to: "outcome.calls", via: "events", when: "the call happened" },
      { from: "outcome.later", to: "warm.leads", via: "events", wait: "30 days" },
      { from: "warm.booked", to: "reminders.calls", via: "events" },
      { from: "warm.booked", to: "brief.calls", via: "events" },
      { from: "outcome.won", to: "out.won", via: "events" },
    ],
  }),
];

/** What's sold: each a template a client installs. */
const FUNNELS = [
  defineWorkflow({
    id: "speed_to_lead.steps",
    stage: "follow",
    name: "Speed to lead",
    blurb: "A text within a minute, a call, then texts until they book.",
    icon: "clock",
    for: "client",
    in: [{ id: "forms", label: "new leads", kind: "form" }],
    out: [{ id: "booked", label: "calls booked", kind: "call" }],
    nodes: [
      { id: "text", uses: "sms.forms", note: "The first text, within a minute." },
      { id: "call", uses: "voice.call_now", note: "Call now, for the rep, until voice is set up." },
      { id: "follow", uses: "sms.follow_up", note: "Day 1, 3 and 7, until they answer or book." },
    ],
    wires: [
      { from: "in.forms", to: "text.forms", via: "events" },
      { from: "text.texted", to: "call.leads", via: "events", wait: "2 minutes" },
      // No consent, no phone, or texts off: the rep still calls, at once.
      { from: "text.untexted", to: "call.leads", via: "events" },
      { from: "text.texted", to: "follow.leads", via: "events" },
      { from: "call.booked", to: "out.booked", via: "events" },
    ],
  }),
  defineWorkflow({
    id: "outbound",
    stage: "reach",
    name: "Outbound",
    blurb: "Finds leads, writes to them by email, text and DM, and books the ones who answer.",
    icon: "mail",
    for: "client",
    out: [{ id: "won", label: "clients won", kind: "client" }],
    nodes: [
      { id: "research", uses: "research.lead_sheet" },
      { id: "signals", uses: "signals" },
      { id: "email", uses: "email.sequences" },
      { id: "texts", uses: "sms.texts" },
      { id: "dms", uses: "reach.outreach" },
      { id: "replies", uses: "email.replies" },
      { id: "close", uses: "close" },
    ],
    wires: [
      { from: "research.leads", to: "email.leads", via: "code" },
      { from: "research.leads", to: "texts.leads", via: "code" },
      { from: "research.people", to: "dms.people", via: "code" },
      {
        from: "signals.leads",
        to: "email.leads",
        via: "events",
        when: "the reason fits a sequence",
      },
      { from: "email.quiet", to: "email.leads", via: "code", wait: "90 days" },
      { from: "email.replied", to: "replies.replies", via: "code" },
      { from: "texts.replied", to: "replies.replies", via: "events" },
      { from: "dms.replied", to: "replies.replies", via: "events" },
      { from: "replies.booked", to: "close.calls", via: "code" },
      { from: "close.won", to: "out.won", via: "events" },
    ],
  }),
  defineWorkflow({
    id: "paid",
    stage: "reach",
    name: "Paid leads",
    blurb: "Meta lead forms, answered by speed to lead.",
    icon: "money",
    for: "client",
    out: [{ id: "won", label: "clients won", kind: "client" }],
    nodes: [
      { id: "ads", uses: "ads.meta" },
      { id: "speed", uses: "speed_to_lead" },
      { id: "close", uses: "close" },
    ],
    wires: [
      { from: "ads.forms", to: "speed.forms", via: "events" },
      { from: "speed.booked", to: "close.calls", via: "events" },
      { from: "close.won", to: "out.won", via: "events" },
    ],
  }),
  defineWorkflow({
    id: "win_back",
    stage: "reach",
    name: "Win back old leads",
    blurb: "Writes to the client's old leads as their own people and books the ones who answer.",
    icon: "cycle",
    for: "client",
    in: [{ id: "contacts", label: "old leads", kind: "person" }],
    out: [{ id: "won", label: "clients won", kind: "client" }],
    nodes: [
      { id: "reactivation", uses: "reactivation" },
      { id: "close", uses: "close" },
    ],
    wires: [
      { from: "in.contacts", to: "reactivation.contacts", via: "code" },
      { from: "reactivation.booked", to: "close.calls", via: "events" },
      { from: "close.won", to: "out.won", via: "events" },
    ],
  }),
];

/** Wren's own business, all on one canvas. */
const WREN = defineWorkflow({
  id: "wren",
  stage: "run",
  name: "Wren",
  blurb: "How Wren wins clients, delivers, and runs itself.",
  icon: "home",
  for: "wren",
  nodes: [
    { id: "outbound", uses: "outbound" },
    { id: "paid", uses: "paid" },
    { id: "content", uses: "content" },
    { id: "onboarding", uses: "onboarding" },
    { id: "watch", uses: "watch" },
    { id: "books", uses: "books" },
  ],
  wires: [
    { from: "outbound.won", to: "onboarding.clients", via: "events" },
    { from: "paid.won", to: "onboarding.clients", via: "events" },
  ],
});

export const WORKFLOWS: readonly Workflow[] = [
  ...RESEARCH_WORKFLOWS,
  ...DELIVERY_WORKFLOWS,
  ...CONTENT_WORKFLOWS,
  ...WATCH_WORKFLOWS,
  ...OUTREACH_WORKFLOWS,
  // Follow-ups on the spine: each email and text sequence is its cadence; invite-only DMs have none.
  ...NICHES.flatMap((n) => [...n.sequences.values()].map((s) => emailCadence(n.name, s))),
  ...[...SMS_SEQUENCES.values()].map(textCadence),
  ...[...REACH_SEQUENCES.values()].filter((s) => s.steps.length > 0).map(reachCadence),
  ...BLOCKS,
  ...FUNNELS,
  WREN,
  // Account setups: not sold, each one runs per account.
  ...SETUPS.map(setupWorkflow),
];
