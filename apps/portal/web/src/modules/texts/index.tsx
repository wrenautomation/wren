/** Texts: a client's texting threads (O4), from its own database; Wren's team replies. */
import { segments } from "@wren/channel-sms/templates";
import type { Action, RecordExtras } from "@wren/ui";
import type { ListPage, Module } from "../../module.js";

const THREAD = "sms.thread";
const threads = (view: string) => `/texts/threads?view=${view}`;

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

type Message = { id: number; at: string; direction: "in" | "out"; body: string; state: string };

/** The thread's texts, oldest first: theirs plain, ours marked. */
const threadExtras: NonNullable<ListPage["extras"]> = (detail) => {
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
  ],
};
