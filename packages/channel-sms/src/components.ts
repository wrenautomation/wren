/** The SMS channel's components: texts, booking reminders, site form follow-ups. */
import { defineComponent } from "@wren/core/components";

const FOR_WREN = "Texts from Wren's numbers and reads Wren's main database, not per client";

export const SMS_COMPONENTS = [
  defineComponent({
    id: "sms.texts",
    name: "Texts",
    blurb: "Texts leads from local numbers, paced, with replies sorted.",
    icon: "reply",
    for: "client",
    ready: false,
    missing: [FOR_WREN],
    provides: {
      services: ["SmsSender", "SmsEvents", "SmsDesk", "SmsWatch"],
      loops: ["SmsSender", "SmsWatch"],
    },
    effects: ["sends", "spends"],
  }),
  defineComponent({
    id: "sms.reminders",
    name: "Call reminders",
    blurb: "Texts each booked call the day before.",
    icon: "clock",
    for: "client",
    ready: false,
    missing: [FOR_WREN, "Reads Wren's cal.com bookings only"],
    requires: { components: ["sms.texts"] },
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
