/**
 * Texts: a client's texting threads (O4), from its own database; Wren's team replies. Speed to
 * lead's runs sit beside them: each lead's first text, call and follow-up, and "Call now" until
 * the rep marks it done or the lead books.
 */
import { segments } from "@wren/channel-sms/templates";
import type { Action, RecordExtras } from "@wren/ui";
import type { ListPage, Module } from "../../module.js";

const THREAD = "sms.thread";
const threads = (view: string) => `/texts/threads?view=${view}`;
const SPEED = "sms.speed";
const speed = (view: string) => `/texts/speed?view=${view}`;

const THREAD_ACTIONS: Action[] = [
  {
    id: "sms.reply",
    label: "Text back",
    handler: "sms/reply",
    requires: { audience: "team" },
    ask: { field: "body", label: "Your text", preview: { kind: "sms", parts: segments } },
    key: "r",
    done: () => "Queued. It leaves on the next tick.",
  },
];

/** Closes "Call now": the rep called. How it went is optional. */
const SPEED_ACTIONS: Action[] = [
  {
    id: "sms.callDone",
    label: "Done",
    handler: "sms/callDone",
    each: true,
    bulk: true,
    form: [
      {
        field: "outcome",
        label: "How it went",
        type: "select",
        optional: true,
        options: ["Reached", "Voicemail", "No answer", "Wrong number"],
      },
    ],
    when: { call: ["alerted"] },
    sets: { call: "done" },
    key: "e",
    done: (a) => {
      const n = (a as { done?: unknown[] } | null)?.done?.length ?? 0;
      return n ? "Marked done." : "Nothing to close: booked or done already.";
    },
  },
];

type Message = { id: number; at: string; direction: "in" | "out"; body: string; state: string };

const when = (at: string) =>
  new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

type Step = { step: string; at: string | null; said: string | null; why: string | null };

const SAID: Record<string, string> = {
  queued: "queued",
  sent: "sent",
  would_send: "would send (texts are off)",
  no_consent: "not texted: no consent",
  no_phone: "not texted: no phone",
  refused: "not sent",
  alerted: "Call now",
  done: "called",
  booked: "booked first",
  reached: "reached",
  voicemail: "voicemail",
  no_answer: "no answer",
  wrong_number: "wrong number",
  dialed: "dialed",
  skipped: "skipped",
  enrolled: "texting",
  new: "not started",
  opted_out: "opted out",
};

/** A speed-to-lead run's steps in order, each with its state, when, and why. */
export const speedExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const steps = (detail as { steps?: Step[] } | null)?.steps ?? [];
  return {
    sections: [
      [
        "Steps",
        <ol key="steps" className="grid gap-3 text-[14px]">
          {steps.map((s) => (
            <li key={s.step} className="grid gap-0.5">
              <span>
                {s.step}: {s.said ? (SAID[s.said] ?? s.said) : "not yet"}
              </span>
              {s.at || s.why ? (
                <span className="text-[13px] text-(--ui-ink-2)">
                  {[s.at ? when(s.at) : null, s.why].filter(Boolean).join(" · ")}
                </span>
              ) : null}
            </li>
          ))}
        </ol>,
      ],
    ],
  } satisfies RecordExtras;
};

/** The thread's texts, oldest first: theirs plain, ours marked. */
export const threadExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const messages = (detail as { messages?: Message[] } | null)?.messages ?? [];
  return {
    sections: [
      [
        "Texts",
        messages.length ? (
          <ul key="texts" className="grid gap-3 text-[14px]">
            {messages.map((m) => (
              <li key={m.id} className="grid gap-0.5">
                <span className="text-[13px] text-(--ui-ink-2)">
                  {m.direction === "in" ? "They wrote" : `We sent (${m.state})`} ·{" "}
                  {m.at.slice(0, 16).replace("T", " ")}
                </span>
                <span className="whitespace-pre-wrap">{m.body}</span>
              </li>
            ))}
          </ul>
        ) : (
          "No texts yet."
        ),
      ],
    ],
  } satisfies RecordExtras;
};

export const texts: Module = {
  id: "texts",
  name: "Texts",
  component: "sms.texts",
  icon: "reply",
  blurb: "Texts to leads and their replies, sorted.",
  pages: [
    {
      id: "overview",
      label: "Overview",
      template: "overview",
      tiles: [
        { label: "Their turn", record: THREAD, href: threads("waiting"), needs: true },
        { label: "New", record: THREAD, href: threads("unread") },
        { label: "Threads", record: THREAD, href: threads("all"), period: 30 },
        { label: "Call now", record: SPEED, href: speed("call"), needs: true },
        {
          label: "Time to first text",
          record: SPEED,
          href: speed("all"),
          median: "firstTouchIn",
          none: "No leads yet",
          period: 30,
        },
      ],
      top: [
        {
          label: "Their turn",
          record: THREAD,
          href: threads("waiting"),
          fields: ["company", "lastAt"],
          empty: "Nobody is waiting on a text.",
        },
      ],
    },
    {
      id: "threads",
      label: "Threads",
      template: "list",
      record: THREAD,
      empty: {
        waiting: "Replies that wait on us show here.",
        unread: "New replies show here.",
        all: "Threads show here once a text goes out.",
      },
      actions: THREAD_ACTIONS,
      extras: threadExtras,
    },
    {
      id: "speed",
      label: "Speed to lead",
      template: "list",
      record: SPEED,
      // What fits at 1440; source, email and the booking time are in Columns.
      columns: [
        "who",
        "firstTouch",
        "firstTouchIn",
        "call",
        "outcome",
        "tel",
        "follow",
        "leadAt",
        "phone",
      ],
      empty: {
        call: "Leads to call show here until voice is set up.",
        done: "Calls you mark done show here.",
        all: "Leads from your forms show here.",
        booked: "Leads who book show here.",
      },
      actions: SPEED_ACTIONS,
      extras: speedExtras,
    },
  ],
};
