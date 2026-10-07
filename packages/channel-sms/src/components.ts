/** The SMS channel's components: texts, booking reminders, speed to lead and its parts. */
import { defineComponent } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { cadenceId } from "@wren/core/workflows";
import { REMINDERS, remindersSettingsSchema, TEXTS, textsSettingsSchema } from "./clients.js";

/** One step of a text follow-up on the spine (follow.ts). */
export const TOUCH = "sms.touch";
/** Speed to lead's texts (speed.ts): the first, then the follow-up's. */
export const SPEED = "speed-to-lead";
/** The text follow-up as a part: speed to lead's cadence, reusable by any template. */
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
    name: "First text",
    blurb: "Texts a new lead from the door within a minute, if they agreed to texts.",
    icon: "flag",
    for: "client",
    ready: true,
    missing: [],
    requires: { components: [TEXTS] },
    effects: ["sends"],
    in: [{ id: "forms", label: "forms", kind: "form" }],
    out: [
      { id: "texted", label: "leads texted", kind: "lead" },
      { id: "untexted", label: "not texted", kind: "lead" },
    ],
    hypothesis: {
      from: "Speed to lead, 2026-10-07",
      guesses: [
        {
          is: "change",
          says: "Which form: the client's site, Meta lead forms, a CRM.",
          built: "the door's hook, with a field map per hook",
        },
        { is: "change", says: "The copy.", built: "the speed-to-lead#1 template" },
        {
          is: "change",
          says: "The hours it may text a lead who asked.",
          built: "WREN_SMS_FORM_WINDOW and WREN_SMS_FORM_DAYS",
        },
        {
          is: "fixed",
          says: "Only someone who agreed to texts gets one; the rest go to the call.",
        },
      ],
    },
  }),
  defineComponent({
    id: "speed_to_lead",
    stage: "follow",
    channels: ["text", "voice"],
    name: "Speed to lead",
    blurb: "Texts a new lead within a minute, calls them, and follows up until they book.",
    icon: "clock",
    for: "client",
    ready: true,
    missing: [],
    inside: "speed_to_lead.steps",
    requires: { components: [TEXTS] },
    effects: ["sends", "spends"],
    in: [{ id: "forms", label: "new leads", kind: "form" }],
    out: [{ id: "booked", label: "calls booked", kind: "call" }],
    hypothesis: {
      from: "Designed 2026-10-05, built 2026-10-07",
      guesses: [
        { is: "change", says: "The first text's copy.", built: "the speed-to-lead#1 template" },
        { is: "change", says: "How long after the text it calls.", built: "the call wire's wait" },
        {
          is: "change",
          says: "The call plan: tries, gaps, hours, and who talks.",
          built: null,
        },
        {
          is: "change",
          says: "Where leads come in: Meta forms, the site, a CRM's webhook.",
          built: "the door's hook",
        },
        {
          is: "needs",
          says: "The follow-up sub-part for anyone who doesn't pick up.",
          built: FOLLOW_UP,
        },
        { is: "fixed", says: "The first text goes within a minute of the form." },
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
    missing: [],
    inside: cadenceId(SPEED),
    requires: { components: [TEXTS] },
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
