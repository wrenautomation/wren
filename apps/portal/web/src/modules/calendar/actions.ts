/** What can be done to a call: the Calls list and the Schedule's side panel share them. */
import type { Action } from "@wren/ui";
import { outcomeActions } from "../calls/actions.js";

const said = (line: string) => () => line;

export const CALL_ACTIONS: Action[] = [
  ...outcomeActions("calendar", { prefix: "calendar.", reasonFrom: "outcomeReason" }),
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

/** A client's: the same, and cancel says what its sends flag decides. */
export const CLIENT_CALL_ACTIONS: Action[] = CALL_ACTIONS.map((a) =>
  a.id === "calendar.cancel"
    ? {
        ...a,
        confirm:
          "Cancel the call? It comes off your calendar. If sending is on, they get an email.",
        done: said("Cancelled."),
      }
    : a,
);
