/** A reply in the Replies queue: what they wrote leads, and Mark booked undoes for 10 seconds. */
import type { Action, RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";
import { MAIL, MAIL_BODY } from "./email.js";

export const REPLY_ACTIONS: Action[] = [
  {
    id: "reactivation.book",
    label: "Mark booked",
    handler: "reactivation/book",
    undo: "reactivation/unbook",
    key: "b",
    bulk: true,
    when: { status: ["warm", "other"] },
    sets: { status: "booked" },
    done: (answer) => {
      const n = (answer as { done?: unknown[] }).done?.length ?? 0;
      return n ? `${n === 1 ? "1 meeting" : `${n} meetings`} booked` : "Already booked";
    },
  },
];

const FIRST = "Replies land here. The first emails go out after you approve them.";
export const REPLY_EMPTY = {
  warm: FIRST,
  booked: "Replies you mark booked show here.",
  all: FIRST,
};

export const replyExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const d = detail as { text: string; from: string | null };
  return {
    lead: d.text ? (
      <div className={MAIL}>
        <p className={MAIL_BODY}>{d.text}</p>
      </div>
    ) : null,
    facts: d.from ? [["From", d.from]] : [],
  } satisfies RecordExtras;
};
