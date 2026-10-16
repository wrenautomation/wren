/**
 * Calendar: calls booked on our own calendar (designs/2026-10-06-calendar.md). Upcoming first,
 * then past calls to mark (won, not yet, no-show, not a fit), the no-shows, and cancelled. Each
 * call's page leads with its pre-call brief. Open hours live in the Booking calendar part's
 * settings, in the Shop. Two apps at one address: Wren's (its workspace) and a client's (its
 * own database, once Booking calendar is installed). Wren's also has Recordings: calls the Mac
 * recorded, and Record now on the Calls list (designs/2026-10-16-call-recording.md).
 */
import type { ListPage, Module } from "../../module.js";
import { callExtras } from "../calls/brief.js";
import { CALL_ACTIONS, CLIENT_CALL_ACTIONS } from "./actions.js";
import { recorderHead, recordingExtras } from "./recorder.js";
import { Schedule } from "./schedule.js";

/** A calendar call's page: its mirror's brief. Rebuild lives on Inbox > Calls. */
export const bookingExtras: NonNullable<ListPage["extras"]> = (detail, { row }) =>
  callExtras(detail, row, { reason: "outcomeReason" });

export const calendar: Module = {
  id: "calendar",
  name: "Calendar",
  component: "calendar.booking",
  icon: "calendar",
  blurb: "Calls booked on your page, a brief before each, and how each went.",
  requires: { audience: "team" },
  pages: [
    {
      id: "schedule",
      label: "Schedule",
      about: "Your calls on a calendar, by day, week or month.",
      Page: Schedule,
    },
    {
      id: "overview",
      label: "Overview",
      about: "Your calls at a glance.",
      template: "overview",
      tiles: [
        {
          label: "Upcoming",
          record: "calendar.booking",
          href: "/calendar/calls?view=upcoming",
        },
        {
          label: "Booked",
          record: "calendar.booking",
          href: "/calendar/calls?view=booked",
          period: 30,
        },
        {
          label: "To mark",
          record: "calendar.booking",
          href: "/calendar/calls?view=past&status=past",
          needs: true,
        },
        {
          label: "No-shows",
          record: "calendar.booking",
          href: "/calendar/calls?view=no_show",
          period: 30,
        },
      ],
      top: [
        {
          label: "Next calls",
          record: "calendar.booking",
          href: "/calendar/calls?view=upcoming",
          fields: ["start", "offer"],
          empty: "No call is booked.",
        },
      ],
    },
    {
      id: "calls",
      label: "Calls",
      about: "Every booked call, past and coming up.",
      template: "list",
      record: "calendar.booking",
      actions: CALL_ACTIONS,
      extras: bookingExtras,
      head: recorderHead,
      columns: ["name", "status", "start", "offer", "source", "meet"],
      count: { status: ["past"] },
      empty: {
        upcoming: "No call is booked. Calls booked on your page show here.",
        past: "Calls show here once they're over.",
        no_show: "No one missed a call.",
        cancelled: "No call was cancelled.",
        booked: "Calls booked on your page show here.",
      },
    },
    {
      id: "recordings",
      label: "Recordings",
      about: "Calls recorded on the Mac, each with notes and a transcript.",
      template: "list",
      record: "calendar.recording",
      extras: recordingExtras,
      columns: ["who", "started", "mins", "summary", "by"],
      empty: { all: "Calls recorded on the Mac show up here with notes and a transcript." },
    },
  ],
};

/** A client's Calendar: the same pages over its own calls; cancel says what sending decides. */
const { requires: _team, ...shared } = calendar;
export const clientCalendar: Module = {
  ...shared,
  // Only Wren's calls are recorded: a client's has no Recordings and no Record now.
  pages: calendar.pages
    .filter((p) => p.id !== "recordings")
    .map((p) => {
      if (p.id !== "calls") return p;
      const { head: _wren, ...calls } = p as ListPage;
      return { ...calls, actions: CLIENT_CALL_ACTIONS };
    }),
};
