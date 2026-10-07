/**
 * How a booked call went: Won, Not yet, No-show, Not a fit. One set of buttons for every call;
 * `service` is whose handlers they call (EmailConsole for `call_bookings`, CalendarConsole for our
 * calendar's own ids). Each one's undo is Clear. Won queues onboarding; Not yet goes back to keep
 * warm in 30 days. Nothing sends to the lead.
 */
import type { Action } from "@wren/ui";

const said = (line: string) => () => line;
/** Every state a call can be marked from: over, or marked already. */
const MARKABLE = ["past", "won", "not_yet", "no_show", "not_fit"] as const;
const from = (but: string) => ({ status: MARKABLE.filter((s) => s !== but) });

export function outcomeActions(
  service: "email" | "calendar",
  ids: { prefix: string; reasonFrom: string },
): Action[] {
  const h = (email: string, calendar: string) =>
    `${service}/${service === "email" ? email : calendar}`;
  const undo = h("callClear", "clear");
  return [
    {
      id: `${ids.prefix}${service === "email" ? "callWon" : "won"}`,
      label: "Won",
      handler: h("callWon", "won"),
      undo,
      bulk: true,
      key: "w",
      when: from("won"),
      done: said("Won. Onboarding is queued."),
    },
    {
      id: `${ids.prefix}${service === "email" ? "callNotYet" : "notYet"}`,
      label: "Not yet",
      handler: h("callNotYet", "notYet"),
      undo,
      key: "y",
      ask: {
        field: "reason",
        from: ids.reasonFrom,
        label: "Why not yet? Timing, budget, a partner's yes, proof.",
      },
      when: from("not_yet"),
      done: said("Not yet. Back to keep warm in 30 days."),
    },
    {
      id: `${ids.prefix}${service === "email" ? "callNoShow" : "noShow"}`,
      label: "No-show",
      handler: h("callNoShow", "noShow"),
      undo,
      bulk: true,
      key: "n",
      when: from("no_show"),
      done: said("Marked no-show"),
    },
    {
      id: `${ids.prefix}${service === "email" ? "callNotFit" : "notFit"}`,
      label: "Not a fit",
      handler: h("callNotFit", "notFit"),
      undo,
      bulk: true,
      key: "f",
      when: from("not_fit"),
      done: said("Marked not a fit"),
    },
  ];
}

/** A `call_bookings` call: the four, and the brief's Rebuild, run from inside the page. */
export const EMAIL_CALL_ACTIONS: Action[] = [
  ...outcomeActions("email", { prefix: "email.", reasonFrom: "reason" }),
  {
    id: "email.callBrief",
    label: "Rebuild brief",
    handler: "email/callBrief",
    inline: true,
    done: said("Brief rebuilt"),
  },
];
