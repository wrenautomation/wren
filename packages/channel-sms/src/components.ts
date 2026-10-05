/** The SMS channel's components: texts, booking reminders, site form follow-ups. */
import { defineComponent } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { REMINDERS, remindersSettingsSchema, TEXTS, textsSettingsSchema } from "./clients.js";

const FOR_WREN = "Texts from Wren's numbers and reads Wren's main database, not per client";

export const SMS_COMPONENTS = [
  defineComponent({
    id: TEXTS,
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
  }),
  defineComponent({
    id: REMINDERS,
    name: "Call reminders",
    blurb: "Texts each booked call the day before.",
    icon: "clock",
    for: "client",
    ready: true,
    missing: [],
    settings: remindersSettingsSchema,
    requires: { components: [TEXTS], accounts: ["calcom"] },
    effects: ["sends"],
  }),
  defineComponent({
    id: "sms.forms",
    name: "Form follow-up",
    blurb: "Texts a site applicant who asked for texts.",
    icon: "flag",
    for: "client",
    ready: false,
    missing: [FOR_WREN, "Reads Wren's own site's form"],
    requires: { components: ["sms.texts"] },
    effects: ["sends"],
  }),
];
