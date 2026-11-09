/**
 * Our own booking calendar (designs/2026-10-06-calendar.md), replacing Cal.com: Wren's, and each
 * client's on its own host, its own Google Calendar and its own database.
 */
import { defineComponent } from "@wren/core/components";
import {
  briefSettingsSchema,
  CALL_BRIEF,
  CALL_OUTCOME,
  outcomeSettingsSchema,
} from "./calls/settings.js";
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
      services: ["BookingPage", "ClientBookingPage", "CalendarConsole"],
      records: ["calendar.booking", "calendar.recording"],
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
  defineComponent({
    id: CALL_BRIEF,
    stage: "book",
    name: "Pre-call brief",
    blurb:
      "Who booked, how they came in, their words, the dossier and signals, and what to ask, on the call's page.",
    icon: "board",
    for: "client",
    wrenSettings: true,
    ready: true,
    missing: [],
    settings: briefSettingsSchema,
    provides: { services: ["CallBriefBuild"] },
    in: [{ id: "calls", label: "booked calls", kind: "call" }],
    out: [{ id: "ready", label: "briefs ready", kind: "call" }],
    hypothesis: {
      from: "Designed 2026-10-07 from the dossier and the threads",
      guesses: [
        { is: "change", says: "What it holds, per offer.", built: null },
        {
          is: "change",
          says: "How long before the call it's rebuilt and pinged.",
          built: "settings.leadMinutes",
        },
        { is: "change", says: "Whether the model adds questions.", built: "settings.questions" },
        { is: "needs", says: "A ping to the client's own rep, not only Wren's team.", built: null },
        { is: "fixed", says: "Every line names its source and date; the model adds no facts." },
      ],
    },
  }),
  defineComponent({
    id: CALL_OUTCOME,
    stage: "book",
    name: "Call outcome",
    blurb: "Marks how each call went: won, not yet with the reason, no-show, or not a fit.",
    icon: "check",
    for: "client",
    wrenSettings: true,
    ready: true,
    missing: [],
    settings: outcomeSettingsSchema,
    provides: {},
    in: [{ id: "calls", label: "calls held", kind: "call" }],
    out: [
      { id: "won", label: "clients won", kind: "client" },
      { id: "later", label: "not yet", kind: "lead" },
    ],
    hypothesis: {
      from: "Designed 2026-10-07 with speed to lead's dial outcomes",
      guesses: [
        { is: "change", says: "The not-yet reasons, per offer.", built: "settings.reasons" },
        {
          is: "needs",
          says: "A rebook for a no-show, once William says what it sends.",
          built: null,
        },
        { is: "fixed", says: "A person marks it; nothing guesses." },
      ],
    },
  }),
];
