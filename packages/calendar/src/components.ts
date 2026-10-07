/**
 * Our own booking calendar (designs/2026-10-06-calendar.md), replacing Cal.com: Wren's, and each
 * client's on its own host, its own Google Calendar and its own database.
 */
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
    ready: true,
    wrenSettings: true,
    // A client's calendar is the Google account it connected (Accounts), not a setting.
    wrenOnly: ["account"],
    // Wren's own page lists Wren's links from the lander's site.yaml.
    clientOnly: ["contact"],
    requires: { accounts: ["google_calendar"], facts: ["google_calendar.delegated"] },
    // The booker's mail and Google's invite wait on the client's sends flag.
    liveSwitch: true,
    settings: calendarSettingsSchema,
    effects: ["sends"],
    provides: {
      services: ["Calendar", "ClientCalendar", "CalendarConsole"],
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
        {
          is: "change",
          says: "Whose Google calendar.",
          built: "the client's google_calendar account",
        },
        { is: "change", says: "The call's name.", built: "settings.title" },
        {
          is: "needs",
          says: "The page on the client's own site.",
          built: "its own host or the portal",
        },
        {
          is: "fixed",
          says: "One call per slot, held by Postgres; a booking stops follow-ups like a reply.",
        },
        { is: "fixed", says: "Texts only to people who said yes, through the texts part." },
      ],
    },
  }),
];
