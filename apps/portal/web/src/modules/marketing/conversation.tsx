/**
 * One conversation per Inbox thread (designs/2026-10-07-inbox-reply.md): everything with the
 * person on every channel, oldest at the top; a reply box that sends on the channel picked, or
 * asks for a yes; and a note box for the team, never sent. R puts you in the reply, N in the note.
 */
import type { Permission } from "@wren/core/access";
import type { Row } from "@wren/core/records/serve";
import {
  Button,
  exact,
  Icon,
  type IconName,
  InsertSnippet,
  PlatformMark,
  type RecordAct,
  type RecordExtras,
  relative,
  say,
  Textarea,
} from "@wren/ui";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { WREN } from "../../module.js";
import { notes } from "../notes/api.js";
import { Compose } from "../notes/comments.js";

/** `@wren/content/inbox`'s `Entry`: one line of the timeline. */
export type Entry = {
  id: string;
  at: string;
  channel: "email" | "text" | "dm" | "comment" | "booking" | "touch" | "note";
  direction: "in" | "out" | "note";
  platform: string | null;
  who: string | null;
  body: string;
  subject?: string | null;
  state?: string | null;
  mentions?: string[];
  start?: string;
};
/** `@wren/content/inbox`'s `ReplyOption`: a channel a reply can take. */
export type ReplyOption = {
  channel: "email" | "text" | "dm" | "comment";
  target: string;
  label: string;
  platform: string | null;
  own: boolean;
  off: string | null;
};
export type Conversation = {
  thread: string;
  who: string | null;
  personId: number | null;
  entries: Entry[];
  options: ReplyOption[];
};

const CHANNEL: Record<Entry["channel"], string> = {
  email: "Email",
  text: "Text",
  dm: "DM",
  comment: "Comment",
  booking: "Booking",
  touch: "Activity",
  note: "Note",
};
/** The lines that carry no brand mark: their own icon. */
const ICON: Partial<Record<Entry["channel"], IconName>> = {
  booking: "clock",
  touch: "pulse",
  note: "note",
};
/** What became of ours short of sent. */
const STATE: Record<string, string> = {
  asked: "waiting on a yes",
  queued: "queued",
  sending: "sending",
  failed: "didn't send",
  unknown: "may not have sent",
  skipped: "skipped",
};
/** A snippet's channel, by the box's. */
const SNIPPET: Record<ReplyOption["channel"], string> = {
  email: "email",
  text: "sms",
  dm: "dm",
  comment: "comment",
};

function Mark({ e }: { e: Entry }) {
  const icon = ICON[e.channel];
  if (icon) return <Icon name={icon} size={14} className="text-(--ui-ink-3)" />;
  return <PlatformMark mark={e.platform ?? e.channel} size={14} />;
}

/** A note's words with each `@email` set apart. */
function Tagged({ body }: { body: string }) {
  const parts = body.split(/(@[^\s@]+@[^\s@]+\.[\w-]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("@") && p.includes(".") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the words' own order.
          <b key={i} className="font-medium text-(--ui-accent)">
            {p}
          </b>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Line({ e }: { e: Entry }) {
  const when = new Date(e.at);
  const head = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-(--ui-ink-2)">
      <Mark e={e} />
      <span className="font-medium text-(--ui-ink)">
        {e.direction === "in" ? (e.who ?? "They") : e.direction === "note" ? e.who : "Us"}
      </span>
      <span>{CHANNEL[e.channel]}</span>
      <time dateTime={e.at} title={exact(when)}>
        {relative(when)}
      </time>
      {e.state && STATE[e.state] ? (
        <span className={e.state === "failed" ? "text-(--ui-bad)" : ""}>{STATE[e.state]}</span>
      ) : null}
    </span>
  );
  // Touches and bookings: one quiet line, no bubble.
  if (e.channel === "touch" || e.channel === "booking")
    return (
      <li className="grid gap-0.5 py-1">
        {head}
        <span className="text-[13px] text-(--ui-ink-2)">
          {e.start && e.state !== "cancelled"
            ? `Booked a call for ${exact(new Date(e.start))}.`
            : e.body}
        </span>
      </li>
    );
  const box =
    e.direction === "note"
      ? "border-l-2 border-(--ui-warn) bg-(--ui-warn-tint)"
      : e.direction === "out"
        ? "ml-6 bg-(--ui-fill) max-[480px]:ml-3"
        : "mr-6 border border-(--ui-hair) bg-(--ui-paper) max-[480px]:mr-3";
  return (
    <li className={`grid gap-1 px-3 py-2 ${box}`}>
      {head}
      {e.direction === "note" ? (
        <span className="text-[11px] tracking-wide text-(--ui-warn-ink) uppercase">
          Team only, never sent
        </span>
      ) : null}
      {e.subject ? <b className="text-[14px]">{e.subject}</b> : null}
      <span className="text-[14px] leading-[1.55] whitespace-pre-wrap break-words">
        {e.direction === "note" ? <Tagged body={e.body} /> : e.body || "No words."}
      </span>
    </li>
  );
}

/** The timeline, oldest first, ending at the newest. */
export function Timeline({ entries }: { entries: Entry[] }) {
  const end = useRef<HTMLLIElement>(null);
  const last = entries.at(-1)?.id;
  // The newest in view on open and when a line lands.
  useEffect(() => {
    if (last) end.current?.scrollIntoView({ block: "nearest" });
  }, [last]);
  if (!entries.length) return <p className="text-[14px] text-(--ui-ink-2)">Nothing yet.</p>;
  return (
    <ol aria-label="Conversation" className="m-0 grid list-none gap-2 p-0">
      {entries.map((e) => (
        <Line key={e.id} e={e} />
      ))}
      <li ref={end} aria-hidden="true" className="h-0" />
    </ol>
  );
}

const SELECT =
  "h-8 min-w-0 max-w-full border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink)";

/** What the reply handler answered. */
type Replied = { sent: boolean; asked: number | null; why: string | null };
const answerOf = <T,>(out: unknown): T | null =>
  ((out as { answer?: T } | null)?.answer ?? null) as T | null;

function ReplyBox({
  options,
  draft,
  send,
  act,
  box,
}: {
  options: ReplyOption[];
  /** Words drafted for the thread's own channel already: a comment's or a DM's draft. */
  draft: string;
  /** May this viewer send, or only ask? */
  send: boolean;
  act: RecordAct;
  box: RefObject<HTMLTextAreaElement | null>;
}) {
  const first = options.find((o) => o.own && !o.off) ?? options.find((o) => !o.off) ?? null;
  const [pick, setPick] = useState(first ? `${first.channel}|${first.target}` : "");
  const option = options.find((o) => `${o.channel}|${o.target}` === pick) ?? null;
  const [text, setText] = useState(option?.own ? draft : "");
  const [busy, setBusy] = useState<"send" | "suggest" | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  if (!options.length)
    return (
      <p className="text-[14px] text-(--ui-ink-2)">
        No way to reply here. They have no email, number or DM we can answer.
      </p>
    );
  const where = option ? { channel: option.channel, target: option.target } : null;
  const go = async () => {
    if (!where || !text.trim() || busy) return;
    setBusy("send");
    setSaid(null);
    try {
      const out = answerOf<Replied>(
        await act(send ? "inbox.reply" : "inbox.ask", { ...where, body: text.trim() }),
      );
      setText("");
      if (out?.sent === false || !send)
        setSaid(`Asked. It waits in To approve.${out?.why ? ` ${out.why}` : ""}`);
      else setSaid("Sent.");
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(null);
    }
  };
  const suggest = async () => {
    if (!where || busy) return;
    setBusy("suggest");
    setSaid(null);
    try {
      const out = answerOf<{ text: string | null }>(await act("inbox.suggest", where));
      if (out?.text) {
        setText(out.text);
        setSaid("Suggested. Read it before you send.");
        requestAnimationFrame(() => box.current?.focus());
      } else setSaid("No suggestion this time. Write it yourself.");
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-2">
      <label className="flex flex-wrap items-center gap-2 text-[13px] text-(--ui-ink-2)">
        Reply by
        <select
          className={SELECT}
          value={pick}
          onChange={(e) => {
            setPick(e.target.value);
            setSaid(null);
          }}
        >
          {options.map((o) => (
            <option
              key={`${o.channel}|${o.target}`}
              value={`${o.channel}|${o.target}`}
              disabled={!!o.off}
            >
              {o.label}
              {o.off ? ` (${o.off})` : ""}
            </option>
          ))}
        </select>
      </label>
      <Textarea
        ref={box}
        value={text}
        rows={4}
        maxLength={4000}
        aria-label="Your reply"
        placeholder={option ? `Reply by ${option.label.toLowerCase()}` : "Pick a channel"}
        disabled={!option}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void go();
          }
        }}
        className="text-[14px] leading-[1.55]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="dense"
          tone="primary"
          disabled={!option || !text.trim() || !!busy}
          onClick={() => void go()}
        >
          {busy === "send" ? (send ? "Sending" : "Asking") : send ? "Send" : "Ask to send"}
        </Button>
        <Button
          size="dense"
          tone="quiet"
          disabled={!option || !!busy}
          onClick={() => void suggest()}
        >
          {busy === "suggest" ? "Thinking" : "Suggest"}
        </Button>
        {option ? (
          <InsertSnippet
            box={box}
            value={text}
            onChange={setText}
            channel={SNIPPET[option.channel]}
          />
        ) : null}
        <span className="ml-auto text-[11px] text-(--ui-ink-3) max-[480px]:hidden">
          ⌘ Enter to {send ? "send" : "ask"}
        </span>
      </div>
      {said ? (
        <p role="status" className="text-[13px] text-(--ui-ink-2)">
          {said}
        </p>
      ) : null}
    </div>
  );
}

/** Is the key going to a box? Then it's typing, not a shortcut. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

const people = () => notes(WREN.id, "people");

function Thread({
  c,
  draft,
  send,
  act,
}: {
  c: Conversation;
  draft: string;
  send: boolean;
  act: RecordAct;
}) {
  const reply = useRef<HTMLTextAreaElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const [noting, setNoting] = useState(false);
  // R and N, outside a box: into the reply, into the note.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const to = e.key === "r" ? reply : e.key === "n" ? note : null;
      if (!to?.current) return;
      e.preventDefault();
      to.current.focus();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);
  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <h3 className="text-[13px] font-medium text-(--ui-ink-2)">
          Everything with {c.who ?? "them"}
        </h3>
        <div className="max-h-[560px] overflow-y-auto">
          <Timeline entries={c.entries} />
        </div>
      </section>
      <section className="grid gap-2">
        <h3 className="text-[13px] font-medium text-(--ui-ink-2)">Reply</h3>
        <ReplyBox
          key={c.thread}
          options={c.options}
          draft={draft}
          send={send}
          act={act}
          box={reply}
        />
      </section>
      <section className="grid gap-2">
        <h3 className="text-[13px] font-medium text-(--ui-ink-2)">Note for the team</h3>
        <Compose
          key={c.thread}
          box={note}
          people={people}
          placeholder="Only the team sees it. @ to tag someone."
          button="Add note"
          busy={noting}
          submit={async (body) => {
            setNoting(true);
            try {
              await act("inbox.note", { body });
              return true;
            } catch (err) {
              say.failed(err);
              return false;
            } finally {
              setNoting(false);
            }
          }}
        />
      </section>
    </div>
  );
}

const conversationOf = (detail: unknown): Conversation | null =>
  (detail as { conversation?: Conversation } | null)?.conversation ?? null;

/**
 * The Inbox's detail: the conversation, the reply box and the note box. Send for a viewer who may
 * send here; Ask to send for one who may not.
 */
export const conversationExtras = (
  detail: unknown,
  { row, act, can }: { row: Row; act: RecordAct; can?: readonly Permission[] | undefined },
): RecordExtras => {
  const c = conversationOf(detail);
  if (!c) return { sections: [] };
  const draft = typeof row.draft === "string" ? row.draft : "";
  return {
    lead: <Thread c={c} draft={draft} send={!!can?.includes("effect")} act={act} />,
  };
};

/** To approve's asked reply: the conversation it answers, read only. */
export const askedReplyExtras = (detail: unknown): RecordExtras => {
  const c = conversationOf(detail);
  return c
    ? {
        sections: [
          [
            `Everything with ${c.who ?? "them"}`,
            <div key="thread" className="max-h-[480px] overflow-y-auto">
              <Timeline entries={c.entries} />
            </div>,
          ] as [string, ReactNode],
        ],
      }
    : { sections: [] };
};
