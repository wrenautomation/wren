/**
 * Parts we need and haven't built, shown as in development. Each has the ports and the knobs it
 * will ship with, so workflows wire it now (designs/2026-10-05-workflows.md). Built, it moves to
 * its package under the same id, and its knobs become settings.
 */
import { defineComponent } from "@wren/core/components";

const from = "Designed 2026-10-05, not used yet";
const planned = { ready: false, planned: true, missing: ["Not built"] };

export const PLANNED_COMPONENTS = [
  defineComponent({
    ...planned,
    id: "voice.dialer",
    stage: "reach",
    channels: ["voice"],
    name: "Power dialer",
    blurb:
      "Calls leads on a call plan and puts whoever answers through to a rep or the voice agent.",
    icon: "phone",
    for: "client",
    in: [{ id: "leads", label: "leads to call", kind: "lead" }],
    out: [
      { id: "booked", label: "calls booked", kind: "call" },
      { id: "missed", label: "no answer", kind: "lead" },
    ],
    requires: { accounts: ["telnyx"] },
    effects: ["sends", "spends"],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "The call plan: how many tries, the gaps, the hours.", built: null },
        { is: "change", says: "Who talks: a rep, or the voice agent.", built: null },
        { is: "change", says: "The script, per offer.", built: null },
        { is: "needs", says: "Numbers local to each lead, on the client's Telnyx.", built: null },
        {
          is: "fixed",
          says: "Never calls outside the lead's local hours or a do-not-call number.",
        },
      ],
    },
  }),
  defineComponent({
    ...planned,
    id: "voice.voicemail",
    stage: "reach",
    channels: ["voice"],
    name: "Voicemail drop",
    blurb: "Leaves a recorded voicemail, straight to the inbox or after no answer.",
    icon: "phone",
    for: "client",
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [{ id: "left", label: "voicemails left", kind: "lead" }],
    requires: { accounts: ["telnyx"] },
    effects: ["sends", "spends"],
    hypothesis: {
      from,
      guesses: [
        {
          is: "change",
          says: "The recording for each step, in the client's own voice.",
          built: null,
        },
        {
          is: "change",
          says: "Dropped straight to voicemail, or left after no answer.",
          built: null,
        },
        { is: "fixed", says: "Only where the lead's state allows it." },
      ],
    },
  }),
  defineComponent({
    ...planned,
    id: "follow_up",
    stage: "follow",
    channels: ["email", "text"],
    name: "Follow-up",
    blurb: "Works a quiet lead through touches on every channel: texts, email, voicemail, calls.",
    icon: "cycle",
    for: "client",
    missing: ["A client's own cadence. The touches run Wren's sequences today."],
    in: [{ id: "leads", label: "leads who went quiet", kind: "lead" }],
    out: [
      { id: "replied", label: "replies", kind: "reply" },
      { id: "quiet", label: "still quiet", kind: "lead" },
    ],
    effects: ["sends"],
    hypothesis: {
      from,
      guesses: [
        {
          is: "change",
          says: "The steps: each one's channel, copy and wait.",
          built: "cadenceWorkflow in @wren/core/workflows, one touch node per step",
        },
        {
          is: "change",
          says: "When it stops: a reply, a booking, the last step.",
          built: "each touch's replied port ends it",
        },
        {
          is: "needs",
          says: "The channel parts its steps use.",
          built: "email.touch, sms.touch and reach.touch, mixed in one cadence",
        },
        { is: "fixed", says: "A lead is in one cadence at a time." },
      ],
    },
  }),
  defineComponent({
    ...planned,
    id: "nurture",
    stage: "follow",
    channels: ["email"],
    name: "Nurture",
    blurb: "Keeps not-yet leads warm for months with something useful, until they answer.",
    icon: "mail",
    for: "client",
    in: [{ id: "leads", label: "not yet", kind: "lead" }],
    out: [{ id: "replied", label: "replies", kind: "reply" }],
    effects: ["sends"],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "How often, and on which channel.", built: null },
        { is: "change", says: "What it sends: posts, playbooks, results.", built: null },
        { is: "fixed", says: "Stops the moment they answer or opt out." },
      ],
    },
  }),
  defineComponent({
    ...planned,
    id: "signals.visitors",
    stage: "find",
    channels: ["web"],
    name: "Visitor ID",
    blurb: "Names the firm behind a site visit and finds the right person to write to.",
    icon: "search",
    for: "client",
    out: [{ id: "leads", label: "visitors named", kind: "lead" }],
    effects: ["spends"],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "Which pages count, and how long a visit must be.", built: null },
        {
          is: "needs",
          says: "A provider that maps visits to firms, priced per match.",
          built: null,
        },
        { is: "fixed", says: "Each lead keeps the visit that found it." },
      ],
    },
  }),
  defineComponent({
    ...planned,
    id: "signals.triggers",
    stage: "find",
    channels: ["social", "web"],
    name: "Triggers",
    blurb:
      "Job changes, hiring, funding and recent posts, each turned into a lead with its reason.",
    icon: "flag",
    for: "client",
    missing: ["Job changes and company news are read for reactivation, not yet as new leads"],
    out: [{ id: "leads", label: "leads with a reason", kind: "lead" }],
    effects: ["spends"],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "Which triggers matter, per niche.", built: null },
        {
          is: "change",
          says: "Sources: LinkedIn, Instagram, news, job boards.",
          built: "reactivation's movers (job changes) and the company-events check (news)",
        },
        { is: "fixed", says: "Every lead carries the trigger that made it." },
      ],
    },
  }),
];
