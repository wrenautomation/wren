/** Our own booking calendar (designs/2026-10-06-calendar.md), replacing Cal.com. */
import { defineComponent } from "@wren/core/components";
import { calendarSettingsSchema } from "./rules.js";

export const CALENDAR_COMPONENTS = [
  defineComponent({
    id: "calendar.booking",
    stage: "book",
    channels: ["web", "email", "text"],
    name: "Booking calendar",
    blurb:
      "A booking page on your site: open times from your calendar, a Meet link, reminders, and follow-ups stop when someone books.",
    icon: "clock",
    for: "client",
    ready: false,
    missing: ["Not built per client yet: books on Wren's own calendar only"],
    wrenSettings: true,
    requires: { accounts: ["google_calendar"] },
    settings: calendarSettingsSchema,
    effects: ["sends"],
    provides: {
      services: ["Calendar", "CalendarConsole"],
      records: ["calendar.booking"],
      apps: ["calendar"],
    },
    out: [
      {
        id: "booked",
        label: "booked calls",
        kind: "call",
        count: { record: "calendar.booking", view: "booked" },
      },
    ],
    hypothesis: {
      from: "Wren's own intro calls, 2026-10",
      guesses: [
        { is: "change", says: "Open hours, zone, length and notice.", built: "settings.hours" },
        { is: "change", says: "Whose Google calendar.", built: "settings.account" },
        { is: "change", says: "The call's name.", built: "settings.title" },
        { is: "needs", says: "The page on the client's own site.", built: null },
        {
          is: "fixed",
          says: "One call per slot, held by Postgres; a booking stops follow-ups like a reply.",
        },
        { is: "fixed", says: "Texts only to people who said yes, through the texts part." },
      ],
    },
  }),
];
