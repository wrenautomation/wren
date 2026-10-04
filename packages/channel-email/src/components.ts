/** The email channel's components: sequences out, replies in, the inboxes' health, copy tests. */
import { defineComponent } from "@wren/core/components";

const FOR_WREN = "Runs on Wren's niches and inboxes in the main database, not per client";

export const EMAIL_COMPONENTS = [
  defineComponent({
    id: "email.sequences",
    name: "Email sequences",
    blurb: "Writes each lead's opener and follow-ups and sends them from warmed inboxes.",
    icon: "mail",
    for: "client",
    ready: false,
    missing: [FOR_WREN],
    requires: { components: ["research.lead_sheet"] },
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
  }),
  defineComponent({
    id: "email.replies",
    name: "Replies",
    blurb: "Reads every reply, sorts it, and queues an answer for approval.",
    icon: "reply",
    for: "client",
    ready: false,
    missing: [FOR_WREN],
    requires: { components: ["email.sequences"] },
    provides: {
      services: ["InboxScheduler", "Disposition"],
      loops: ["InboxScheduler"],
      records: ["email.reply"],
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
];
