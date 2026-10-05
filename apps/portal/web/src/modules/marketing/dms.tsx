/** DMs as the person meets them on a laptop and a phone: a thread's replies, and William's copy. */
import { type RenderFields, render } from "@wren/outreach/sequences";
import { type MessageKind, MessagePreview, type RecordExtras } from "@wren/ui";
import { call } from "../../api.js";
import type { ListPage } from "../../module.js";

/** `@wren/outreach`'s preview data: the app, who it comes from, its cap. */
type Dm = { site: string; from: string | null; max: number };
/** A template slot's message: `slot` where its words go. */
type Frame = { subject: string | null; body: string; slot: string };
type CopyDetail = { dm?: Dm & { frame: Frame }; sample?: RenderFields } | null;

type Message = {
  id: number;
  at: string;
  direction: "in" | "out";
  subject: string | null;
  body: string;
  state: string;
};

type DmKind = Extract<MessageKind, { kind: "dm" }>;
const kindOf = (dm: Dm): DmKind => ({
  kind: "dm",
  site: dm.site,
  max: dm.max,
  ...(dm.from ? { from: dm.from } : {}),
});

/** The slot's words with sample facts, in its message; a field it can't fill shows as typed. */
function copyKind(d: CopyDetail): MessageKind | null {
  if (!d?.dm || !d.sample) return null;
  const { frame } = d.dm;
  const sample = d.sample;
  const fill = (text: string) => {
    let words = text.trim();
    try {
      words = render(words, sample);
    } catch {
      // Saving says why.
    }
    return {
      subject: frame.subject?.replace(frame.slot, words) ?? null,
      body: frame.body.replace(frame.slot, words),
    };
  };
  return { ...kindOf(d.dm), fill };
}

const get = <T,>(record: string, id: string | number) =>
  call<{ detail?: T }>("console/recordsGet", { record, id: String(id) }).then((r) => r.detail);

/** The thread oldest first, then our last message as they saw it. */
export const dmExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const d = detail as { messages?: Message[]; dm?: Dm } | null;
  const messages = d?.messages ?? [];
  const last = messages.findLast((m) => m.direction === "out");
  return {
    sections: [
      [
        "Messages",
        messages.length ? (
          <ul key="messages" className="grid gap-3 text-[14px]">
            {messages.map((m) => (
              <li key={m.id} className="grid gap-0.5">
                <span className="text-[13px] text-(--ui-ink-2)">
                  {m.direction === "in" ? "They wrote" : `We sent (${m.state})`} ·{" "}
                  {m.at.slice(0, 16).replace("T", " ")}
                </span>
                {m.subject ? <b>{m.subject}</b> : null}
                <span className="whitespace-pre-wrap">{m.body}</span>
              </li>
            ))}
          </ul>
        ) : (
          "No messages yet."
        ),
      ],
      ...(last && d?.dm
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

/** The reply box's preview: the thread's app and our handle on it. */
export const dmPreview = (id: string | number) =>
  get<{ dm?: Dm }>("marketing.dm", id).then((d) => (d?.dm ? kindOf(d.dm) : null));

/** A slot in its message with sample facts, or that it's empty. */
export const copyExtras: NonNullable<ListPage["extras"]> = (detail, { row }) => {
  const kind = copyKind(detail as CopyDetail);
  const body = String(row.body ?? "");
  return {
    sections: [
      [
        "How it looks",
        kind && body ? (
          <MessagePreview key="looks" message={kind} body={body} />
        ) : (
          "Empty: this message never goes."
        ),
      ],
    ],
  } satisfies RecordExtras;
};

/** The edit box's preview, filled as you type. */
export const copyPreview = (id: string | number) =>
  get<CopyDetail>("marketing.dm_copy", id).then((d) => copyKind(d ?? null));
