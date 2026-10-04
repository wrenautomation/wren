/** A reply in the Replies queue: what they wrote leads, and Mark booked undoes for 10 seconds. */
import { type Action, type RecordExtras, Tag } from "@wren/ui";
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

/** The demo's Replies while empty: what happens when someone replies, framed as an example. */
export const REPLY_EXAMPLE = (
  <section className="mt-2 max-w-[72ch] rounded-(--ui-radius) border border-dashed border-(--ui-ink-3) px-5 py-4 text-[14.5px] leading-[1.6] text-pretty">
    <Tag>Example</Tag>
    <h2 className="mt-3 text-[15px] font-semibold">When someone replies</h2>
    <p className="text-(--ui-ink-2)">
      Nobody replies to a sample firm. Here's what happens when someone replies to yours.
    </p>
    <ol className="mt-3 list-decimal space-y-2 pl-5">
      <li>
        Their follow-up stops. Each person gets one, 4 business days after the first email, and only
        if they haven't replied.
      </li>
      <li>
        Wren reads the reply and sorts it: interested, wants a meeting, not now, referred someone,
        wrong person or not interested.
      </li>
      <li>
        If they're interested or want a meeting, Wren forwards it to the recruiter the email was
        written as. It shows here under Interested, like this:
        <blockquote className="my-2 border-l-2 border-(--ui-ink-3) pl-3 text-(--ui-ink-2) italic">
          "Good timing. We just opened two engineering roles. Free Thursday afternoon?"
        </blockquote>
        <span className="text-[13px] text-(--ui-ink-2)">
          They said: Wants a meeting. Passed to: your recruiter.
        </span>
      </li>
      <li>Once the call is booked, mark it booked. It counts under Meetings booked.</li>
    </ol>
  </section>
);

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
