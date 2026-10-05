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
  }),
  defineComponent({
    id: REPLIES,
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
  }),
  defineComponent({
    id: "email.inbox_health",
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
  }),
  defineComponent({
    id: "email.experiments",
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
  }),
  defineComponent({
    id: "email.marketing",
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
  }),
];
