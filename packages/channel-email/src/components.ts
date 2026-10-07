/** The email channel's components: sequences out, replies in, the inboxes' health, copy tests. */
import { defineComponent, type LoopKey } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import {
  briefSettingsSchema,
  CALL_BRIEF,
  CALL_OUTCOME,
  outcomeSettingsSchema,
} from "./calls/settings.js";
import {
  REPLIES,
  repliesSettingsSchema,
  SEQUENCES,
  type SequencesSettings,
  sequencesSettingsSchema,
} from "./sequences-settings.js";

export const INBOX_HEALTH = "email.inbox_health";
/** A client's Postmaster pull is `PostmasterScheduler/<client>/daily`. */
export const CLIENT_POSTMASTER_UNIT = "daily";

/** One email step of a follow-up cadence on the spine (follow.ts). */
export const EMAIL_TOUCH = "email.touch";

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
    id: EMAIL_TOUCH,
    stage: "follow",
    channels: ["email"],
    name: "Email step",
    blurb: "Lets one follow-up email go once the step before it sent, unless they answered.",
    icon: "mail",
    for: "client",
    ready: true,
    requires: { components: [SEQUENCES] },
    effects: ["sends"],
    in: [{ id: "lead", label: "lead", kind: "lead" }],
    out: [
      { id: "sent", label: "sent", kind: "lead" },
      { id: "replied", label: "answered", kind: "reply" },
    ],
    hypothesis: {
      from: "Wren's email sequences, moved onto the spine 2026-10-05",
      guesses: [
        {
          is: "change",
          says: "Which step of the thread it lets go: the node's step.",
          built: null,
        },
        {
          is: "change",
          says: "A text or DM between two emails: the email waits for the touch after it.",
          built: null,
        },
        {
          is: "fixed",
          says: "The tick still picks the day (business days, holidays, out-of-office, caps); a touch only lets the step go.",
        },
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
      records: ["email.reply", "email.call"],
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
    id: INBOX_HEALTH,
    stage: "reach",
    channels: ["email"],
    name: "Inbox health",
    blurb: "Watches each inbox's placement and reputation, and says when one slips.",
    icon: "pulse",
    for: "client",
    ready: true,
    requires: {
      components: ["email.sequences"],
      accounts: ["postmaster"],
      facts: ["postmaster.verified"],
    },
    provides: {
      services: ["PlacementScheduler", "PostmasterScheduler", "DigestScheduler"],
      loops: ["PlacementScheduler", "PostmasterScheduler", "DigestScheduler"],
      records: ["email.inbox"],
    },
    // Per client: Google's daily numbers for its verified sending domains, into its database.
    // Placement seeds and the digest are Wren's own until seed inboxes exist per client.
    clientLoops: (client) => [
      { service: "PostmasterScheduler", key: clientKey(client, CLIENT_POSTMASTER_UNIT) },
    ],
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
    missing: ["Not built per client yet: waits on each client's own copy templates"],
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
    missing: ["Not built per client yet: Wren's own lists only, and no marketing sender"],
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
  defineComponent({
    id: CALL_BRIEF,
    stage: "book",
    name: "Pre-call brief",
    blurb:
      "Who booked, how they came in, their words, the dossier and signals, and what to ask, on the call's page.",
    icon: "board",
    for: "client",
    wrenSettings: true,
    ready: true,
    missing: [],
    settings: briefSettingsSchema,
    provides: { services: ["CallBriefs"] },
    in: [{ id: "calls", label: "booked calls", kind: "call" }],
    out: [{ id: "ready", label: "briefs ready", kind: "call" }],
    hypothesis: {
      from: "Designed 2026-10-07 from the dossier and the threads",
      guesses: [
        { is: "change", says: "What it holds, per offer.", built: null },
        {
          is: "change",
          says: "How long before the call it's rebuilt and pinged.",
          built: "settings.leadMinutes",
        },
        { is: "change", says: "Whether the model adds questions.", built: "settings.questions" },
        { is: "needs", says: "A ping to the client's own rep, not only Wren's team.", built: null },
        { is: "fixed", says: "Every line names its source and date; the model adds no facts." },
      ],
    },
  }),
  defineComponent({
    id: CALL_OUTCOME,
    stage: "book",
    name: "Call outcome",
    blurb: "Marks how each call went: won, not yet with the reason, no-show, or not a fit.",
    icon: "check",
    for: "client",
    wrenSettings: true,
    ready: true,
    missing: [],
    settings: outcomeSettingsSchema,
    provides: { apps: ["calls"] },
    in: [{ id: "calls", label: "calls held", kind: "call" }],
    out: [
      { id: "won", label: "clients won", kind: "client" },
      { id: "later", label: "not yet", kind: "lead" },
    ],
    hypothesis: {
      from: "Designed 2026-10-07 with speed to lead's dial outcomes",
      guesses: [
        { is: "change", says: "The not-yet reasons, per offer.", built: "settings.reasons" },
        {
          is: "needs",
          says: "A rebook for a no-show, once William says what it sends.",
          built: null,
        },
        { is: "fixed", says: "A person marks it; nothing guesses." },
      ],
    },
  }),
];
