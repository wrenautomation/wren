/**
 * Field kinds, drawn (console standard): each kind's table cell, its detail line and its filter.
 * A kind's CSV cell is the server's (`KINDS[kind].csv` in `@wren/core/records`): exports are
 * built there, so there is one copy of it.
 */

import { wordsOf } from "@wren/core/models/labels";
import {
  type Cell,
  type FieldMeta,
  type Filter,
  type Op,
  type State,
  type Tone,
  tintOf,
} from "@wren/core/records";
import type { Total } from "@wren/core/records/serve";
import { codeLabel } from "@wren/core/templates/labels";
import { cn } from "cn";
import { Check } from "lucide-react";
import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { duration, linkLabel, money, num } from "./format.js";
import { PlatformMark, TintSwatch } from "./marks.js";
import { Cited, type PickSource, stripMarks } from "./sources.js";

const TONE: Record<Tone, string> = {
  good: "bg-(--ui-good)",
  warn: "bg-(--warn)",
  bad: "bg-(--ui-bad)",
  neutral: "bg-(--ui-ink-3)",
};

/**
 * A value's cue, by one rule (designs/2026-10-07-visual-cues.md): a platform or channel's mark, a
 * kind of thing's tint swatch, else its tone's dot. `mono` draws a mark in the text's color.
 */
export function Cue({ state, mono, size }: { state: State; mono?: boolean; size?: number }) {
  if (state.mark) return <PlatformMark mark={state.mark} mono={mono ?? false} size={size ?? 14} />;
  if (state.tint !== undefined) return <TintSwatch tint={state.tint} />;
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE[state.tone])} />;
}

/** A state as its cue and its label: a dot in its tone, a platform's mark, or a kind's tint. */
export function StateMark({ state, mono }: { state: State; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Cue state={state} mono={mono ?? false} />
      {state.label}
    </span>
  );
}

/** A field's cue for a value, when its state has a mark or a tint; null for a plain state. */
export function cueOf(f: FieldMeta | undefined, value: string): State | null {
  if (!f || !value) return null;
  const s = f.states?.[value] ?? (f.kind === "choice" ? stateOf(f, value) : undefined);
  return s && (s.mark || s.tint !== undefined) ? s : null;
}

const WIDTH = { s: 108, m: 144, l: 200 } as const;
/**
 * A list column's width in px: its preset (a title's a fifth wider), or wider when its head, a
 * state's label or a date's "10 minutes ago" needs it, so none of them truncate.
 */
export function widthOf(f: FieldMeta, title = false): number {
  const states = Object.values(f.states ?? {}).map((s) => s.label.length + 2);
  const chars = Math.max(f.label.length + 2, f.kind === "date" ? 14 : 0, ...states);
  const preset = Math.round(WIDTH[f.column?.width ?? "m"] * (title ? 1.2 : 1));
  return Math.max(preset, Math.ceil(chars * 7.2) + 24);
}

const stateOf = (f: FieldMeta, c: string): State =>
  f.states?.[c] ??
  (f.kind === "choice"
    ? { label: codeLabel(c), tone: "neutral", tint: tintOf(c) }
    : { label: c, tone: "neutral" });

/** A month as it reads: "Oct 2026". */
const monthOf = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });

/** A cell as the words it shows: a state's or choice's label, a name from code as words. */
export function shownOf(f: FieldMeta, c: string): string {
  if (f.states || f.kind === "choice") return stateOf(f, c).label;
  // A page read as words: its host and path, no scheme ("wrenautomation.com/recruiting").
  if (f.kind === "link") return c.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || c;
  if (f.kind === "date" && f.grain === "month") {
    const d = dateOf(c);
    return d ? monthOf(d) : c;
  }
  return f.words ? wordsOf(f.words, c) : c;
}

/**
 * Postgres and ISO times alike: "2026-09-30 17:08:41.1+00" reads as a date. A bare day
 * ("2024-07-27", or a CRM's day stored as UTC midnight) is that day where the viewer is.
 */
export function dateOf(s: string): Date | null {
  const day = /^(\d{4})-(\d\d)-(\d\d)(?:[ T]00:00:00(?:\.0+)?(?:\+00(?::?00)?|Z))?$/.exec(s);
  const d = day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : new Date(s.includes("T") ? s : s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? null : d;
}

const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "always" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 864e5],
  ["month", 30 * 864e5],
  ["week", 7 * 864e5],
  ["day", 864e5],
  ["hour", 36e5],
  ["minute", 6e4],
];
/** "3 days ago", "in 1 month", "just now". Whole units, never rounded up: 18 months is "1 year ago". */
export function relative(d: Date, now = Date.now()): string {
  const ms = d.getTime() - now;
  for (const [unit, size] of UNITS)
    if (Math.abs(ms) >= size) return RELATIVE.format(Math.trunc(ms / size), unit);
  return "just now";
}
/** "Sep 30, 2026, 5:08 PM"; a bare day without the time. */
export const exact = (d: Date) =>
  d.getHours() || d.getMinutes() || d.getSeconds()
    ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString("en-US", { dateStyle: "medium" });

/** A rate's 95% range (Wilson), 0 to 1. */
export function wilson(n: number, of: number): [number, number] {
  if (of <= 0) return [0, 1];
  const z = 1.96;
  const p = n / of;
  const mid = (p + (z * z) / (2 * of)) / (1 + (z * z) / of);
  const half = (z / (1 + (z * z) / of)) * Math.sqrt((p * (1 - p)) / of + (z * z) / (4 * of * of));
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}
/** Under this many tries a rate says nothing yet. */
export const FEW = 30;
const pct = (x: number) => `${Math.round(x * 100)}%`;

const quiet = (s: ReactNode) => <span className="text-(--ui-ink-3)">{s}</span>;

/**
 * An address (a domain, a URL, an email) that may wrap only after its dots, slashes and @, never
 * mid-word: "harbortalent1." then "example.com". Text with spaces, or none of those, stays as is.
 */
export function breaks(s: string): ReactNode {
  if (/\s/.test(s) || !/[./@]/.test(s)) return s;
  const parts = s.split(/(?<=[./@])/);
  // A break chance after each; a part longer than the line still wraps as a last resort.
  return parts.length < 2
    ? s
    : parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string.
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 ? <wbr /> : null}
        </Fragment>
      ));
}

/** A link that opens apart from the row it sits in. The demo's hidden profiles show unlinked. */
function Out({ href, children }: { href: string; children: ReactNode }) {
  if (href.includes("•••")) return <span>{children}</span>;
  // A page of this app ("/inbox/replies/12") opens in place, a phone number dials; anything else
  // in a new tab.
  const away = !href.startsWith("/") && !href.startsWith("tel:");
  return (
    <a
      href={href}
      title={away ? href : undefined}
      target={away ? "_blank" : undefined}
      rel={away ? "noreferrer" : undefined}
      onClick={(e) => e.stopPropagation()}
      className="text-(--ui-ink) underline decoration-(--ui-hair) underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  );
}

/** A field's value in a table cell: short, one line. */
export function FieldCell({ field: f, cell: c }: { field: FieldMeta; cell: Cell | undefined }) {
  if (c === null || c === undefined || c === "") return null;
  if (typeof c === "object") {
    if ("name" in c) return <span>{breaks(c.name)}</span>;
    if ("amount" in c) return <span>{money(c.amount, c.currency)}</span>;
    return c.of < FEW ? (
      <span title="Too few to tell">{quiet(`${num(c.n)} of ${num(c.of)}`)}</span>
    ) : (
      <span title={`${num(c.n)} of ${num(c.of)}, likely ${range(c.n, c.of)}`}>
        {pct(c.n / c.of)}
      </span>
    );
  }
  switch (f.kind) {
    case "status":
    case "verdict":
      return <StateMark state={stateOf(f, String(c))} />;
    case "choice":
      return <StateMark state={stateOf(f, String(c))} />;
    case "tags": {
      const ids = String(c).split(",");
      // Tags that name channels show each one's mark; plain tags stay words.
      return ids.some((id) => cueOf(f, id)) ? (
        <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {ids.map((id) => (
            <StateMark key={id} state={stateOf(f, id)} />
          ))}
        </span>
      ) : (
        <span>{ids.map((id) => stateOf(f, id).label).join(", ")}</span>
      );
    }
    case "number":
      return <span>{num(Number(c))}</span>;
    case "percent":
      return <span>{pct(Number(c))}</span>;
    case "duration":
      return <span>{duration(Number(c))}</span>;
    case "score":
      return <Score value={Number(c)} max={f.max} />;
    case "date": {
      const d = dateOf(String(c));
      return d ? (
        <time dateTime={d.toISOString()} title={exact(d)}>
          {f.grain === "month" ? monthOf(d) : relative(d)}
        </time>
      ) : null;
    }
    case "link":
      return <Out href={String(c)}>{breaks(linkLabel(String(c), f.label))}</Out>;
    case "cited":
      return <span>{stripMarks(String(c))}</span>;
    case "actor":
      return <Actor value={String(c)} />;
    default:
      return f.words ? (
        <span title={f.words === true ? undefined : String(c)}>{wordsOf(f.words, String(c))}</span>
      ) : f.slots ? (
        <Slotted text={String(c)} slots={f.slots} />
      ) : (
        <span>{typeof c === "string" ? breaks(c) : c}</span>
      );
  }
}

/** Text with its `{slot}`s as chips that say what goes there; an unknown slot stays as typed. */
export function Slotted({
  text,
  slots,
}: {
  text: string;
  slots: Readonly<Record<string, string>>;
}) {
  const parts = text.split(/(\{[a-z_]+\})/i);
  return (
    <span>
      {parts.map((p, i) => {
        const label = /^\{[a-z_]+\}$/i.test(p) ? slots[p.slice(1, -1)] : undefined;
        return label ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string.
            key={i}
            title={`Filled in when it sends: ${p}`}
            className="mx-px inline-block bg-(--ui-tile) px-1 text-[0.92em] text-(--ui-ink-2) ring-1 ring-(--ui-hair) ring-inset"
          >
            {label}
          </span>
        ) : (
          p
        );
      })}
    </span>
  );
}

/**
 * Who or what made a row: a person's address as it is; a machine's "pipeline:compose" as its
 * kind, faint, then its name.
 */
/** Who did it, as it reads: "pipeline:wren-worker" is "Pipeline", then "Wren worker". */
export function actorParts(value: string): [kind: string, who: string] | null {
  const at = value.indexOf(":");
  if (at < 1 || value.includes("@")) return null;
  const who = value.slice(at + 1);
  return [
    `${value.charAt(0).toUpperCase()}${value.slice(1, at)}`,
    /^[\w-]+$/.test(who) ? codeLabel(who) : who,
  ];
}

function Actor({ value }: { value: string }) {
  const parts = actorParts(value);
  if (!parts) return <span>{breaks(value)}</span>;
  return (
    <span>
      {quiet(`${parts[0]} · `)}
      {parts[1]}
    </span>
  );
}

/**
 * Whether a column's footer has news: a sum, a rate, or rows that are missing it. "All filled",
 * "100% empty", the most common state and the newest date say nothing the rows above and the
 * view's counts don't, so the footer leaves them out.
 */
export function totalSays(f: FieldMeta, t: Total | undefined): boolean {
  if (!t) return false;
  if ("sum" in t) return true;
  if ("newest" in t || "most" in t) return false;
  if (f.kind === "rate" || f.kind === "verdict") return t.of > 0;
  const empty = t.of - t.n;
  return empty > 0 && empty < t.of;
}

/**
 * A column's footer figure (`Total` from the server), linked to the rows it counts when this
 * viewer may filter or sort that way. `to` builds the list's address with these params changed.
 */
export function FieldTotal({
  field: f,
  total: t,
  to,
}: {
  field: FieldMeta;
  total: Total | undefined;
  to: (change: Record<string, string | null>) => string;
}) {
  if (!t || !totalSays(f, t)) return null;
  const link = (text: ReactNode, change: Record<string, string> | null, title?: string) =>
    change ? (
      <a
        href={to({ ...change, after: null })}
        title={title}
        className="text-inherit no-underline hover:text-(--ui-ink) hover:underline"
      >
        {text}
      </a>
    ) : (
      <span title={title}>{text}</span>
    );
  const may = (op: Op) => f.ops.includes(op);
  if ("sum" in t)
    return link(money(t.sum, t.currency), may("empty") ? { [f.key]: "+" } : null, "Sum");
  if ("newest" in t) {
    const d = dateOf(t.newest);
    return d
      ? link(`Newest ${relative(d)}`, f.sortable ? { sort: `-${f.key}` } : null, exact(d))
      : null;
  }
  if ("most" in t)
    return link(
      `${stateOf(f, t.most).label} ${pct(t.n / t.of)}`,
      may("in") ? { [f.key]: t.most } : null,
      `Most common: ${num(t.n)} of ${num(t.of)}`,
    );
  if (f.kind === "rate")
    return link(
      t.of < FEW ? quiet(`${num(t.n)} of ${num(t.of)}`) : pct(t.n / t.of),
      f.sortable ? { sort: `-${f.key}` } : null,
      t.of < FEW
        ? "All rows, too few to tell"
        : `All rows: ${num(t.n)} of ${num(t.of)}, likely ${range(t.n, t.of)}`,
    );
  if (f.kind === "verdict")
    return link(
      `${pct(t.n / t.of)} valid`,
      may("in") ? { [f.key]: "valid" } : null,
      `${num(t.n)} of ${num(t.of)}`,
    );
  // Text: what's missing is the news, so the figure opens the empty rows.
  const empty = t.of - t.n;
  return empty
    ? link(
        `${pct(empty / t.of)} empty`,
        may("empty") ? { [f.key]: "-" } : null,
        `${num(empty)} of ${num(t.of)} empty`,
      )
    : quiet("All filled");
}

const range = (n: number, of: number) => {
  const [lo, hi] = wilson(n, of);
  return `${pct(lo)} to ${pct(hi)}`;
};

/** A score as its figure and a hairline bar out of the most it can be. */
function Score({ value, max }: { value: number; max: number | undefined }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {max ? (
        <span aria-hidden className="h-1 w-10 overflow-hidden bg-(--ui-fill)">
          <span
            className="block h-full bg-(--ui-ink-2)"
            style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }}
          />
        </span>
      ) : null}
      <span className="min-w-[2ch]">{num(value)}</span>
    </span>
  );
}

/** Where a cited field's chips point: marks in source order, the lit one, and the pick. */
export interface CiteTo {
  order: string[];
  lit: string | null;
  pick: PickSource;
}

/** A field's value on a record's page: whole, with what the cell leaves out. */
export function FieldLine({
  field: f,
  cell: c,
  cite,
}: {
  field: FieldMeta;
  cell: Cell | undefined;
  cite?: CiteTo | undefined;
}) {
  if (c === null || c === undefined || c === "") return quiet("Not known");
  if (typeof c === "object" && "name" in c)
    return (
      <span>
        {c.name}
        {c.domain ? (
          <>
            {" · "}
            <Out href={`https://${c.domain}`}>{breaks(c.domain)}</Out>
          </>
        ) : null}
      </span>
    );
  if (typeof c === "object" && "n" in c)
    return c.of < FEW ? (
      <span>
        {num(c.n)} of {num(c.of)} {quiet("· too few to tell")}
      </span>
    ) : (
      <span>
        {pct(c.n / c.of)} ({num(c.n)} of {num(c.of)}) {quiet(`· likely ${range(c.n, c.of)}`)}
      </span>
    );
  if (f.kind === "date") {
    const d = dateOf(String(c));
    if (d && f.grain === "month") return <time dateTime={d.toISOString()}>{monthOf(d)}</time>;
    return d ? (
      <time dateTime={d.toISOString()}>
        {exact(d)} {quiet(`· ${relative(d)}`)}
      </time>
    ) : null;
  }
  if (f.kind === "score" && f.max) return <Score value={Number(c)} max={f.max} />;
  if (f.kind === "link")
    return (
      <Out href={String(c)}>
        {String(c).startsWith("/")
          ? "Open"
          : String(c).startsWith("tel:")
            ? `Call ${String(c).slice(4)}`
            : breaks(String(c))}
      </Out>
    );
  if (f.kind === "cited")
    return cite ? (
      <Cited text={String(c)} order={cite.order} lit={cite.lit} onPick={cite.pick} />
    ) : (
      <span>{stripMarks(String(c))}</span>
    );
  return <FieldCell field={f} cell={c} />;
}

/** The filters a field takes on screen: states to pick, a range, words, or set or not. */
export function filterShape(f: FieldMeta): "states" | "range" | "words" | "set" | null {
  const has = (o: Op) => f.ops.includes(o);
  if (has("in") && f.states) return "states";
  if (has("gte") && has("lte")) return "range";
  if (has("contains")) return "words";
  if (has("empty")) return "set";
  return null;
}

/**
 * A date filter's presets, kept in the address as a word ("7d") so a saved view rolls with the
 * days; each reads from the start of a day where the viewer is.
 */
export const DATE_PRESETS = [
  { id: "today", label: "Today", op: "is", says: "today", back: 0 },
  { id: "7d", label: "Last 7 days", op: "in", says: "last 7 days", back: 6 },
  { id: "30d", label: "Last 30 days", op: "in", says: "last 30 days", back: 29 },
  { id: "month", label: "This month", op: "in", says: "this month", back: null },
] as const;

/** Where a preset starts: today's midnight, so many days back, or the 1st of this month. */
export function presetStart(id: string, now = new Date()): Date | null {
  const p = DATE_PRESETS.find((x) => x.id === id);
  if (!p) return null;
  const d = new Date(now.getFullYear(), now.getMonth(), p.back === null ? 1 : now.getDate());
  if (p.back) d.setDate(d.getDate() - p.back);
  return d;
}

const DAY = /^(\d{4})-(\d\d)-(\d\d)$/;
/** A day from a date box as the instant it starts, or with `end` the last instant of it, here. */
function dayBound(s: string, end: boolean): string {
  const m = DAY.exec(s);
  if (!m) return s;
  const next = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (end ? 1 : 0));
  return new Date(next.getTime() - (end ? 1 : 0)).toISOString();
}

/**
 * A filter as it rides in the address: states "moved,hiring"; a range "10..50", "..50"; a date
 * preset "7d"; words "~acme"; set or not "+" or "-". Anything else reads as no filter. A day
 * reads as where the viewer is, its end included.
 */
export function readFilter(f: FieldMeta, s: string | null, now = new Date()): Filter | undefined {
  if (!s) return undefined;
  if (s === "+" || s === "-") return f.ops.includes("empty") ? { empty: s === "-" } : undefined;
  const shape = filterShape(f);
  if (shape === "states") {
    const ids = s.split(",").filter((id) => f.states?.[id]);
    return ids.length ? ids : undefined;
  }
  if (shape === "range" && f.kind === "date") {
    const from = presetStart(s, now);
    if (from) return { gte: from.toISOString() };
  }
  if (shape === "range" && s.includes("..")) {
    const [lo, hi] = s.split("..");
    const val = (v: string | undefined, end: boolean) =>
      !v
        ? undefined
        : f.kind === "date"
          ? dayBound(v, end)
          : Number.isFinite(Number(v))
            ? Number(v)
            : undefined;
    const out: Partial<Record<Op, unknown>> = {};
    if (val(lo, false) !== undefined) out.gte = val(lo, false);
    if (val(hi, true) !== undefined) out.lte = val(hi, true);
    return Object.keys(out).length ? out : undefined;
  }
  if (shape === "words" && s.startsWith("~") && s.length > 1) return { contains: s.slice(1) };
  return undefined;
}

/** A day from the address as it reads: "Oct 1", with the year when it isn't this one. */
function dayLabel(s: string, now: Date): string {
  const m = DAY.exec(s);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * What a set filter says, as its pill reads after the field's name: "is" "SEC RIA", "is any of"
 * "2", "after" "Oct 1", "at least" "10", "has" "“acme”".
 */
export function filterParts(
  f: FieldMeta,
  s: string,
  now = new Date(),
): { op: string; value: string } {
  if (s === "+") return { op: "has", value: "a value" };
  if (s === "-") return { op: "is", value: "empty" };
  if (s.startsWith("~")) return { op: "has", value: `“${s.slice(1)}”` };
  const preset = f.kind === "date" ? DATE_PRESETS.find((p) => p.id === s) : undefined;
  if (preset) return { op: preset.op, value: preset.says };
  if (s.includes("..")) {
    const [lo = "", hi = ""] = s.split("..");
    const date = f.kind === "date";
    const show = (v: string) => (date ? dayLabel(v, now) : num(Number(v)));
    if (lo && hi) return { op: "between", value: `${show(lo)} and ${show(hi)}` };
    if (lo) return { op: date ? "after" : "at least", value: show(lo) };
    return { op: date ? "before" : "at most", value: show(hi) };
  }
  const labels = s.split(",").map((id) => stateOf(f, id).label);
  if (labels.length === 1) return { op: "is", value: labels[0] ?? s };
  const all = labels.join(", ");
  return { op: "is any of", value: all.length <= 24 ? all : String(labels.length) };
}

/**
 * Arrow keys over a list of `n`, Enter picks: the active row, and the keys for the box or list
 * that has focus. The highlight is the kit's hover.
 */
export function useRoving(n: number) {
  const [at, setAt] = useState(0);
  const now = n ? Math.min(at, n - 1) : -1;
  const keys = (e: KeyboardEvent, pick: (i: number) => void) => {
    if (!n) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAt((now + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(now);
    }
  };
  return { at: now, setAt, keys };
}
/** Keeps the active row in sight as the keys move it. */
export const inSight = (on: boolean) =>
  on ? (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest" }) : undefined;

const INPUT =
  "h-8 w-full min-w-0 border border-(--ui-edge) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink) outline-none placeholder:text-(--ui-ink-3) focus:border-(--ui-accent) focus:shadow-[0_0_0_1px_var(--ui-accent)]";
const ROW =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 px-2 text-left text-[13px] text-(--ui-ink) select-none";
const SEGMENT =
  "h-7 flex-1 border-0 bg-transparent px-2 text-[12px] text-(--ui-ink-2) hover:text-(--ui-ink) aria-pressed:bg-(--ui-hover) aria-pressed:text-(--ui-ink) aria-pressed:font-medium";

/** A row of choices, one picked: square, hairline, the picked one in the hover tone. */
function Segments<T extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: readonly (readonly [T, string])[];
  value: T | null;
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className="m-0 flex min-w-0 gap-0.5 border border-(--ui-hair) p-0.5"
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onPick(id)}
          className={SEGMENT}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}

/** A square check mark for a picked row. */
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center border",
        on
          ? "border-(--ui-ink) bg-(--ui-ink) text-(--ui-on-ink)"
          : "border-(--ui-ink-3) bg-(--ui-paper)",
      )}
    >
      {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
    </span>
  );
}

/** Set or not, under a field's other filter: "Has a value", "Is empty". */
function Presence({ value, onChange }: { value: string; onChange: (next: string | null) => void }) {
  const on = value === "+" || value === "-" ? value : null;
  return (
    <Segments
      label="Set or empty"
      options={[
        ["+", "Has a value"],
        ["-", "Is empty"],
      ]}
      value={on}
      onPick={(s) => onChange(on === s ? null : s)}
    />
  );
}

/** Sends what's typed once typing stops; Enter sends it now. */
function useTyped(
  send: () => string | null,
  value: string | null,
  onChange: (n: string | null) => void,
) {
  const typed = useRef(false);
  const go = () => {
    typed.current = false;
    const next = send();
    if (next !== value) onChange(next);
  };
  const touch = () => {
    typed.current = true;
  };
  return { go, touch, typed };
}

/** A field's filter control, editing the address form above; each change applies at once. */
export function FieldFilter({
  field: f,
  value,
  onChange,
  counts,
}: {
  field: FieldMeta;
  value: string | null;
  onChange: (next: string | null) => void;
  /** Rows per state under the other filters, when the list has them. */
  counts?: Readonly<Record<string, number>> | undefined;
}) {
  const shape = filterShape(f);
  const v = value ?? "";
  const presence = f.ops.includes("empty") ? <Presence value={v} onChange={onChange} /> : null;
  if (shape === "set") return <div className="p-1">{presence}</div>;
  const below = presence ? (
    <div className="mt-1 border-t border-(--ui-hair) p-1 pt-2">{presence}</div>
  ) : null;
  if (shape === "states")
    return (
      <>
        <StatesFilter field={f} value={v} onChange={onChange} counts={counts} />
        {below}
      </>
    );
  if (shape === "range" && f.kind === "date")
    return (
      <>
        <DateFilter field={f} value={v} onChange={onChange} />
        {below}
      </>
    );
  if (shape === "range")
    return (
      <>
        <NumberFilter value={v} onChange={onChange} />
        {below}
      </>
    );
  if (shape === "words")
    return (
      <>
        <WordsFilter field={f} value={v} onChange={onChange} />
        {below}
      </>
    );
  return null;
}

/** Past this many states a choice gets a search box. */
const LONG = 8;

/** States as a checkable list, with how many rows each would show; searchable when long. */
function StatesFilter({
  field: f,
  value: v,
  onChange,
  counts,
}: {
  field: FieldMeta;
  value: string;
  onChange: (next: string | null) => void;
  counts: Readonly<Record<string, number>> | undefined;
}) {
  const all = Object.entries(f.states ?? {});
  const [text, setText] = useState("");
  const t = text.trim().toLowerCase();
  const shown = t ? all.filter(([, st]) => st.label.toLowerCase().includes(t)) : all;
  const nav = useRoving(shown.length);
  const on = new Set(v && v !== "+" && v !== "-" ? v.split(",") : []);
  const flip = (id: string) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next.size ? [...next].join(",") : null);
  };
  const pick = (i: number) => {
    const row = shown[i];
    if (row) flip(row[0]);
  };
  const list = (
    <div
      role="listbox"
      aria-multiselectable
      aria-label={f.label}
      // biome-ignore lint/a11y/noAutofocus: the editor opened to pick in this list.
      autoFocus={all.length <= LONG}
      tabIndex={all.length <= LONG ? 0 : -1}
      onKeyDown={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          pick(nav.at);
        } else nav.keys(e, pick);
      }}
      className="grid max-h-64 overflow-y-auto p-1 outline-none"
    >
      {shown.map(([id, st], i) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the list's keys pick it.
        <div
          key={id}
          role="option"
          tabIndex={-1}
          aria-selected={on.has(id)}
          ref={inSight(i === nav.at)}
          onMouseMove={() => nav.setAt(i)}
          onClick={() => flip(id)}
          className={cn(ROW, i === nav.at && "bg-(--ui-hover)")}
        >
          <Tick on={on.has(id)} />
          <span className="min-w-0 flex-1 truncate">
            <StateMark state={st} />
          </span>
          {counts ? (
            <span className="text-[12px] text-(--ui-ink-3) tabular-nums">
              {num(counts[id] ?? 0)}
            </span>
          ) : null}
        </div>
      ))}
      {!shown.length ? (
        <span className="px-2 py-2 text-[13px] text-(--ui-ink-2)">None match.</span>
      ) : null}
    </div>
  );
  if (all.length <= LONG) return list;
  return (
    <>
      <div className="p-1 pb-0">
        <input
          // biome-ignore lint/a11y/noAutofocus: the editor opened to type in this.
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            nav.setAt(0);
          }}
          onKeyDown={(e) => nav.keys(e, pick)}
          placeholder={`Find a ${f.label.toLowerCase()}`}
          aria-label={`Find a ${f.label.toLowerCase()}`}
          className={INPUT}
        />
      </div>
      {list}
    </>
  );
}

/** Presets that count back from today, then a custom range. */
function DateFilter({
  field: f,
  value: v,
  onChange,
}: {
  field: FieldMeta;
  value: string;
  onChange: (next: string | null) => void;
}) {
  const [lo = "", hi = ""] = v.includes("..") ? v.split("..") : [];
  const [custom, setCustom] = useState(v.includes(".."));
  const rows = [
    ...DATE_PRESETS.map((p) => [p.id, p.label] as const),
    ["custom", "Custom range"] as const,
  ];
  const nav = useRoving(rows.length);
  const picked = custom ? "custom" : v;
  const pick = (i: number) => {
    const id = rows[i]?.[0];
    if (!id) return;
    if (id === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    onChange(v === id ? null : id);
  };
  const set = (a: string, b: string) => onChange(a || b ? `${a}..${b}` : null);
  return (
    <div className="grid p-1">
      <div
        role="listbox"
        aria-label={f.label}
        // biome-ignore lint/a11y/noAutofocus: the editor opened to pick in this list.
        autoFocus
        tabIndex={0}
        onKeyDown={(e) => nav.keys(e, pick)}
        className="grid outline-none"
      >
        {rows.map(([id, label], i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the list's keys pick it.
          <div
            key={id}
            role="option"
            tabIndex={-1}
            aria-selected={picked === id}
            onMouseMove={() => nav.setAt(i)}
            onClick={() => pick(i)}
            className={cn(ROW, i === nav.at && "bg-(--ui-hover)")}
          >
            <span className="flex-1">{label}</span>
            {picked === id ? <Check className="size-3.5 text-(--ui-ink)" /> : null}
          </div>
        ))}
      </div>
      {custom ? (
        <div className="grid grid-cols-2 gap-2 px-2 pt-1.5 pb-1">
          <label className="grid min-w-0 gap-1 text-[12px] text-(--ui-ink-2)">
            From
            <input
              type="date"
              // biome-ignore lint/a11y/noAutofocus: Custom range was picked to type a day.
              autoFocus
              className={INPUT}
              value={lo}
              max={hi || undefined}
              onChange={(e) => set(e.target.value, hi)}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-[12px] text-(--ui-ink-2)">
            To
            <input
              type="date"
              className={INPUT}
              value={hi}
              min={lo || undefined}
              onChange={(e) => set(lo, e.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

type NumOp = "gte" | "lte" | "between";
const NUM_OPS = [
  ["gte", "At least"],
  ["lte", "At most"],
  ["between", "Between"],
] as const;

/** At least, at most or between: the figures apply once typing stops. */
function NumberFilter({
  value: v,
  onChange,
}: {
  value: string;
  onChange: (next: string | null) => void;
}) {
  const [lo0 = "", hi0 = ""] = v.includes("..") ? v.split("..") : [];
  const [op, setOp] = useState<NumOp>(lo0 && hi0 ? "between" : hi0 ? "lte" : "gte");
  const [a, setA] = useState(op === "lte" ? hi0 : lo0);
  const [b, setB] = useState(hi0);
  const typed = useTyped(
    () => {
      if (op === "gte") return a ? `${a}..` : null;
      if (op === "lte") return a ? `..${a}` : null;
      return a || b ? `${a}..${b}` : null;
    },
    v.includes("..") ? v : null,
    onChange,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: what's typed sends after a pause.
  useEffect(() => {
    if (!typed.typed.current) return;
    const t = setTimeout(typed.go, 300);
    return () => clearTimeout(t);
  }, [op, a, b]);
  const box = (val: string, set: (s: string) => void, label: string, focus: boolean) => (
    <input
      type="number"
      inputMode="decimal"
      // biome-ignore lint/a11y/noAutofocus: the editor opened to type a figure.
      autoFocus={focus}
      aria-label={label}
      value={val}
      onChange={(e) => {
        typed.touch();
        set(e.target.value);
      }}
      onKeyDown={(e) => e.key === "Enter" && typed.go()}
      className={INPUT}
    />
  );
  return (
    <div className="grid gap-2 p-2">
      <Segments
        label="Compare"
        options={NUM_OPS}
        value={op}
        onPick={(o) => {
          typed.touch();
          setOp(o);
        }}
      />
      {op === "between" ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[12px] text-(--ui-ink-2)">
          {box(a, setA, "From", true)}
          and
          {box(b, setB, "To", false)}
        </div>
      ) : (
        box(a, setA, op === "gte" ? "At least" : "At most", true)
      )}
    </div>
  );
}

/** Words the field has: they apply once typing stops. */
function WordsFilter({
  field: f,
  value: v,
  onChange,
}: {
  field: FieldMeta;
  value: string;
  onChange: (next: string | null) => void;
}) {
  const [text, setText] = useState(v.startsWith("~") ? v.slice(1) : "");
  const typed = useTyped(
    () => (text.trim() ? `~${text.trim()}` : null),
    v.startsWith("~") ? v : null,
    onChange,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: what's typed sends after a pause.
  useEffect(() => {
    if (!typed.typed.current) return;
    const t = setTimeout(typed.go, 300);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div className="p-2">
      <input
        // biome-ignore lint/a11y/noAutofocus: the editor opened to type in this.
        autoFocus
        className={INPUT}
        placeholder={`${f.label} has…`}
        aria-label={`${f.label} has`}
        value={text}
        onChange={(e) => {
          typed.touch();
          setText(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && typed.go()}
      />
    </div>
  );
}
