/**
 * People > Broadcasts (designs/2026-10-14-customerio-audit.md, B6): one send to a segment, by
 * email or text. The head writes one (plain text with merge fields, as the Newsletter's box) and
 * shows the month's calendar. Every broadcast waits in To approve; nothing sends before that yes.
 * A broadcast's page shows its results on the sent log's ladder, each count a link to its rows,
 * and sends a test to one address. People > Recipients lists who each one went to, and why not.
 */

import type { BroadcastDetail } from "@wren/core/broadcast-records";
import type { Action } from "@wren/ui";
import { ACTIONS, Button, Input, type RecordAct, type RecordExtras, Tag, Textarea } from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ApiError, call } from "../../api.js";
import type { ListPage } from "../../module.js";
import { addDays, dayKey, daysOf, rangeOf, step } from "../calendar/grid.js";
import { ERROR, QUIET, SELECT } from "../work/bits.js";
import { atOf } from "./segments.js";

const said = (err: unknown) => (err instanceof ApiError ? err.message : String(err));
const SMALL = `${SELECT} min-w-0 max-sm:w-full`;
const FIELD = "flex min-w-0 flex-col gap-1 text-[13px] text-(--ui-ink-2) max-sm:basis-full";

type Channel = "email" | "sms";
const CHANNELS: Record<Channel, string> = { email: "Email", sms: "Text" };

interface Context {
  segments: { id: number; name: string; size: number }[];
  topics: { id: number; name: string; publicName: string; channel: string }[];
  fields: string[];
  textMost: number;
  /** What may send here: email needs a sender (a client's: its mailbox and postal address). */
  email: boolean;
  /** Why email can't send yet, and where to fix it. */
  emailUnset: string | null;
  text: boolean;
  testDomain: string | null;
  testPhone: string | null;
}
interface Preview {
  subject: string | null;
  body: string;
  people: number;
  yes: number;
}
interface Start {
  id?: number;
  name: string;
  channel: Channel;
  segmentId: number | null;
  topic: string | null;
  subject: string;
  body: string;
  sendAt: string | null;
  local: boolean;
  /** The version opened on: a save over a newer one is refused. */
  version?: string;
}
interface MonthItem {
  id: number;
  name: string;
  channel: Channel;
  state: string;
  at: string;
}

/** The viewer's own zone: a picked time is read in it. */
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Write one, or change a draft: who, the words, when. Saves a draft or asks for the yes. */
function BroadcastEditor({
  client,
  start,
  onDone,
  send = (input) => call("people/broadcastSave", { ...atOf(client), ...input }),
}: {
  client: string;
  start: Start;
  onDone: (saved: boolean) => void;
  send?: (input: Record<string, unknown>) => Promise<unknown>;
}) {
  const at = atOf(client);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [name, setName] = useState(start.name);
  const [channel, setChannel] = useState<Channel>(start.channel);
  const [segmentId, setSegmentId] = useState<number | null>(start.segmentId);
  const [topic, setTopic] = useState<string | null>(start.topic);
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState(start.body);
  const picked = start.sendAt ? new Date(start.sendAt) : null;
  const [later, setLater] = useState(!!picked);
  const [day, setDay] = useState(picked ? dayKey(picked) : dayKey(addDays(new Date(), 1)));
  const [time, setTime] = useState(picked ? timeOf(picked) : "10:00");
  const [local, setLocal] = useState(start.local);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [unready, setUnready] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "ask" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);
  /** One save at a time, whatever the render says. */
  const flying = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per workspace
  useEffect(() => {
    call<Context>("people/broadcastContext", at).then(
      (c) => {
        setCtx(c);
        if (!c.email && channel === "email") setChannel("sms");
      },
      (e) => setError(said(e)),
    );
  }, [client]);

  const topics = ctx?.topics.filter((t) => t.channel === channel) ?? [];
  // A topic belongs to one channel: switching drops one from the other.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the channel's topics are the input
  useEffect(() => {
    if (!ctx) return;
    if (topics.some((t) => t.name === topic)) return;
    const named = topics.find((t) => t.publicName === topic);
    setTopic((named ?? topics[0])?.name ?? null);
  }, [ctx, channel]);

  const input = () => ({
    ...(start.id ? { id: start.id } : {}),
    name: name.trim(),
    channel,
    segmentId,
    topic,
    subject: channel === "email" ? subject.trim() : null,
    body,
    sendAt: later ? new Date(`${day}T${time}`).toISOString() : null,
    local: later && local,
    zone: ZONE,
  });

  // The words for a sample person and the count follow the edits, a beat after the last.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the fields are the input
  useEffect(() => {
    if (!body.trim()) {
      setPreview(null);
      setUnready(null);
      return;
    }
    const mine = ++asked.current;
    const t = setTimeout(() => {
      call<Preview>("people/broadcastPreview", { ...at, ...input() }).then(
        (p) => {
          if (mine !== asked.current) return;
          setPreview(p);
          setUnready(null);
        },
        (e) => {
          if (mine !== asked.current) return;
          setPreview(null);
          setUnready(said(e));
        },
      );
    }, 400);
    return () => clearTimeout(t);
  }, [channel, segmentId, topic, subject, body]);

  const save = async (ask: boolean) => {
    if (flying.current) return;
    flying.current = true;
    setBusy(ask ? "ask" : "draft");
    setError(null);
    try {
      const body = { ...input(), ask, ...(start.version ? { expect: start.version } : {}) };
      // A new one is made once: a retry of the same words is the same broadcast.
      await ACTIONS.run(`broadcast-save:${client}:${JSON.stringify(body)}`, (requestId) =>
        send({ ...body, requestId }),
      );
      onDone(true);
    } catch (e) {
      setError(said(e));
      setBusy(null);
    } finally {
      flying.current = false;
    }
  };

  if (!ctx)
    return error ? (
      <p className={`m-0 ${ERROR}`} role="alert">
        {error}
      </p>
    ) : (
      <Tag tone="neutral">Loading</Tag>
    );
  const canSave =
    !!name.trim() &&
    !!segmentId &&
    !!topic &&
    !!body.trim() &&
    (channel === "sms" || !!subject.trim());

  return (
    <div className="flex w-full min-w-0 basis-full flex-col gap-4 border border-(--ui-hair) p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className={FIELD}>
          Name
          <Input
            className="w-64 max-sm:w-full"
            value={name}
            maxLength={120}
            placeholder="October check-in"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={FIELD}>
          Channel
          <select
            className={SMALL}
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
          >
            {(Object.keys(CHANNELS) as Channel[]).map((c) => (
              <option key={c} value={c} disabled={c === "email" && !ctx.email}>
                {CHANNELS[c]}
                {c === "email" && !ctx.email ? " (needs setup)" : ""}
              </option>
            ))}
          </select>
          {!ctx.email && ctx.emailUnset ? (
            <span className="text-[12px] text-(--ui-ink-2)">Email: {ctx.emailUnset}</span>
          ) : null}
        </label>
        <label className={FIELD}>
          Segment
          <select
            className={SMALL}
            value={segmentId ?? ""}
            onChange={(e) => setSegmentId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Pick one</option>
            {ctx.segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.size})
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD}>
          Topic
          <select
            className={SMALL}
            value={topic ?? ""}
            onChange={(e) => setTopic(e.target.value || null)}
          >
            {topics.length ? null : <option value="">No topic on this channel</option>}
            {topics.map((t) => (
              <option key={t.id} value={t.name}>
                {t.publicName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {channel === "email" ? (
        <label className="flex flex-col gap-1 text-[13px] text-(--ui-ink-2)">
          Subject
          <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-[13px] text-(--ui-ink-2)">
        {channel === "email" ? "Email" : "Text"}
        <Textarea
          rows={channel === "email" ? 8 : 4}
          value={body}
          placeholder={
            channel === "email"
              ? "Hi {first_name|there},\n\n"
              : "Hi {first_name|there}, ... Reply STOP to stop."
          }
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className={`m-0 text-[13px] ${QUIET}`}>
        Merge fields: {ctx.fields.map((f) => `{${f}}`).join(", ")}. A fallback after a bar:{" "}
        {"{first_name|there}"}.
        {channel === "sms"
          ? ` A text must say STOP. ${body.length} of ${ctx.textMost} characters.`
          : " The unsubscribe footer is added."}
      </p>

      <fieldset className="m-0 flex min-w-0 flex-wrap items-end gap-3 border-0 p-0">
        <legend className="mb-2 p-0 text-[13px] font-medium">When</legend>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="radio" checked={!later} onChange={() => setLater(false)} />
          As soon as it's approved
        </label>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="radio" checked={later} onChange={() => setLater(true)} />
          At a time
        </label>
        {later ? (
          <>
            <Input
              type="date"
              aria-label="Day"
              className="w-40 max-sm:w-full"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
            <Input
              type="time"
              aria-label="Time"
              className="w-32 max-sm:w-full"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
              In each person's own time zone
            </label>
            <span className={`basis-full text-[13px] ${QUIET}`}>
              {local
                ? `Each person gets it at ${time} where they are; ${ZONE} when we don't know.`
                : `${time} in ${ZONE}.`}
            </span>
          </>
        ) : null}
      </fieldset>

      {preview ? (
        <div className="grid gap-2 border border-(--ui-hair) p-3 text-[14px]" role="status">
          <p className="m-0">
            <span className="font-medium">
              {preview.yes} of {preview.people} {preview.people === 1 ? "person" : "people"}
            </span>{" "}
            <span className={QUIET}>
              said yes to this topic now. Suppressions and the frequency cap are checked at send.
            </span>
          </p>
          {preview.subject ? <p className="m-0 font-medium">{preview.subject}</p> : null}
          <p className="m-0 whitespace-pre-wrap">{preview.body}</p>
        </div>
      ) : unready ? (
        <p className={`m-0 text-[14px] ${QUIET}`} role="status">
          Not ready: {unready}
        </p>
      ) : null}

      {error ? (
        <p className={`m-0 ${ERROR}`} role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          size="dense"
          busy={busy === "ask"}
          disabled={!canSave || !!busy}
          onClick={() => save(true)}
        >
          Save and ask
        </Button>
        <Button
          size="dense"
          tone="quiet"
          busy={busy === "draft"}
          disabled={!canSave || !!busy}
          onClick={() => save(false)}
        >
          Save draft
        </Button>
        <Button size="dense" tone="quiet" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <span className="text-[13px] text-(--ui-ink-3)">Nothing sends before To approve.</span>
      </div>
    </div>
  );
}

const STATE_DOT: Record<string, string> = {
  draft: "bg-(--ui-ink-3)",
  waiting: "bg-(--ui-warn)",
  scheduled: "bg-(--ui-ink-2)",
  sending: "bg-(--ui-ink)",
  sent: "bg-(--ui-good)",
  declined: "bg-(--ui-bad)",
};

/** The month's broadcasts on a calendar, by when each goes or went. */
function Month({ client }: { client: string }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [items, setItems] = useState<MonthItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const { from, to } = rangeOf("month", anchor);
    setItems(null);
    call<{ broadcasts: MonthItem[] }>("people/broadcastMonth", {
      ...atOf(client),
      from: from.toISOString(),
      to: to.toISOString(),
    }).then(
      (r) => setItems(r.broadcasts),
      (e) => setError(said(e)),
    );
  }, [client, anchor]);
  const days = daysOf("month", anchor);
  const byDay = new Map<string, MonthItem[]>();
  for (const b of items ?? []) {
    const k = dayKey(new Date(b.at));
    byDay.set(k, [...(byDay.get(k) ?? []), b]);
  }
  const month = anchor.getMonth();
  const today = dayKey(new Date());
  const title = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return (
    <div className="flex w-full min-w-0 basis-full flex-col gap-2 border border-(--ui-hair) p-3">
      <div className="flex items-center gap-2">
        <Button size="dense" tone="quiet" onClick={() => setAnchor(step("month", anchor, -1))}>
          Previous
        </Button>
        <span className="min-w-0 flex-1 text-center text-[14.5px] font-medium">{title}</span>
        <Button size="dense" tone="quiet" onClick={() => setAnchor(step("month", anchor, 1))}>
          Next
        </Button>
      </div>
      {error ? (
        <p className={`m-0 ${ERROR}`} role="alert">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-7 border-t border-l border-(--ui-hair) text-[12px]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className={`border-r border-b border-(--ui-hair) px-1 py-0.5 ${QUIET}`}>
            {d}
          </div>
        ))}
        {days.map((d) => {
          const k = dayKey(d);
          const on = byDay.get(k) ?? [];
          return (
            <div
              key={k}
              className={`flex min-h-16 min-w-0 flex-col gap-0.5 border-r border-b border-(--ui-hair) p-1 max-sm:min-h-11 ${
                d.getMonth() === month ? "" : "bg-(--ui-hover)"
              }`}
            >
              <span className={k === today ? "font-medium text-(--ui-ink)" : QUIET}>
                {d.getDate()}
              </span>
              {on.map((b) => (
                <a
                  key={b.id}
                  href={`/people/broadcasts/${b.id}`}
                  title={`${b.name}, ${CHANNELS[b.channel]}, ${b.state}`}
                  className="flex min-w-0 items-center gap-1 text-(--ui-ink) no-underline"
                >
                  <span className={`size-2 shrink-0 ${STATE_DOT[b.state] ?? "bg-(--ui-ink-3)"}`} />
                  <span className="truncate max-sm:hidden">{b.name}</span>
                </a>
              ))}
            </div>
          );
        })}
      </div>
      {/* A phone's cells hold only dots: the month's broadcasts are listed under them too. */}
      {items?.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] sm:hidden">
          {items.map((b) => (
            <li key={b.id}>
              <a href={`/people/broadcasts/${b.id}`}>
                {new Date(b.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
                {b.name}
              </a>{" "}
              <span className={QUIET}>
                {CHANNELS[b.channel]}, {b.state}
              </span>
            </li>
          ))}
        </ul>
      ) : items ? (
        <p className={`m-0 text-[13.5px] ${QUIET}`}>Nothing this month.</p>
      ) : null}
    </div>
  );
}

/** The list's head: New broadcast opens the editor; Month the calendar. */
function BroadcastsHead({ client, reload }: { client: string; reload: () => void }) {
  const [open, setOpen] = useState<"new" | "month" | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button tone="primary" size="dense" onClick={() => setOpen(open === "new" ? null : "new")}>
          New broadcast
        </Button>
        <Button
          size="dense"
          tone="quiet"
          aria-pressed={open === "month"}
          onClick={() => setOpen(open === "month" ? null : "month")}
        >
          Month
        </Button>
      </div>
      {open === "new" ? (
        <BroadcastEditor
          client={client}
          start={{
            name: "",
            channel: "email",
            segmentId: null,
            topic: null,
            subject: "",
            body: "",
            sendAt: null,
            local: false,
          }}
          onDone={(saved) => {
            setOpen(null);
            if (saved) reload();
          }}
        />
      ) : open === "month" ? (
        <Month client={client} />
      ) : null}
    </>
  );
}

/** How it went, on the sent log's ladder: each count a link to its rows. */
function Results({ d }: { d: NonNullable<BroadcastDetail["results"]> }) {
  return (
    <div className="flex flex-col gap-2 text-[14.5px]">
      {d.ladder.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
          {d.ladder.map((s) => (
            <li key={s.state}>
              <a href={s.link}>
                {s.n} {s.state}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`m-0 ${QUIET}`}>Nothing in the sent log yet.</p>
      )}
      {d.held ? (
        <p className="m-0">{d.held} held by the frequency cap; each goes when it has room.</p>
      ) : null}
      {d.failed ? <p className={`m-0 ${ERROR}`}>{d.failed} failed.</p> : null}
      {d.skipped.length ? (
        <div>
          <p className={`m-0 text-[13.5px] ${QUIET}`}>Never sent:</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {d.skipped.map((s) => (
              <li key={s.why}>
                <a href={s.link}>
                  {s.n} {s.why}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** One copy to one address, marked [test]: ours for email, the operator's phone for a text. */
function TestSend({ row, act }: { row: Record<string, unknown>; act: RecordAct }) {
  const [to, setTo] = useState(String(row.testedTo ?? ""));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const got = (await act("people.broadcastTest", { to: to.trim() })) as { sent?: string };
      setNote({ ok: true, text: `Sent to ${got.sent ?? to.trim()}.` });
    } catch (e) {
      setNote({ ok: false, text: said(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Send a test to"
          className="w-72 max-sm:w-full"
          value={to}
          placeholder={row.channel === "sms" ? "+1..." : "you@ourdomain"}
          onChange={(e) => setTo(e.target.value)}
        />
        <Button size="dense" tone="quiet" busy={busy} disabled={!to.trim() || busy} onClick={run}>
          Send test
        </Button>
      </div>
      {note ? (
        <p className={`m-0 ${note.ok ? `text-[13.5px] ${QUIET}` : ERROR}`} role="status">
          {note.text}
        </p>
      ) : (
        <p className={`m-0 text-[13px] ${QUIET}`}>
          Counts nowhere. Merge fields read as Sam Rivera.
        </p>
      )}
    </div>
  );
}

/** Changed in place until it starts; a waiting or scheduled one asks again. */
function EditSection({
  client,
  row,
  version,
  act,
}: {
  client: string;
  row: Record<string, unknown>;
  version: string | undefined;
  act: RecordAct;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <div>
        <Button size="dense" tone="quiet" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    );
  return (
    <BroadcastEditor
      client={client}
      start={{
        id: Number(row.id),
        name: String(row.name ?? ""),
        channel: row.channel === "sms" ? "sms" : "email",
        segmentId: row.segmentId ? Number(row.segmentId) : null,
        // The row names its topic as the public sees it; the editor matches it back.
        topic: (row.topic as string | null) ?? null,
        subject: String(row.subject ?? ""),
        body: String(row.body ?? ""),
        sendAt: (row.sendAt as string | null) ?? null,
        local: row.local === true,
        ...(version ? { version } : {}),
      }}
      onDone={() => setEditing(false)}
      send={(input) => act("people.broadcastSave", input)}
    />
  );
}

/** Approve and Decline: on its own page and in To approve. */
export const BROADCAST_DECIDE_ACTIONS: Action[] = [
  {
    id: "people.broadcastApprove",
    label: "Approve",
    handler: "people/broadcastApprove",
    confirm: "Approve it? It sends to everyone in its segment who said yes, on its time.",
    key: "a",
    when: { state: ["waiting"] },
    sets: { state: "scheduled" },
    done: () => "Approved. It sends on its time.",
  },
  {
    id: "people.broadcastDecline",
    label: "Decline",
    handler: "people/broadcastDecline",
    key: "x",
    when: { state: ["waiting"] },
    sets: { state: "declined" },
    form: [{ field: "note", label: "Why", optional: true }],
    each: true,
    done: () => "Declined. Nothing was sent.",
  },
];

export const broadcastsPage: ListPage = {
  id: "broadcasts",
  label: "Broadcasts",
  about: "One email or text to a segment, sent once To approve says yes.",
  template: "list",
  record: "people.broadcast",
  columns: ["name", "channel", "state", "segment", "when", "people", "sent", "waiting", "skipped"],
  empty: {
    all: "No broadcasts yet. Write one with New broadcast.",
    upcoming: "Nothing waits to go. Write one with New broadcast.",
    sent: "Nothing sent yet.",
  },
  actions: [
    { id: "people.broadcastSave", label: "Save", handler: "people/broadcastSave", inline: true },
    {
      id: "people.broadcastTest",
      label: "Send test",
      handler: "people/broadcastTest",
      inline: true,
    },
    {
      id: "people.broadcastAsk",
      label: "Ask to send",
      handler: "people/broadcastAsk",
      when: { state: ["draft", "declined"] },
      sets: { state: "waiting" },
      done: () => "In To approve",
    },
    ...BROADCAST_DECIDE_ACTIONS,
    {
      id: "people.broadcastCancel",
      label: "Cancel",
      handler: "people/broadcastCancel",
      when: { state: ["draft", "waiting", "scheduled", "sending"] },
      bulk: true,
      // The people not yet sent are skipped; Restore puts them back on their time.
      undo: "people/broadcastRestore",
      sets: { state: "canceled" },
      done: () => "Canceled. Nobody else gets it.",
    },
    {
      id: "people.broadcastRestore",
      label: "Restore",
      handler: "people/broadcastRestore",
      when: { state: ["canceled"] },
      confirm: "Restore it? It goes back to where it was, and sends to whoever hasn't had it.",
      done: () => "Restored",
    },
  ],
  head: (_meta, reload, at) =>
    at.demo ? null : <BroadcastsHead client={at.client} reload={reload} />,
  extras: (detail, at) => {
    const d = detail as BroadcastDetail | null;
    const row = at.row as Record<string, unknown>;
    // A waiting or scheduled one changed goes back to To approve.
    const editable = ["draft", "waiting", "scheduled", "declined"].includes(String(row.state));
    const sections: [string, ReactNode][] = [];
    if (d?.results) sections.push(["Results", <Results key="results" d={d.results} />]);
    if (!at.demo) {
      sections.push(["Test", <TestSend key="test" row={row} act={at.act} />]);
      if (editable)
        sections.push([
          "Change it",
          <EditSection key="edit" client={at.client} row={row} version={d?.version} act={at.act} />,
        ]);
    }
    return { sections } satisfies RecordExtras;
  },
};

/** Who each broadcast went to; reached from a broadcast's results. */
export const recipientsPage: ListPage = {
  id: "recipients",
  label: "Recipients",
  about: "Each person a broadcast went to, or why it didn't.",
  template: "list",
  record: "people.recipient",
  hidden: true,
  columns: ["name", "broadcast", "address", "state", "why", "dueAt", "sentAt"],
  empty: "Nobody yet. A broadcast reads its segment when it starts.",
};
