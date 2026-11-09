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

export const INBOX_HEALTH = "email.inbox_health";
/** A client's Postmaster pull is `EmailPostmasterPull/<client>/daily`. */
const CLIENT_POSTMASTER_UNIT = "daily";

/** One email step of a follow-up cadence on the executor (follow.ts). */
export const EMAIL_TOUCH = "email.touch";

/**
 * A client's sequences run as: one queue-keeper for its niche, and per active mailbox a send
 * loop and an inbox read (bounces and opt-outs stop threads, so a mailbox that sends is read).
 */
function sequencesLoops(client: string, s: SequencesSettings): LoopKey[] {
  const active = s.senders.filter((x) => !x.suspended);
  return [
    ...(s.niche ? [{ service: "EmailOpenerFill", key: clientKey(client, s.niche) }] : []),
    ...active.flatMap((x) => [
      { service: "EmailSend", key: clientKey(client, x.address) },
      { service: "EmailInboxRead", key: clientKey(client, x.address) },
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
        "EmailOpenerFill",
        "EmailSend",
        "EmailQueueRerender",
        "EmailClickPull",
        "EmailConsole",
      ],
      loops: ["EmailOpenerFill", "EmailSend", "EmailClickPull"],
      records: ["email.campaign", "email.firm", "email.stall", "email.model"],
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
      from: "Wren's email sequences, moved onto the executor 2026-10-05",
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
      services: ["EmailInboxRead", "InboxPush", "ReplyLabel", "CallBookingIntake"],
      loops: ["EmailInboxRead"],
      records: ["email.reply", "email.call"],
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
      services: ["EmailPlacementTest", "EmailPostmasterPull", "EmailFleetDigest"],
      loops: ["EmailPlacementTest", "EmailPostmasterPull", "EmailFleetDigest"],
      records: ["email.inbox"],
    },
    // Per client: Google's daily numbers for its verified sending domains, into its database.
    // Placement seeds and the digest are Wren's own until seed inboxes exist per client.
    clientLoops: (client) => [
      { service: "EmailPostmasterPull", key: clientKey(client, CLIENT_POSTMASTER_UNIT) },
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
    id: "email.marketing",
    stage: "follow",
    channels: ["email"],
    name: "Opt-in marketing",
    blurb: "Signups with proof, a preference center, and one rule for who may get mail.",
    icon: "people",
    for: "client",
    ready: false,
    missing: ["Not built per client yet: Wren's own lists only"],
    requires: { components: [] },
    provides: {
      services: [
        "SignupForm",
        "Newsletter",
        "EmailBounceRead",
        "ListmonkIntake",
        "ListmonkMail",
        "NewsletterSync",
      ],
      loops: ["EmailBounceRead", "NewsletterSync"],
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
          built: "the Newsletter object, postal from WREN_MARKETING_POSTAL",
        },
        {
          is: "needs",
          says: "Lists, subscribers and campaigns in Listmonk; the mail still goes from portal@.",
          built:
            "ListmonkIntake, ListmonkMail, NewsletterSync, set by WREN_LISTMONK_URL, _USER, _TOKEN",
        },
        { is: "fixed", says: "One rule decides who may get mail, and a signup keeps its proof." },
      ],
    },
  }),
];
