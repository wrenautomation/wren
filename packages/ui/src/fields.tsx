/**
 * Field kinds, drawn (console standard): each kind's table cell, its detail line and its filter.
 * A kind's CSV cell is the server's (`KINDS[kind].csv` in `@wren/core/records`): exports are
 * built there, so there is one copy of it.
 */
import type { Cell, FieldMeta, Filter, Op, State, Tone } from "@wren/core/records";
import type { Total } from "@wren/core/records/serve";
import { cn } from "cn";
import type { ReactNode } from "react";
import { hostOf, money, num } from "./format.js";
import { Cited, type PickSource, stripMarks } from "./sources.js";

const TONE: Record<Tone, string> = {
  good: "bg-(--ui-good)",
  warn: "bg-(--warn)",
  bad: "bg-(--ui-bad)",
  neutral: "bg-(--ui-ink-3)",
};

/** A state as a dot in its tone and its label. */
export function StateMark({ state }: { state: State }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE[state.tone])} />
      {state.label}
    </span>
  );
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

const stateOf = (f: FieldMeta, c: string): State => f.states?.[c] ?? { label: c, tone: "neutral" };

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

/** A link that opens apart from the row it sits in. The demo's hidden profiles show unlinked. */
function Out({ href, children }: { href: string; children: ReactNode }) {
  if (href.includes("•••")) return <span>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
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
    if ("name" in c) return <span>{c.name}</span>;
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
    case "tags":
      return (
        <span>
          {String(c)
            .split(",")
            .map((s) => stateOf(f, s).label)
            .join(", ")}
        </span>
      );
    case "number":
      return <span>{num(Number(c))}</span>;
    case "percent":
      return <span>{pct(Number(c))}</span>;
    case "score":
      return <Score value={Number(c)} max={f.max} />;
    case "date": {
      const d = dateOf(String(c));
      return d ? (
        <time dateTime={d.toISOString()} title={exact(d)}>
          {relative(d)}
        </time>
      ) : null;
    }
    case "link":
      return <Out href={String(c)}>{hostOf(String(c)) ?? String(c)}</Out>;
    case "cited":
      return <span>{stripMarks(String(c))}</span>;
    case "actor":
      return <Actor value={String(c)} />;
    default:
      return <span>{c}</span>;
  }
}

/**
 * Who or what made a row: a person's address as it is; a machine's "pipeline:compose" as its
 * kind, faint, then its name.
 */
function Actor({ value }: { value: string }) {
  const at = value.indexOf(":");
  if (at < 1 || value.includes("@")) return <span>{value}</span>;
  return (
    <span>
      {quiet(`${value.charAt(0).toUpperCase()}${value.slice(1, at)} · `)}
      {value.slice(at + 1)}
    </span>
  );
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
  if (!t) return null;
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
            <Out href={`https://${c.domain}`}>{c.domain}</Out>
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
    return d ? (
      <time dateTime={d.toISOString()}>
        {exact(d)} {quiet(`· ${relative(d)}`)}
      </time>
    ) : null;
  }
  if (f.kind === "score" && f.max) return <Score value={Number(c)} max={f.max} />;
  if (f.kind === "link") return <Out href={String(c)}>{String(c)}</Out>;
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
 * A filter as it rides in the address: states "moved,hiring"; a range "10..50", "..50";
 * words "~acme"; set or not "+" or "-". Anything else reads as no filter.
 */
export function readFilter(f: FieldMeta, s: string | null): Filter | undefined {
  if (!s) return undefined;
  if (s === "+" || s === "-") return f.ops.includes("empty") ? { empty: s === "-" } : undefined;
  const shape = filterShape(f);
  if (shape === "states") {
    const ids = s.split(",").filter((id) => f.states?.[id]);
    return ids.length ? ids : undefined;
  }
  if (shape === "range" && s.includes("..")) {
    const [lo, hi] = s.split("..");
    const val = (v: string | undefined) =>
      !v ? undefined : f.kind === "date" ? v : Number.isFinite(Number(v)) ? Number(v) : undefined;
    const out: Partial<Record<Op, unknown>> = {};
    if (val(lo) !== undefined) out.gte = val(lo);
    if (val(hi) !== undefined) out.lte = val(hi);
    return Object.keys(out).length ? out : undefined;
  }
  if (shape === "words" && s.startsWith("~") && s.length > 1) return { contains: s.slice(1) };
  return undefined;
}

/** What a filter chip says once set: "Moved, Hiring", "10 to 50", "has a value". */
export function filterLabel(f: FieldMeta, s: string): string {
  if (s === "+") return "has a value";
  if (s === "-") return "is empty";
  if (s.startsWith("~")) return `has "${s.slice(1)}"`;
  if (s.includes("..")) {
    const [lo, hi] = s.split("..");
    if (lo && hi) return `${lo} to ${hi}`;
    return lo ? `${lo} or more` : `${hi} or less`;
  }
  return s
    .split(",")
    .map((id) => stateOf(f, id).label)
    .join(", ");
}

const INPUT =
  "h-8 w-full border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink) outline-none focus:border-(--ui-ink-2)";

/** A field's filter control, editing the address form above. */
export function FieldFilter({
  field: f,
  value,
  onChange,
}: {
  field: FieldMeta;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const shape = filterShape(f);
  const empty = f.ops.includes("empty") && shape !== "set";
  const v = value ?? "";
  const setOrNot = (
    <div className="flex gap-1">
      {(["+", "-"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(v === s ? null : s)}
          className={cn(
            "h-7 flex-1 border border-(--ui-hair) text-[13px]",
            v === s
              ? "border-(--ui-ink) bg-(--ui-ink) text-(--ui-on-ink)"
              : "hover:bg-(--ui-hover)",
          )}
        >
          {s === "+" ? "Has a value" : "Is empty"}
        </button>
      ))}
    </div>
  );
  if (shape === "set") return setOrNot;
  if (shape === "states") {
    const on = new Set(v && v !== "+" && v !== "-" ? v.split(",") : []);
    const flip = (id: string) => {
      const next = new Set(on);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange(next.size ? [...next].join(",") : null);
    };
    return (
      <div className="grid gap-0.5">
        {Object.entries(f.states ?? {}).map(([id, st]) => (
          <label
            key={id}
            className="flex h-8 cursor-pointer items-center gap-2.5 px-1.5 text-[13px] hover:bg-(--ui-hover)"
          >
            <input
              type="checkbox"
              checked={on.has(id)}
              onChange={() => flip(id)}
              className="size-3.5 accent-(--ui-ink)"
            />
            <StateMark state={st} />
          </label>
        ))}
        {empty ? <div className="mt-1.5 border-t border-(--ui-hair) pt-2">{setOrNot}</div> : null}
      </div>
    );
  }
  if (shape === "range") {
    const [lo = "", hi = ""] = v.includes("..") ? v.split("..") : [];
    const type = f.kind === "date" ? "date" : "number";
    const set = (a: string, b: string) => onChange(a || b ? `${a}..${b}` : null);
    return (
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[12px] text-(--ui-ink-2)">
            {f.kind === "date" ? "From" : "At least"}
            <input
              type={type}
              className={INPUT}
              value={lo}
              onChange={(e) => set(e.target.value, hi)}
            />
          </label>
          <label className="grid gap-1 text-[12px] text-(--ui-ink-2)">
            {f.kind === "date" ? "To" : "At most"}
            <input
              type={type}
              className={INPUT}
              value={hi}
              onChange={(e) => set(lo, e.target.value)}
            />
          </label>
        </div>
        {empty ? setOrNot : null}
      </div>
    );
  }
  if (shape === "words")
    return (
      <div className="grid gap-2">
        <input
          className={INPUT}
          placeholder={`${f.label} has…`}
          defaultValue={v.startsWith("~") ? v.slice(1) : ""}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const w = e.currentTarget.value.trim();
            onChange(w ? `~${w}` : null);
          }}
        />
        {empty ? setOrNot : null}
      </div>
    );
  return null;
}
