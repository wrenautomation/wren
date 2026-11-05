/**
 * Booked sales calls (`call_bookings`): each with its pre-call brief and how it went
 * (designs/2026-10-07-close-brief-outcome.md). Wren's under Outbound, a client's under Reactivation,
 * once the Call outcome part is installed.
 */
import type { ListPage, Module } from "../../module.js";
import { EMAIL_CALL_ACTIONS } from "./actions.js";
import { callExtras } from "./brief.js";

/** A `call_bookings` call's page: the brief, and Rebuild from inside it. */
const emailCallExtras: NonNullable<ListPage["extras"]> = (detail, { row, act }) =>
  callExtras(detail, row, { reason: "reason", rebuild: () => act("email.callBrief") });

const empty = "Calls booked from a campaign show here.";

export const calls: Module = {
  id: "calls",
  name: "Calls",
  component: "calls.outcome",
  icon: "phone",
  blurb: "Booked calls, a brief before each, and how each went.",
  pages: [
    {
      id: "calls",
      label: "Booked calls",
      about: "Sales calls booked with you, past and coming up.",
      template: "list",
      record: "email.call",
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
    },
  ],
};
