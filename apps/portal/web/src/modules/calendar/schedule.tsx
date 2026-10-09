/**
 * The Schedule: a calendar's calls the way a calendar shows them, on the viewer's own clock: Wren's
 * in Wren's workspace, the client's own in a client's (its database, through `calendar/*`). Week is
 * the default (Day on a phone): a time grid with a column per day, each call a block as long as
 * the call, the open hours shaded and a line at now. Month and List too. The arrows step, T comes
 * back to today, D W M L switch views. A call opens beside it in the records panel, with its
 * buttons. The address is the state: ?v=week&d=2026-10-06&call=12.
 */
import { CALL_OUTCOME_LABELS, type MeetingOutcome } from "@wren/core/calls";
import type { RecordMeta } from "@wren/core/records";
import {
  Button,
  LoadFailed,
  Loading,
  type RecordActs,
  RecordPanel,
  type RecordsApi,
  useTypes,
} from "@wren/ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { permissionOf } from "../../../../src/services.js";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
import { href, navigate } from "../../route.js";
import { callExtras } from "../calls/brief.js";
import { CALL_ACTIONS, CLIENT_CALL_ACTIONS } from "./actions.js";
import {
  dayKey,
  daysOf,
  lanes,
  parseDay,
  placeIn,
  rangeOf,
  step,
  VIEWS,
  type View,
} from "./grid.js";

const RECORD = "calendar.booking";
const PATH = "/calendar/schedule";
/** Pixels per hour in the time grid. */
const HOUR = 48;
const PX = HOUR / 60;
/** The hours of a day, and the 23 marks between them. */
const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface CallBlock {
  id: number;
  start: string;
  end: string;
  name: string;
  offer: string | null;
  state: "booked" | "cancelled";
  outcome: MeetingOutcome | null;
  meet: string | null;
}
interface Range {
  zone: string;
  length: number;
  open: { start: string; end: string }[];
  calls: CallBlock[];
  /** A client's only: its booking page, whether bookers hear from it, a calendar connected. */
  page?: string;
  sends?: boolean;
  connected?: boolean;
}
type Call = Omit<CallBlock, "start" | "end"> & { start: Date; end: Date };

const LABEL: Record<View, string> = { day: "Day", week: "Week", month: "Month", list: "List" };
const KEY: Record<string, View> = { d: "day", w: "week", m: "month", l: "list" };

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", o).format(d);
const clock = (d: Date) => fmt(d, { hour: "numeric", minute: "2-digit" });
const span = (c: Call) => `${clock(c.start)} to ${clock(c.end)}`;
/** "9 AM", "9:30 AM": a clock with no ":00". */
const brief = (d: Date) => clock(d).replace(":00", "");
/** "9 to 9:30 AM", or "11:30 AM to 12 PM" across noon: a block's time, short. */
function short(c: Call): string {
  const a = brief(c.start);
  const b = brief(c.end);
  const same = c.start.getHours() < 12 === c.end.getHours() < 12;
  return `${same ? a.replace(/ [AP]M$/, "") : a} to ${b}`;
}

function title(view: View, days: Date[], anchor: Date): string {
  const first = days[0] as Date;
  const last = days[days.length - 1] as Date;
  if (view === "day")
    return fmt(first, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (view === "month") return fmt(anchor, { month: "long", year: "numeric" });
  const sameMonth = first.getMonth() === last.getMonth();
  const a = fmt(first, { month: "short", day: "numeric" });
  const b = fmt(last, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${a} to ${b}, ${last.getFullYear()}`;
}

/** The console's record calls for Wren's own calendar: what the side panel reads. */
const WREN_API: RecordsApi = {
  types: () => call("console/recordsTypes", {}),
  list: (a) => call("console/recordsList", { ...a }),
  get: (a) => call("console/recordsGet", { ...a }),
  export: (a) => call("console/recordsExport", { ...a }),
  stats: (a) => call("console/recordsStats", { ...a }),
  edit: (a) => call("console/recordsEdit", { ...a }),
  undo: (a) => call("console/recordsUndo", { ...a }),
};
const CLIENT_APIS = new Map<string, RecordsApi>();
/** A client's calls as records, from its own database: read only. */
function clientApi(client: string, asClient: boolean): RecordsApi {
  const key = `${client}:${asClient}`;
  let api = CLIENT_APIS.get(key);
  if (!api) {
    const ask = <T,>(handler: string, body: object) =>
      call<T>(`calendar/${handler}`, { client, app: "calendar", asClient, ...body });
    api = {
      types: () => ask("recordsTypes", {}),
      list: (a) => ask("recordsList", a),
      get: (a) => ask("recordsGet", a),
      export: (a) => ask("recordsExport", a),
      stats: (a) => ask("recordsStats", a),
    };
    CLIENT_APIS.set(key, api);
  }
  return api;
}

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="border border-(--ui-hair) px-1 font-[inherit] text-[12px]">{children}</kbd>
);

const phone = () => typeof matchMedia === "function" && matchMedia("(max-width: 640px)").matches;

/** Re-renders every minute, so the now line moves. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Schedule(props: PageProps) {
  return <Board {...props} />;
}

/** A client's page and whether bookers hear from it, above its week. */
function PageLine({ range }: { range: Range }) {
  if (!range.page) return null;
  const shown = range.page.replace(/^https?:\/\//, "");
  const notes = [
    range.connected === false
      ? "No Google calendar is connected, so your busy times aren't read."
      : null,
    range.sends === false
      ? "Sending is off, so bookers get no invite, email or text yet. Wren turns it on with you."
      : null,
  ].filter((n): n is string => n !== null);
  return (
    <div className="grid gap-1 border border-(--ui-hair) px-4 py-3 text-[14px]">
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-(--ui-ink-2)">
        Your booking page
        <a href={range.page} target="_blank" rel="noreferrer" className="break-all text-(--ui-ink)">
          {shown}
        </a>
      </p>
      {notes.map((n) => (
        <p key={n} className="m-0 text-[13px] text-(--ui-ink-2)">
          {n}
        </p>
      ))}
    </div>
  );
}

function Board({ client: workspace, params, team, demo, can }: PageProps) {
  const client = workspace === WREN.id ? null : workspace;
  const API = client ? clientApi(client, !team) : WREN_API;
  const now = useNow();
  const asked = params.get("v");
  const view: View = (VIEWS as readonly string[]).includes(asked ?? "")
    ? (asked as View)
    : phone()
      ? "day"
      : "week";
  const anchor =
    parseDay(params.get("d")) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const openId = params.get("call");
  const days = daysOf(view, anchor);
  const { from, to } = rangeOf(view, anchor);
  const [rev, setRev] = useState(0);
  const got = useCall(
    `calendar-range:${client}:${from.toISOString()}:${to.toISOString()}:${rev}`,
    () =>
      call<Range>("calendar/range", {
        ...(client ? { client } : {}),
        from: from.toISOString(),
        to: to.toISOString(),
      }),
  );
  const calls: Call[] = useMemo(
    () =>
      (got.data?.calls ?? []).map((c) => ({
        ...c,
        start: new Date(c.start),
        end: new Date(c.end),
      })),
    [got.data],
  );
  const open = useMemo(
    () => (got.data?.open ?? []).map((o) => ({ start: new Date(o.start), end: new Date(o.end) })),
    [got.data],
  );

  const go = (change: Record<string, string | null>, replace = false) =>
    navigate(href(PATH, change, params), replace);
  const to_ = (d: Date) => go({ d: dayKey(d) === dayKey(now) ? null : dayKey(d) });
  const pick = (id: number) => go({ call: String(id), tab: null });

  // The arrows, T and the view letters; Esc closes the panel. Never while typing.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const el = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
    if (e.key === "Escape" && openId) return go({ call: null, tab: null });
    if (openId) return; // the panel's own keys
    const k = e.key.toLowerCase();
    if (e.key === "ArrowLeft") to_(step(view, anchor, -1));
    else if (e.key === "ArrowRight") to_(step(view, anchor, 1));
    else if (k === "t") go({ d: null });
    else if (KEY[k]) go({ v: KEY[k] === "week" && !phone() ? null : (KEY[k] as View) });
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);

  const types = useTypes(API);
  const meta = types.data?.find((t) => t.id === RECORD);
  const ordered = calls
    .filter((c) => c.state === "booked")
    .concat(calls.filter((c) => c.state !== "booked"));
  const index = ordered.findIndex((c) => String(c.id) === openId);
  const acts: RecordActs = {
    actions: (client ? CLIENT_CALL_ACTIONS : CALL_ACTIONS).map((a) => {
      const needs = a.requires?.needs ?? permissionOf(a.handler);
      return needs ? { ...a, requires: { ...a.requires, needs } } : a;
    }),
    viewer: { team, demo, ...(can ? { can } : {}) },
    call: (handler, input) => call(handler, client ? { client, ...input } : input),
  };

  return (
    <div className="grid gap-4">
      {got.data ? <PageLine range={got.data} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="secondary" size="dense" onClick={() => go({ d: null })} title="Today (T)">
          Today
        </Button>
        <span className="flex">
          <IconButton
            label="Previous"
            hint="Left arrow"
            onClick={() => to_(step(view, anchor, -1))}
          >
            <Chevron points="10,3 5,8 10,13" />
          </IconButton>
          <IconButton label="Next" hint="Right arrow" onClick={() => to_(step(view, anchor, 1))}>
            <Chevron points="6,3 11,8 6,13" />
          </IconButton>
        </span>
        <h1 className="m-0 text-[18px] font-semibold tracking-tight text-(--ui-ink)">
          {title(view, days, anchor)}
        </h1>
        <div role="tablist" aria-label="View" className="ml-auto flex border border-(--ui-hair)">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={v === view}
              title={`${LABEL[v]} (${v[0]?.toUpperCase()})`}
              onClick={() => go({ v: v === "week" && !phone() ? null : v })}
              className={`h-8 border-0 px-3 text-[13px] ${
                v === view
                  ? "bg-(--ui-ink) text-(--ui-on-ink)"
                  : "bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover)"
              }`}
            >
              {LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {got.error && !got.data ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !got.data ? (
        <Loading lines={8} />
      ) : view === "month" ? (
        <Month days={days} anchor={anchor} calls={calls} now={now} pick={pick} go={go} />
      ) : view === "list" ? (
        <Agenda days={days} calls={calls} now={now} pick={pick} />
      ) : (
        <Grid days={days} calls={calls} open={open} now={now} pick={pick} openId={openId} />
      )}

      <p className="m-0 text-[13px] text-(--ui-ink-3) max-sm:hidden">
        <Kbd>←</Kbd> <Kbd>→</Kbd> to move, <Kbd>T</Kbd> today, <Kbd>D</Kbd> <Kbd>W</Kbd>{" "}
        <Kbd>M</Kbd> <Kbd>L</Kbd> to switch. Shaded: your open hours
        {got.data ? ` (${got.data.zone.replace(/_/g, " ")})` : ""}.
      </p>

      {openId && meta && types.data ? (
        <RecordPanel
          key={openId}
          meta={meta as RecordMeta}
          types={types.data}
          id={openId}
          api={API}
          place={{
            params,
            link: (change) => href(PATH, change, params),
            page: (id) => `/calendar/calls/${encodeURIComponent(String(id))}`,
            list: "/calendar/calls",
            go: navigate,
          }}
          extras={(detail, row) => callExtras(detail, row, { reason: "outcomeReason" })}
          acts={acts}
          index={index}
          count={ordered.length}
          step={(by) => {
            const next = ordered[index + by];
            if (next) go({ call: String(next.id), tab: null }, true);
          }}
          rev={rev}
          onActed={() => setRev((r) => r + 1)}
        />
      ) : null}
    </div>
  );
}

const Chevron = ({ points }: { points: string }) => (
  <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

function IconButton({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${hint})`}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
    >
      {children}
    </button>
  );
}

/**
 * A call's fill, as a calendar colors it: upcoming solid in the accent, past a lighter accent,
 * a no-show the bad tone, cancelled faint and struck through.
 */
const tone = (c: Call, now: Date) =>
  c.state === "cancelled"
    ? "bg-(--ui-wash) text-(--ui-ink-2) line-through shadow-[inset_0_0_0_1px_var(--ui-hair)]"
    : c.outcome === "no_show"
      ? "bg-[color-mix(in_srgb,var(--ui-bad)_14%,var(--ui-paper))] text-(--ui-ink)"
      : c.end < now
        ? "bg-[color-mix(in_srgb,var(--ui-accent)_26%,var(--ui-paper))] text-(--ui-ink)"
        : "bg-(--ui-accent) text-(--ui-on-accent)";
/** Words a fill can't say: a no-show. */
const flag = (c: Call) =>
  c.state === "booked" && c.outcome === "no_show" ? CALL_OUTCOME_LABELS.no_show.label : null;
const BLOCK =
  "rounded-[var(--ui-radius)] border-0 text-left transition-shadow hover:z-20 hover:shadow-md focus-visible:z-20 aria-pressed:z-20 aria-pressed:ring-2 aria-pressed:ring-(--ui-ink) aria-pressed:ring-offset-1 aria-pressed:ring-offset-(--ui-paper)";

/** Week or Day: hours down the side, a column per day. */
function Grid({
  days,
  calls,
  open,
  now,
  pick,
  openId,
}: {
  days: Date[];
  calls: Call[];
  open: { start: Date; end: Date }[];
  now: Date;
  pick: (id: number) => void;
  openId: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Opens on the working day: an hour before the earliest open hour or call, else 8:00.
  const first = useMemo(() => {
    const mins = [...open, ...calls]
      .flatMap((b) => days.map((d) => placeIn(d, b)?.top))
      .filter((m): m is number => m !== undefined);
    return Math.max(0, (mins.length ? Math.min(...mins) : 9 * 60) - 60);
  }, [open, calls, days]);
  const key = days.map(dayKey).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll once per range, not per poll.
  useEffect(() => {
    // A little above the first hour, so its label shows whole.
    scroller.current?.scrollTo({ top: Math.max(0, first * PX - 10) });
  }, [key]);
  const today = dayKey(now);
  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <div className="border border-(--ui-hair)">
      <div className="grid border-b border-(--ui-hair)" style={{ gridTemplateColumns: cols }}>
        <span />
        {days.map((d) => (
          <div
            key={dayKey(d)}
            className={`grid justify-items-center py-2 text-[12px] ${
              dayKey(d) === today ? "text-(--ui-accent)" : "text-(--ui-ink-2)"
            }`}
          >
            <span className="uppercase tracking-wide">{fmt(d, { weekday: "short" })}</span>
            <span className="text-[20px] font-semibold leading-tight">{d.getDate()}</span>
          </div>
        ))}
      </div>
      <div ref={scroller} className="relative max-h-[68vh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
          <div className="relative">
            {HOURS.slice(1).map((h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-(--ui-ink-3)"
                style={{ top: h * HOUR }}
              >
                {fmt(new Date(2000, 0, 1, h), { hour: "numeric" })}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const mine = calls.filter((c) => placeIn(d, c));
            return (
              <div key={dayKey(d)} className="relative border-l border-(--ui-hair)">
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-(--ui-hair) opacity-60"
                    style={{ top: h * HOUR }}
                  />
                ))}
                {open.map((o) => {
                  const at = placeIn(d, o);
                  return at ? (
                    <div
                      key={o.start.toISOString()}
                      aria-hidden
                      className="absolute inset-x-0 bg-(--ui-accent-wash)"
                      style={{ top: at.top * PX, height: at.height * PX }}
                    />
                  ) : null;
                })}
                {lanes(mine).map(({ item: c, lane, of }) => {
                  const at = placeIn(d, c) as { top: number; height: number };
                  const height = Math.max(at.height * PX - 1, 18);
                  // Lines that fit at 16px each, inside 2px of padding top and bottom.
                  const lines = Math.floor((height - 4) / 16);
                  const note = flag(c);
                  const time = note ? `${note}, ${short(c)}` : short(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pick(c.id)}
                      title={`${c.name}, ${span(c)}${c.offer ? `, ${c.offer}` : ""}${note ? `, ${note}` : ""}`}
                      aria-pressed={openId === String(c.id)}
                      className={`absolute overflow-hidden px-1.5 py-0.5 text-[12px] leading-4 ${BLOCK} ${tone(c, now)}`}
                      style={{
                        top: at.top * PX,
                        height,
                        left: `calc(${(lane / of) * 100}% + 1px)`,
                        width: `calc(${100 / of}% - 3px)`,
                      }}
                    >
                      {lines < 2 ? (
                        <span className="block truncate">
                          <span className="font-semibold">{c.name}</span>
                          <span className="opacity-85">, {time}</span>
                        </span>
                      ) : (
                        <>
                          <span className="block truncate font-semibold">{c.name}</span>
                          <span className="block truncate opacity-85">{time}</span>
                          {lines >= 3 && c.offer ? (
                            <span className="block truncate opacity-85">{c.offer}</span>
                          ) : null}
                        </>
                      )}
                    </button>
                  );
                })}
                {dayKey(d) === today ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-(--ui-bad)"
                    style={{
                      top: (placeIn(d, { start: now, end: addMinute(now) })?.top ?? 0) * PX,
                    }}
                  >
                    <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-(--ui-bad)" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const addMinute = (d: Date) => new Date(d.getTime() + 60_000);

/** Month: whole weeks, up to three calls a day, the rest a link to that day. */
function Month({
  days,
  anchor,
  calls,
  now,
  pick,
  go,
}: {
  days: Date[];
  anchor: Date;
  calls: Call[];
  now: Date;
  pick: (id: number) => void;
  go: (change: Record<string, string | null>) => void;
}) {
  const today = dayKey(now);
  return (
    <div className="grid grid-cols-7 border-t border-l border-(--ui-hair)">
      {days.slice(0, 7).map((d) => (
        <span
          key={`h${dayKey(d)}`}
          className="border-r border-b border-(--ui-hair) py-1.5 text-center text-[11px] uppercase tracking-wide text-(--ui-ink-3)"
        >
          {fmt(d, { weekday: "short" })}
        </span>
      ))}
      {days.map((d) => {
        const mine = calls.filter((c) => placeIn(d, c));
        const out = d.getMonth() !== anchor.getMonth();
        return (
          <div
            key={dayKey(d)}
            className={`grid min-h-24 content-start gap-0.5 border-r border-b border-(--ui-hair) p-1 ${
              out ? "bg-(--ui-wash)" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => go({ v: "day", d: dayKey(d) })}
              title="Open the day"
              className={`mb-0.5 inline-flex size-6 items-center justify-center justify-self-center rounded-full border-0 text-[12px] ${
                dayKey(d) === today
                  ? "bg-(--ui-accent) text-(--ui-on-accent)"
                  : `bg-transparent hover:bg-(--ui-hover) ${out ? "text-(--ui-ink-3)" : "text-(--ui-ink)"}`
              }`}
            >
              {d.getDate()}
            </button>
            {mine.slice(0, 3).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c.id)}
                title={`${c.name}, ${span(c)}${flag(c) ? `, ${flag(c)}` : ""}`}
                className={`truncate px-1.5 py-px text-[11.5px] leading-4 ${BLOCK} ${tone(c, now)}`}
              >
                <span className="opacity-85">{brief(c.start)}</span>{" "}
                <span className="font-semibold">{c.name}</span>
              </button>
            ))}
            {mine.length > 3 ? (
              <button
                type="button"
                onClick={() => go({ v: "day", d: dayKey(d) })}
                className="border-0 bg-transparent px-1 text-left text-[11.5px] text-(--ui-ink-2) hover:underline"
              >
                {mine.length - 3} more
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** List: the next 30 days, a heading per day that has calls. */
function Agenda({
  days,
  calls,
  now,
  pick,
}: {
  days: Date[];
  calls: Call[];
  now: Date;
  pick: (id: number) => void;
}) {
  const withCalls = days
    .map((d) => ({ d, mine: calls.filter((c) => dayKey(c.start) === dayKey(d)) }))
    .filter((x) => x.mine.length);
  if (!withCalls.length)
    return <p className="text-[14px] text-(--ui-ink-2)">No calls in these 30 days.</p>;
  return (
    <div className="grid gap-5">
      {withCalls.map(({ d, mine }) => (
        <section key={dayKey(d)} className="grid gap-1">
          <h2
            className={`m-0 text-[13px] font-semibold ${
              dayKey(d) === dayKey(now) ? "text-(--ui-accent)" : "text-(--ui-ink-2)"
            }`}
          >
            {fmt(d, { weekday: "long", month: "long", day: "numeric" })}
          </h2>
          {mine.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c.id)}
              className="grid grid-cols-[9rem_1fr_auto] items-baseline gap-3 border-0 border-b border-(--ui-hair) bg-transparent px-1 py-2 text-left text-[14px] hover:bg-(--ui-hover) max-sm:grid-cols-[1fr_auto]"
            >
              <span className="text-(--ui-ink-2) max-sm:hidden">{span(c)}</span>
              <span
                className={`flex min-w-0 items-baseline gap-2 ${
                  c.state === "cancelled" ? "text-(--ui-ink-3) line-through" : "text-(--ui-ink)"
                }`}
              >
                <span
                  aria-hidden
                  className={`size-2.5 shrink-0 self-center rounded-[var(--ui-radius)] ${tone(c, now)}`}
                />
                <span className="min-w-0">
                  <span className="sm:hidden text-(--ui-ink-2)">{clock(c.start)} </span>
                  {c.name}
                  {c.offer ? <span className="text-(--ui-ink-3)"> · {c.offer}</span> : null}
                </span>
              </span>
              <span className="text-[12px] text-(--ui-ink-3)">{said(c, now)}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

const said = (c: Call, now: Date) =>
  c.state === "cancelled"
    ? "Cancelled"
    : c.outcome
      ? CALL_OUTCOME_LABELS[c.outcome].label
      : c.end < now
        ? "Say how it went"
        : "Upcoming";
