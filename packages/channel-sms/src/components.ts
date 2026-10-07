/** The SMS channel's components: texts, booking reminders, site form follow-ups. */
import { defineComponent } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { REMINDERS, remindersSettingsSchema, TEXTS, textsSettingsSchema } from "./clients.js";

/** One step of a text follow-up on the spine (follow.ts). */
export const TOUCH = "sms.touch";

const FOR_WREN = "Texts from Wren's numbers and reads Wren's main database, not per client";

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
      services: ["SmsSender", "SmsEvents", "SmsDesk", "SmsWatch", "SmsConsole"],
      loops: ["SmsSender", "SmsWatch"],
      apps: ["texts"],
    },
    effects: ["sends", "spends"],
    clientLoops: (client) => [
      { service: "SmsSender", key: clientKey(client, "fleet") },
      { service: "SmsWatch", key: clientKey(client, "daily") },
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
    id: "sms.forms",
    stage: "follow",
    channels: ["text"],
    name: "Form follow-up",
    blurb: "Texts a site applicant who asked for texts.",
    icon: "flag",
    for: "client",
    ready: false,
    missing: [FOR_WREN, "Reads Wren's own site's form"],
    requires: { components: ["sms.texts"] },
    effects: ["sends"],
    in: [{ id: "forms", label: "forms", kind: "form" }],
    out: [
      { id: "texted", label: "leads texted", kind: "lead" },
      { id: "untexted", label: "not texted", kind: "lead" },
    ],
    hypothesis: {
      from: "Wren's site applicants, 2026-10",
      guesses: [
        {
          is: "change",
          says: "Which form: the client's site, Meta lead forms, a CRM. This becomes speed to lead's first text.",
          built: null,
        },
        { is: "change", says: "How fast the first text goes.", built: null },
        { is: "fixed", says: "Only someone who asked for texts gets one." },
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
      from: "Wren's text sequences, moved onto the spine 2026-10-05",
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
