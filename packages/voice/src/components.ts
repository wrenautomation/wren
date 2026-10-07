/**
 * The voice agent as a Shop part (designs/2026-10-06-voice-agent.md). In development until setup:
 * its settings, test calls and latency work now, on fakes; nothing dials or answers a phone yet.
 */
import { defineComponent } from "@wren/core/components";
import { agentSettingsSchema, VOICE_AGENT } from "./agent.js";

/** Speed to lead's call (call-now.ts): "Call now" for the rep until a dialer is set up. */
export const CALL_NOW = "voice.call_now";

export const VOICE_COMPONENTS = [
  defineComponent({
    id: CALL_NOW,
    stage: "follow",
    channels: ["voice"],
    name: "Call now",
    blurb: 'Puts "Call now" in front of the client\'s rep, or dials once voice is set up.',
    icon: "phone",
    for: "client",
    // Its step runs per client inside speed to lead, which installs it: "Call now" for the rep.
    // The dialer is the voice agent's, still in development.
    ready: true,
    comesWith: "speed_to_lead",
    requires: { components: ["sms.texts"] },
    effects: ["sends"],
    in: [{ id: "leads", label: "leads to call", kind: "lead" }],
    out: [{ id: "booked", label: "booked already", kind: "call" }],
    hypothesis: {
      from: "Speed to lead, 2026-10-07",
      guesses: [
        { is: "change", says: "How long after the text it calls.", built: "the wire's wait" },
        { is: "change", says: "Who calls: the rep, or the voice dialer.", built: null },
        { is: "fixed", says: "A lead who booked isn't called." },
        {
          is: "fixed",
          says: "The dialer calls only with written AI-call consent, in quiet hours' bounds, never a suppressed number.",
        },
      ],
    },
  }),
  defineComponent({
    id: VOICE_AGENT,
    stage: "follow",
    channels: ["voice"],
    name: "Voice agent",
    blurb: "Answers and makes calls for the client, qualifies the lead and books the call.",
    icon: "phone",
    for: "client",
    ready: false,
    planned: true,
    missing: [
      "Setup: a voice number, speech vendors picked by measured latency, and live calls. Test calls run now, at $0.",
    ],
    wrenSettings: true,
    settings: agentSettingsSchema,
    effects: ["spends"],
    provides: {
      services: ["VoiceConsole"],
      records: ["voice.call", "voice.latency"],
      apps: ["voice"],
    },
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [
      {
        id: "booked",
        label: "calls booked",
        kind: "call",
        count: { record: "voice.call", view: "booked" },
      },
      { id: "missed", label: "not booked", kind: "lead" },
    ],
    hypothesis: {
      from: "Designed 2026-10-06; test calls only",
      guesses: [
        {
          is: "change",
          says: "The first line and the prompt, per offer.",
          built: "settings.prompt",
        },
        { is: "change", says: "Which tools it may use.", built: "settings.tools" },
        { is: "change", says: "How long a pause ends a turn.", built: "settings.turn" },
        { is: "change", says: "Hours, and who calls are put through to.", built: "settings.hours" },
        { is: "needs", says: "Speech vendors' minutes, priced per call.", built: null },
        {
          is: "fixed",
          says: "Says it's an AI assistant first, and asks before recording where the state needs it.",
        },
        {
          is: "fixed",
          says: "Dials out only with written consent to AI calls, inside quiet hours, never a suppressed number.",
        },
      ],
    },
  }),
];
