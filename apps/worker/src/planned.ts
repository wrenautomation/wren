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
    id: "speed_to_lead",
    stage: "follow",
    channels: ["text", "voice"],
    name: "Speed to lead",
    blurb: "Texts a new lead within a minute, calls them, and follows up until they book.",
    icon: "clock",
    for: "client",
    inside: "speed_to_lead.steps",
    in: [{ id: "forms", label: "new leads", kind: "form" }],
    out: [{ id: "booked", label: "calls booked", kind: "call" }],
    effects: ["sends", "spends"],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "The first text's copy.", built: null },
        { is: "change", says: "How long after the text it calls.", built: null },
        { is: "change", says: "The call plan: tries, gaps, hours, and who talks.", built: null },
        {
          is: "change",
          says: "Where leads come in: Meta forms, the site, a CRM's webhook.",
          built: null,
        },
        {
          is: "needs",
          says: "The follow-up sub-part for anyone who doesn't pick up.",
          built: null,
        },
        { is: "fixed", says: "The first text goes within a minute of the form." },
      ],
    },
  }),
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
    id: "voice.agent",
    stage: "follow",
    channels: ["voice"],
    name: "Voice agent",
    blurb: "Answers and makes calls for the client, qualifies the lead and books the call.",
    icon: "phone",
    for: "client",
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [
      { id: "booked", label: "calls booked", kind: "call" },
      { id: "missed", label: "not booked", kind: "lead" },
    ],
    effects: ["spends"],
    hypothesis: {
      from,
      guesses: [
        {
          is: "change",
          says: "The questions and what counts as qualified, per offer.",
          built: null,
        },
        { is: "change", says: "The voice, and the booking rules.", built: null },
        { is: "needs", says: "A voice model's minutes, priced per call.", built: null },
        { is: "fixed", says: "Says it's an assistant, and hands off to a person when asked." },
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
    in: [{ id: "leads", label: "leads who went quiet", kind: "lead" }],
    out: [
      { id: "replied", label: "replies", kind: "reply" },
      { id: "quiet", label: "still quiet", kind: "lead" },
    ],
    effects: ["sends"],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "The steps: each one's channel, copy and wait.", built: null },
        { is: "change", says: "When it stops: a reply, a booking, the last step.", built: null },
        { is: "needs", says: "The channel parts its steps use.", built: null },
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
    out: [{ id: "leads", label: "leads with a reason", kind: "lead" }],
    effects: ["spends"],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "Which triggers matter, per niche.", built: null },
        { is: "change", says: "Sources: LinkedIn, Instagram, news, job boards.", built: null },
        { is: "fixed", says: "Every lead carries the trigger that made it." },
      ],
    },
  }),
  defineComponent({
    ...planned,
    id: "research.social",
    stage: "find",
    channels: ["social"],
    name: "Social reads",
    blurb:
      "Reads a firm's recent Instagram and LinkedIn posts, so the dossier and first line can use them.",
    icon: "search",
    for: "client",
    in: [{ id: "firms", label: "firms", kind: "firm" }],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "Which networks, per niche.", built: null },
        { is: "fixed", says: "Public posts only, read and never posted to." },
      ],
    },
  }),
  defineComponent({
    ...planned,
    id: "calls.brief",
    stage: "book",
    name: "Pre-call brief",
    blurb: "A dossier on the firm, their demo video and an agenda, ready before the call.",
    icon: "board",
    for: "client",
    in: [{ id: "calls", label: "booked calls", kind: "call" }],
    out: [{ id: "ready", label: "briefs ready", kind: "call" }],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "What it holds, per offer.", built: null },
        { is: "change", says: "How long before the call it's ready.", built: null },
        { is: "fixed", says: "Every claim cites its source, as the dossier's do." },
      ],
    },
  }),
  defineComponent({
    ...planned,
    id: "calls.outcome",
    stage: "book",
    name: "Call outcome",
    blurb: "Marks how each call went: won, or not yet with the reason.",
    icon: "check",
    for: "client",
    in: [{ id: "calls", label: "calls held", kind: "call" }],
    out: [
      { id: "won", label: "clients won", kind: "client" },
      { id: "later", label: "not yet", kind: "lead" },
    ],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "The outcomes and reasons, per offer.", built: null },
        { is: "fixed", says: "A person marks it; nothing guesses." },
      ],
    },
  }),
  defineComponent({
    ...planned,
    id: "watch",
    stage: "run",
    channels: ["email"],
    name: "The Watch",
    blurb: "Reads the inboxes and feeds and shows only what needs you, by rules in plain words.",
    icon: "mail",
    for: "wren",
    effects: ["spends"],
    hypothesis: {
      from,
      guesses: [
        {
          is: "change",
          says: "Rules, added from any row with Hide like this or Show like this.",
          built: null,
        },
        { is: "change", says: "More inboxes and feeds.", built: null },
        {
          is: "needs",
          says: "A model for what rules can't settle; Cohere by default.",
          built: null,
        },
        { is: "fixed", says: "Keeps sender, subject and a summary, never bodies." },
      ],
    },
  }),
];
