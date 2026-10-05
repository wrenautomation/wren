/** The email channel's components: sequences out, replies in, the inboxes' health, copy tests. */
import { defineComponent, type LoopKey } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import {
  REPLIES,
  repliesSettingsSchema,
  SEQUENCES,
  type SequencesSettings,
  sequencesSettingsSchema,
} from "./sequences-settings.js";

const FOR_WREN = "Runs on Wren's niches and inboxes in the main database, not per client";

/**
 * A client's sequences run as: one queue-keeper for its niche, and per active mailbox a send
 * loop and an inbox read (bounces and opt-outs stop threads, so a mailbox that sends is read).
 */
function sequencesLoops(client: string, s: SequencesSettings): LoopKey[] {
  const active = s.senders.filter((x) => !x.suspended);
  return [
    ...(s.niche ? [{ service: "ComposeScheduler", key: clientKey(client, s.niche) }] : []),
    ...active.flatMap((x) => [
      { service: "SendScheduler", key: clientKey(client, x.address) },
      { service: "InboxScheduler", key: clientKey(client, x.address) },
    ]),
  ];
}

export const EMAIL_COMPONENTS = [
  defineComponent({
    id: SEQUENCES,
    stage: "reach",
    channels: ["email"],
    name: "Email sequences",
    blurb: "Writes each lead's opener and follow-ups and sends them from warmed inboxes.",
    icon: "mail",
    for: "client",
    ready: true,
    missing: [],
    settings: sequencesSettingsSchema,
    requires: { components: ["research.lead_sheet"], accounts: ["gmail"] },
    provides: {
      services: [
        "ComposeScheduler",
        "SendScheduler",
        "QueueRefresh",
        "OpensScheduler",
        "ReportScheduler",
        "EmailConsole",
      ],
      loops: ["ComposeScheduler", "SendScheduler", "OpensScheduler", "ReportScheduler"],
      records: ["email.campaign", "email.firm", "email.stall", "email.model"],
      apps: ["outbound"],
    },
    effects: ["sends", "spends"],
    clientLoops: (client, settings) => sequencesLoops(client, settings as SequencesSettings),
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [
      {
        id: "replied",
        label: "replies",
        kind: "reply",
        count: { record: "email.reply", view: "all" },
      },
      { id: "quiet", label: "leads that never replied", kind: "lead" },
    ],
    hypothesis: {
      from: "Wren's agency and recruiting campaigns, 2026-09",
      guesses: [
        {
          is: "change",
          says: "Copy, steps and timing per niche and offer.",
          built: "niche.sequences",
        },
        {
          is: "change",
          says: "Which sequence a lead gets, by what we know about it.",
          built: "niche.plan",
        },
        {
          is: "change",
          says: "The senders, their names and sign-offs.",
          built: "settings.senders",
        },
        { is: "change", says: "Daily caps and the ramp.", built: "settings.sending" },
        {
          is: "change",
          says: "How long a quiet lead rests before we write again.",
          built: "niche.recontact",
        },
        {
          is: "needs",
          says: "Warmed inboxes on the client's own domains, and a niche.",
          built: "settings.niche",
        },
        { is: "fixed", says: "Every send passes one gate: suppression, caps, the kill switch." },
      ],
    },
  }),
  defineComponent({
    id: REPLIES,
    stage: "follow",
    channels: ["email"],
    name: "Replies",
    blurb: "Reads every reply, sorts it, and queues an answer for approval.",
    icon: "reply",
    for: "client",
    ready: true,
    missing: [],
    settings: repliesSettingsSchema,
    requires: { components: [SEQUENCES] },
    provides: {
      services: ["InboxScheduler", "InboxPush", "Disposition", "CallBookings"],
      loops: ["InboxScheduler"],
      records: ["email.reply", "email.call", "inbox.reply"],
      apps: ["inbox"],
    },
    effects: ["sends"],
    in: [{ id: "replies", label: "replies", kind: "reply" }],
    out: [
      {
        id: "booked",
        label: "booked calls",
        kind: "call",
        count: { record: "email.call", view: "booked" },
      },
    ],
    hypothesis: {
      from: "Wren's campaign replies, 2026-09",
      guesses: [
        {
          is: "change",
          says: "Who approves answers: Wren now, the client's own team later.",
          built: null,
        },
        { is: "change", says: "Text and DM replies land in the same desk as email.", built: null },
        { is: "change", says: "What counts as warm depends on the offer.", built: null },
        { is: "change", says: "The calendar each client books on.", built: null },
        { is: "fixed", says: "Every answer to a lead waits on a person's yes." },
      ],
    },
  }),
  defineComponent({
    id: "email.inbox_health",
    stage: "reach",
    channels: ["email"],
    name: "Inbox health",
    blurb: "Watches each inbox's placement and reputation, and says when one slips.",
    icon: "pulse",
    for: "client",
    ready: false,
    missing: [FOR_WREN],
    requires: { components: ["email.sequences"] },
    provides: {
      services: ["PlacementScheduler", "PostmasterScheduler", "DigestScheduler"],
      loops: ["PlacementScheduler", "PostmasterScheduler", "DigestScheduler"],
      records: ["email.inbox"],
    },
    effects: ["sends"],
    hypothesis: {
      from: "Wren's sending inboxes, 2026-09",
      guesses: [
        {
          is: "change",
          says: "How far an inbox may slip before it pauses, by how much risk the client takes.",
          built: null,
        },
        { is: "needs", says: "Seed inboxes to test placement per client domain.", built: null },
        { is: "fixed", says: "An inbox that slips pauses itself before it burns the domain." },
      ],
    },
  }),
  defineComponent({
    id: "email.experiments",
    stage: "reach",
    channels: ["email"],
    name: "Copy experiments",
    blurb: "Tries new copy against the old and keeps what gets replies.",
    icon: "cycle",
    for: "client",
    ready: false,
    missing: [FOR_WREN],
    requires: { components: ["email.sequences"] },
    provides: {
      services: ["Evolution"],
      loops: ["Evolution"],
      records: ["email.variant", "email.experiment", "email.allele", "email.candidate"],
    },
    effects: ["spends"],
    hypothesis: {
      from: "Wren's opener tests, 2026-09",
      guesses: [
        {
          is: "change",
          says: "Which parts of the copy get tested: subject, opener, ask.",
          built: null,
        },
        {
          is: "change",
          says: "How sure it must be before keeping a variant, by volume.",
          built: null,
        },
        { is: "fixed", says: "A variant wins on replies, never on opens." },
      ],
    },
  }),
  defineComponent({
    id: "email.marketing",
    stage: "follow",
    channels: ["email"],
    name: "Opt-in marketing",
    blurb: "Signups with proof, a preference center, and one rule for who may get mail.",
    icon: "people",
    for: "client",
    ready: false,
    missing: ["Wren's own lists only; no marketing sender yet"],
    requires: { components: [] },
    provides: {
      services: ["Marketing"],
      records: ["marketing.subscriber", "marketing.topic"],
    },
    effects: ["sends"],
    in: [{ id: "signups", label: "signups", kind: "person" }],
    hypothesis: {
      from: "Wren's own opt-in lists, 2026-10",
      guesses: [
        { is: "change", says: "Each client's topics and preference center.", built: null },
        {
          is: "needs",
          says: "A postal address in every mail and a sender for marketing.",
          built: null,
        },
        { is: "fixed", says: "One rule decides who may get mail, and a signup keeps its proof." },
      ],
    },
  }),
];
