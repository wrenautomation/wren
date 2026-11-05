/** The SMS channel's components: texts, booking reminders, the text follow-up and its step. */
import { defineComponent } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { cadenceId } from "@wren/core/workflows";
import { REMINDERS, remindersSettingsSchema, TEXTS, textsSettingsSchema } from "./clients.js";

/** One step of a text follow-up on the executor (follow.ts). */
export const TOUCH = "sms.touch";
/** The text follow-up's cadence and copy (`speed-to-lead#2-4`). */
export const SPEED = "speed-to-lead";
/** The text follow-up as a part, reusable by any template. */
export const FOLLOW_UP = "sms.follow_up";
export const SMS_COMPONENTS = [
  defineComponent({
    id: TEXTS,
    stage: "reach",
    channels: ["text"],
    name: "Texts",
    blurb: "Texts leads from local numbers, paced, with replies sorted.",
    icon: "reply",
    for: "client",
    ready: true,
    missing: [],
    settings: textsSettingsSchema,
    requires: { accounts: ["telnyx"] },
    provides: {
      services: ["SmsSend", "SmsEvents", "SmsDesk", "SmsUpkeep", "SmsForms", "SmsConsole"],
      loops: ["SmsSend", "SmsUpkeep"],
    },
    effects: ["sends", "spends"],
    clientLoops: (client) => [
      { service: "SmsSend", key: clientKey(client, "fleet") },
      { service: "SmsUpkeep", key: clientKey(client, "daily") },
    ],
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [
      {
        id: "replied",
        label: "texts answered",
        kind: "reply",
        count: { record: "marketing.text_contact", view: "replied" },
      },
    ],
    hypothesis: {
      from: "Wren's recruiting text sequence, 2026-10",
      guesses: [
        { is: "change", says: "Copy and steps per niche.", built: "niche.smsSequences" },
        {
          is: "change",
          says: "A text becomes one step of a cadence across channels, beside email, voicemail and calls.",
          built: "follow_up",
        },
        { is: "change", says: "The name a text signs with.", built: "settings.senderName" },
        {
          is: "needs",
          says: "The client's own registered campaign for US numbers.",
          built: "settings.campaignId",
        },
        { is: "fixed", says: "Texts are paced, and STOP opts a number out of everything." },
      ],
    },
  }),
  defineComponent({
    id: REMINDERS,
    stage: "book",
    channels: ["text"],
    name: "Call reminders",
    blurb: "Texts each booked call the day before.",
    icon: "clock",
    for: "client",
    ready: true,
    missing: [],
    settings: remindersSettingsSchema,
    requires: { components: [TEXTS], accounts: ["calcom"] },
    effects: ["sends"],
    in: [{ id: "calls", label: "booked calls", kind: "call" }],
    out: [{ id: "reminded", label: "calls reminded", kind: "call" }],
    hypothesis: {
      from: "Wren's booked calls, 2026-10",
      guesses: [
        { is: "change", says: "How long before the call, and how many reminders.", built: null },
        {
          is: "change",
          says: "The copy, per client.",
          built: "the client's reminder.day-before template",
        },
        { is: "fixed", says: "Only a call still on the calendar gets a reminder." },
      ],
    },
  }),
  defineComponent({
    id: FOLLOW_UP,
    stage: "follow",
    channels: ["text"],
    name: "Text follow-up",
    blurb: "Texts a lead on day 1, 3 and 7 after the first, until they answer, book or say stop.",
    icon: "cycle",
    for: "client",
    ready: true,
    inside: cadenceId(SPEED),
    requires: { components: [TEXTS] },
    provides: { templates: [2, 3, 4].map((n) => `sms:texts/${SPEED}#${n}`) },
    effects: ["sends"],
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [
      { id: "replied", label: "replies", kind: "reply" },
      { id: "quiet", label: "every text sent", kind: "lead" },
    ],
    hypothesis: {
      from: "Speed to lead, 2026-10-07",
      guesses: [
        { is: "change", says: "The copy of each text.", built: "the speed-to-lead#2-4 templates" },
        { is: "change", says: "The days between texts.", built: "each step's wait" },
        {
          is: "fixed",
          says: "Stops on a reply, a booking, STOP, or another channel's sequence holding them.",
        },
      ],
    },
  }),
  defineComponent({
    id: TOUCH,
    stage: "follow",
    channels: ["text"],
    name: "Text step",
    blurb: "One text of a follow-up, queued when its wait is over, unless they answered.",
    icon: "reply",
    for: "client",
    ready: true,
    requires: { components: [TEXTS] },
    effects: ["sends"],
    in: [{ id: "lead", label: "lead", kind: "lead" }],
    out: [
      { id: "sent", label: "sent", kind: "lead" },
      { id: "replied", label: "answered", kind: "reply" },
    ],
    hypothesis: {
      from: "Wren's text sequences, moved onto the executor 2026-10-05",
      guesses: [
        {
          is: "change",
          says: "Which step of the sequence's copy it sends: the node's step.",
          built: null,
        },
        {
          is: "needs",
          says: "One person across channels, so a cadence can mix texts with email and DMs.",
          built: null,
        },
        { is: "fixed", says: "The sender still paces every text; a touch only queues it." },
      ],
    },
  }),
];
