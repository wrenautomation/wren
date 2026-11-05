import { exact, type MessageKind, MessagePreview, type RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";

/** `@wren/starling-outbound`'s preview data: the app, who it comes from, its cap. */
type Dm = { site: string; from: string | null; max: number };

type Message = {
  id: number;
  at: string;
  direction: "in" | "out";
  kind: string;
  subject: string | null;
  body: string;
  state: string;
};

/** What became of one of ours short of sent. */
const UNSENT: Record<string, string> = {
  queued: "queued",
  sending: "sending",
  failed: "didn't send",
  unknown: "may not have sent",
  skipped: "skipped",
};
const whose = (m: Message) =>
  m.direction === "in"
    ? "They wrote"
    : `${m.kind === "connect" ? "Our invite" : "Ours"}${UNSENT[m.state] ? `, ${UNSENT[m.state]}` : ""}`;

type DmKind = Extract<MessageKind, { kind: "dm" }>;
const kindOf = (dm: Dm): DmKind => ({
  kind: "dm",
  site: dm.site,
  max: dm.max,
  ...(dm.from ? { from: dm.from } : {}),
});

/** The thread oldest first, above the reply box; then our last message as they saw it. */
export const dmExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const d = detail as { messages?: Message[]; dm?: Dm } | null;
  const messages = d?.messages ?? [];
  const last = messages.findLast((m) => m.direction === "out");
  return {
    lead: (
      <section className="grid gap-1.5">
        <h3 className="text-[13px] font-medium text-(--ui-ink-2)">Messages</h3>
        {messages.length ? (
          <ul className="grid gap-3 text-[14px]">
            {messages.map((m) => (
              <li key={m.id} className="grid gap-0.5">
                <span className="text-[13px] text-(--ui-ink-2)">
                  {whose(m)} · {exact(new Date(m.at))}
                </span>
                {m.subject ? <b>{m.subject}</b> : null}
                {m.body ? (
                  <span className="whitespace-pre-wrap">{m.body}</span>
                ) : (
                  <span className="text-(--ui-ink-3)">No note.</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-(--ui-ink-2)">No messages yet.</p>
        )}
      </section>
    ),
    sections: [
      ...(last?.body && d?.dm
        ? [
            [
              "How our last one looked",
              <MessagePreview
                key="looks"
                message={{ ...kindOf(d.dm), subject: last.subject }}
                body={last.body}
              />,
            ] as [string, React.ReactNode],
          ]
        : []),
    ],
  } satisfies RecordExtras;
};

/** The draft box's preview: the thread's app and our handle on it, from the detail. */
export const dmLooks = (detail: unknown) => {
  const dm = (detail as { dm?: Dm } | null)?.dm;
  return dm ? kindOf(dm) : null;
};
