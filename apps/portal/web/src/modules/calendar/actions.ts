/** What can be done to a call: the Calls list and the Schedule's side panel share them. */
import type { Action } from "@wren/ui";

const said = (line: string) => () => line;

export const CALL_ACTIONS: Action[] = [
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
