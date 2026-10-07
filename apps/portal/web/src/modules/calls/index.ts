/**
 * Calls: a client's booked calls, each with its pre-call brief and how it went
 * (designs/2026-10-07-close-brief-outcome.md). Served from the client's own database once the
 * Call outcome part is installed. Wren's own calls are under Inbox > Calls.
 */
import type { ListPage, Module } from "../../module.js";
import { EMAIL_CALL_ACTIONS } from "./actions.js";
import { callExtras } from "./brief.js";

const RECORD = "email.call";

/** A `call_bookings` call's page: the brief, and Rebuild from inside it. */
export const emailCallExtras: NonNullable<ListPage["extras"]> = (detail, { row, act }) =>
  callExtras(detail, row, { reason: "reason", rebuild: () => act("email.callBrief") });

/** The Calls list: Wren's Inbox and a client's Calls app share it. */
export const callsPage = (empty: string): ListPage => ({
  id: "calls",
  label: "Calls",
  template: "list",
  record: RECORD,
  columns: ["who", "company", "status", "start", "campaign", "reason"],
  count: { status: ["past"] },
  empty: {
    upcoming: `No call is booked. ${empty}`,
    past: "Calls wait here once they're over, until you say how they went.",
    marked: "Calls you've marked show here.",
    booked: empty,
    cancelled: "No call was cancelled.",
    all: empty,
  },
  actions: EMAIL_CALL_ACTIONS,
  extras: emailCallExtras,
});

export const calls: Module = {
  id: "calls",
  name: "Calls",
  component: "calls.outcome",
  icon: "phone",
  blurb: "Booked calls, a brief before each, and how each went.",
  pages: [
    {
      id: "overview",
      label: "Overview",
      template: "overview",
      tiles: [
        { label: "Upcoming", record: RECORD, href: "/calls/calls?view=upcoming" },
        { label: "To mark", record: RECORD, href: "/calls/calls?view=past", needs: true },
        { label: "Booked", record: RECORD, href: "/calls/calls?view=booked", period: 30 },
        { label: "Marked", record: RECORD, href: "/calls/calls?view=marked", period: 30 },
      ],
      top: [
        {
          label: "Next calls",
          record: RECORD,
          href: "/calls/calls?view=upcoming",
          fields: ["company", "start"],
          empty: "No call is booked.",
        },
      ],
    },
    callsPage("Calls booked on your page show here."),
  ],
};
