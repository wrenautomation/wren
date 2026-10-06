/**
 * Calendar: calls booked on our own calendar (designs/2026-10-06-calendar.md). Upcoming first,
 * then past calls to mark held or no-show, the no-shows, and cancelled. Open hours live in the
 * Booking calendar part's settings, in the Shop.
 */
import type { Action } from "@wren/ui";
import type { Module } from "../../module.js";

const said = (line: string) => () => line;

const CALL_ACTIONS: Action[] = [
  {
    id: "calendar.held",
    label: "Held",
    handler: "calendar/held",
    undo: "calendar/clear",
    bulk: true,
    key: "h",
    when: { status: ["past", "no_show"] },
    done: said("Marked held"),
  },
  {
    id: "calendar.noShow",
    label: "No-show",
    handler: "calendar/noShow",
    undo: "calendar/clear",
    bulk: true,
    key: "n",
    when: { status: ["past", "held"] },
    done: said("Marked no-show"),
  },
  {
    id: "calendar.cancel",
    label: "Cancel call",
    handler: "calendar/cancel",
    ask: { field: "reason", label: "Why? They don't see this." },
    confirm: "Cancel the call? They get an email and we remove the invite.",
    when: { status: ["upcoming"] },
    done: said("Cancelled. They got an email."),
  },
];

export const calendar: Module = {
  id: "calendar",
  name: "Calendar",
  component: "calendar.booking",
  icon: "clock",
  blurb: "Calls booked on your page, and whether each one showed.",
  requires: { audience: "team" },
  pages: [
    {
      id: "overview",
      label: "Overview",
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
      template: "list",
      record: "calendar.booking",
      actions: CALL_ACTIONS,
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
  ],
};
