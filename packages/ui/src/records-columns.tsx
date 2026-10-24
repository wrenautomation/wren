/**
 * Which columns a list shows and how wide: the address's or the page's pick (`columnsOf`), the
 * Display popover, each column's width from text measured in the page's font (`widthsOf`), and
 * the fit to the room (`fitColumns`): word columns give up room before the title drops under
 * 220px, never a state, number or date. `dockedOf` is the cut beside a docked record,
 * `shownColumns` the one a phone draws.
 */

import type { Cell, FieldMeta, RecordMeta } from "@wren/core/records";
import type { Row, Total } from "@wren/core/records/serve";
import { cn } from "cn";
import { useCallback, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { actorParts, cueOf, shownOf, widthOf } from "./fields.js";
import { linkLabel, money } from "./format.js";
import { Segmented as Choice, useFrame } from "./frame.js";
import { tipProps } from "./hint.js";
import { useHoverPop } from "./hover-pop.js";
import { Icon } from "./icons.js";
import { CHIP, CHIP_ON, groupFields } from "./list-bar.js";
import { PAGE_SIZE, PAGE_SIZES, sizeOf } from "./pager.js";
import { type Place, titleOf } from "./records-types.js";

/** The templates' type. Buttons follow the tokens, as everywhere. */
export const ROOT = "text-[14px] text-(--ui-ink) [font-variant-numeric:tabular-nums]";

export function ListSkeleton() {
  return (
    <div className={cn(ROOT, "grid gap-3")} role="status" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-40 animate-pulse bg-(--ui-fill)" />
      <div className="h-9 w-full animate-pulse bg-(--ui-fill)" />
      {Array.from({ length: 8 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <div key={i} className="h-10 w-full animate-pulse bg-(--ui-wash)" />
      ))}
    </div>
  );
}

/**
 * Which columns show: the address's `cols` in its order (the title first), else the page's,
 * else every field that has one.
 */
export function columnsOf(
  meta: RecordMeta,
  params: URLSearchParams,
  columns?: string[],
): FieldMeta[] {
  const all = meta.fields.filter((f) => f.column);
  const cols = params.get("cols")?.split(",");
  if (cols) {
    const title = all.filter((f) => f.key === meta.title);
    const rest = cols.flatMap((k) => all.filter((f) => f.key === k && f.key !== meta.title));
    return [...title, ...rest];
  }
  // A page's own columns always carry the record's declared account; a viewer may take it off.
  const picked = columns && meta.account ? [...columns, meta.account] : columns;
  if (!picked) return all;
  return all.filter((f) => f.key === meta.title || picked.includes(f.key));
}

/**
 * How the list shows, in one popover (Linear's Display): its columns, rows grouped by platform
 * where it mixes them, and row height. A phone shows the title and one state whatever is
 * picked, so it has no columns there.
 */
export function ListDisplay({
  meta,
  place,
  columns,
  narrow,
}: {
  meta: RecordMeta;
  place: Place;
  columns: string[] | undefined;
  narrow: boolean;
}) {
  const frame = useFrame();
  const pop = useHoverPop();
  const all = narrow ? [] : meta.fields.filter((f) => f.column && f.key !== meta.title);
  // Group by its platform, the account each row is on, or any status or choice: one at a time.
  const groups = groupFields(meta);
  if (!frame && !groups.length && !all.length) return null;
  const shown = new Set(columnsOf(meta, place.params, columns).map((f) => f.key));
  const fallback = columnsOf(meta, new URLSearchParams(), columns)
    .map((f) => f.key)
    .filter((k) => k !== meta.title)
    .join(",");
  // The shown columns in their order, then the rest; each change writes the order to `cols`.
  const order = columnsOf(meta, place.params, columns)
    .map((f) => f.key)
    .filter((k) => k !== meta.title);
  const listed = [
    ...order.flatMap((k) => all.filter((f) => f.key === k)),
    ...all.filter((f) => !order.includes(f.key)),
  ];
  const write = (keys: string[]) => {
    const next = keys.join(",");
    place.go(place.link({ cols: next === fallback ? null : next || "none" }), true);
  };
  const flip = (key: string) =>
    write(shown.has(key) ? order.filter((k) => k !== key) : [...order, key]);
  const raise = (key: string) => {
    const i = order.indexOf(key);
    if (i < 1) return;
    const next = [...order];
    next.splice(i - 1, 2, key, order[i - 1] as string);
    write(next);
  };
  const grouping = groups.some((f) => place.params.get("group") === f.key);
  const label =
    "flex h-8 pointer-coarse:h-11 cursor-pointer items-center gap-2.5 px-1.5 text-[13px] hover:bg-(--ui-hover)";
  return (
    <Popover {...pop.root}>
      <PopoverTrigger
        {...pop.trigger}
        className={cn(CHIP, (grouping || place.params.has("cols")) && CHIP_ON)}
      >
        <Icon name="sliders" className="size-[15px] [stroke-width:1.8]" />
        <span data-hp>Display</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70dvh] w-60 gap-3 overflow-y-auto p-3">
        {frame ? (
          <Choice
            label="Rows"
            value={frame.display.density}
            options={[
              ["roomy", "Roomy"],
              ["snug", "Snug"],
            ]}
            onChange={(density) => frame.set({ density })}
          />
        ) : null}
        <Choice
          label="Per page"
          value={String(sizeOf(place.params))}
          options={PAGE_SIZES.map((n) => [String(n), String(n)] as const)}
          onChange={(n) =>
            place.go(place.link({ size: Number(n) === PAGE_SIZE ? null : n, pg: null }), true)
          }
        />
        {groups.map((g) => {
          const on = place.params.get("group") === g.key;
          return (
            <label key={g.key} className={cn(label, "-mx-1.5")}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => place.go(place.link({ group: on ? null : g.key, pg: null }), true)}
                className="size-3.5 accent-(--ui-ink)"
              />
              Group by {g.label.toLowerCase()}
            </label>
          );
        })}
        {all.length ? (
          <fieldset className="m-0 grid min-w-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[12.5px] font-medium text-(--ui-ink-2)">
              Columns
            </legend>
            {listed.map((f) => (
              <div key={f.key} className="-mx-1.5 flex items-center">
                <label className={cn(label, "min-w-0 flex-1")}>
                  <input
                    type="checkbox"
                    checked={shown.has(f.key)}
                    onChange={() => flip(f.key)}
                    className="size-3.5 accent-(--ui-ink)"
                  />
                  {f.label}
                </label>
                {order.indexOf(f.key) > 0 ? (
                  <button
                    type="button"
                    aria-label={`Move ${f.label.toLowerCase()} left`}
                    {...tipProps("Move left")}
                    onClick={() => raise(f.key)}
                    className="grid size-7 pointer-coarse:size-11 place-items-center text-(--ui-ink-3) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
                  >
                    <Icon name="arrowUp" className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </fieldset>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export const blank = (c: Cell | undefined) =>
  c === null || c === undefined || c === "" || (Array.isArray(c) && !c.length);

/** A canvas to measure words in the list's own font; null off a browser. */
let pen: CanvasRenderingContext2D | null | undefined;

/**
 * Words' width in characters of 7.2px, the unit the widths count in: measured in the list's
 * 14px font when there is one ("Companies" is 7.5, not 9), else one per character.
 */
function lenOf(s: string): number {
  if (pen === undefined) {
    try {
      pen =
        typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      pen = null;
    }
  }
  if (!pen) return s.length;
  pen.font = `14px ${getComputedStyle(document.body).fontFamily}`;
  return pen.measureText(s).width / 7.2;
}

/** How many characters a cell takes on screen: a state by its label, a date as "10 minutes ago". */
function charsOf(f: FieldMeta, c: Cell | undefined): number {
  if (blank(c)) return 0;
  if (f.kind === "date") return 14;
  // A state's dot and its gaps take about four characters (measured: "Changed" needs 101px).
  if (f.kind === "status" || f.kind === "verdict")
    return lenOf(f.states?.[String(c)]?.label ?? String(c)) + 4;
  // A choice's mark or tint takes about three characters, as a state's dot does.
  if (f.kind === "choice" || f.words)
    return lenOf(shownOf(f, String(c))) + (cueOf(f, String(c)) ? 3 : 0);
  if (f.kind === "link") return lenOf(linkLabel(String(c), f.label));
  if (f.kind === "actor") return lenOf(actorParts(String(c))?.join(" · ") ?? String(c));
  // A score's bar and its gap are 48px, about seven characters; the digits run wider than the
  // average character, so one more keeps "100" whole.
  if (f.kind === "score") return String(c).length + (f.max ? 8 : 0);
  if (Array.isArray(c)) return lenOf(c.join(", "));
  if (c && typeof c === "object") {
    if ("name" in c) return lenOf(c.name);
    if ("amount" in c) return lenOf(money(c.amount, c.currency)) + 1;
    return `${c.n} of ${c.of}`.length;
  }
  return f.column?.align === "end" ? String(c).length + 3 : lenOf(String(c));
}

/** A cell's width in px: about 7.2 a character at 14px, and the cell's padding. */
const pxOf = (chars: number) => Math.ceil(chars * 7.2) + 24;

/** The most a column grows before the others have their words: its kind's max (set in core), never below its preset. */
const maxOf = (f: FieldMeta) => Math.max(f.column?.max ?? 0, widthOf(f));

/** The checkbox gutter and the actions column, as `Rows` draws them. */
const FIXED = 28 + 44;

/** A head reads at 12.5px; the measure counts in the cells' 14px. */
const HEAD = 12.5 / 14;

/** A head's kind icon and its gap (21px); the sorted one also its arrow (16px). */
const headExtra = (sorted: boolean) => 3 + (sorted ? 2.3 : 0);

/** A title's words read heavier: 7.6px a character. */
const titlePx = (chars: number, mark: number) => Math.ceil(chars * 7.6) + 24 + mark;

/** The least a list's title keeps, so what the row is stays readable. */
const TITLE_LEAST = 160;

/** A column this wide or less holds short words: it fills before a long one grows. */
const SHORT = 168;

/** The title's words on one line count to here before the other columns grow past their max. */
const TITLE_WANT = 360;

/** The kinds whose words wrap in their cell: free text and names, never a state, number or date. */
const YIELDS: ReadonlySet<FieldMeta["kind"]> = new Set([
  "text",
  "name",
  "company",
  "actor",
  "link",
  "tags",
]);

/** A cell's words, when they may wrap; null for one that keeps its line (a state, a figure, a date). */
function cellWords(f: FieldMeta, c: Cell | undefined): string | null {
  if (blank(c) || !YIELDS.has(f.kind) || f.words) return null;
  if (f.kind === "link") return linkLabel(String(c), f.label);
  if (f.kind === "actor") return actorParts(String(c))?.join(" · ") ?? String(c);
  if (Array.isArray(c)) return c.join(", ");
  if (c && typeof c === "object") return "name" in c ? c.name : null;
  return String(c);
}

/** The widest word of `s` in characters: a line breaks at a space or after a hyphen. */
const longestWord = (s: string) => Math.max(0, ...s.split(/\s+|(?<=-)/).map(lenOf));

/**
 * A column's three widths in px. `least`: no word breaks (its longest word, its head's longest
 * word, a state or a date whole). `want`: its widest cell on one line, up to its kind's max.
 * `need`: every cell on one line.
 */
type Span = { least: number; want: number; need: number };

function headSpan(label: string, sorted: boolean): Span {
  const words = label.split(/\s+/).map(lenOf);
  const extra = headExtra(sorted);
  const least = pxOf(Math.max(...words) * HEAD + extra);
  // A head may take two lines: its longest word, or half of it.
  const want = pxOf(Math.max(...words, lenOf(label) / 2) * HEAD + extra);
  return { least, want, need: want };
}

function spanOf(f: FieldMeta, rows: Row[], total: Total | undefined, sorted: boolean): Span {
  const head = headSpan(f.label, sorted);
  const sum = total && "sum" in total ? pxOf(lenOf(money(total.sum, total.currency)) + 1) : 0;
  let least = Math.max(48, head.least, sum);
  let need = Math.max(48, head.want, sum);
  for (const r of rows) {
    const whole = pxOf(charsOf(f, r[f.key]));
    const words = cellWords(f, r[f.key]);
    need = Math.max(need, whole);
    least = Math.max(least, words === null ? whole : pxOf(longestWord(words)));
  }
  // One word longer than the kind's max (a link) breaks inside it.
  least = Math.min(least, Math.max(maxOf(f), head.least));
  return { least, want: Math.max(least, Math.min(need, maxOf(f))), need: Math.max(least, need) };
}

function titleSpan(meta: RecordMeta, f: FieldMeta, rows: Row[], sorted: boolean): Span {
  const head = headSpan(f.label, sorted);
  // A person's initials sit in an avatar before the name (22px and its gap).
  const mark = f.kind === "name" ? 30 : 0;
  let least = Math.max(TITLE_LEAST, head.least);
  let need = least;
  for (const r of rows) {
    const t = titleOf(meta, r);
    need = Math.max(need, titlePx(lenOf(t), mark));
    least = Math.max(least, titlePx(longestWord(t), mark));
  }
  least = Math.min(least, TITLE_WANT);
  // A title with a message under it (a DM, a comment) wants the room: the message is what the row is.
  const previews = meta.fields.some((m) => m.key === meta.subtitle && m.kind === "prose");
  const want = previews ? Math.max(need, TITLE_WANT) : Math.min(need, TITLE_WANT);
  return { least, want: Math.max(least, want), need: Math.max(least, need, want) };
}

/**
 * A column's width for the rows shown, before the room is known: what its head and its widest
 * cell need on one line, within its kind's max. A figure's head takes two lines as a word's does.
 */
export function fitOf(f: FieldMeta, rows: Row[], total?: Total, sorted = false): number {
  return rows.length ? spanOf(f, rows, total, sorted).want : widthOf(f);
}

/** The title's least width: no word of any title shown breaks. `Rows` keeps it as the name's min. */
export function titleLeast(meta: RecordMeta, rows: Row[], sort?: string | undefined): number {
  const f = meta.fields.find((m) => m.key === meta.title);
  if (!f) return TITLE_LEAST;
  return titleSpan(meta, f, rows, sort?.replace(/^-/, "") === f.key).least;
}

/**
 * Each column's width; the title has none and takes what the rest leave. With the room known,
 * every column starts at its least (no word breaks), then the spare room goes, by how short each
 * is: first to a column of short words, then to each one's words on one line within its max, then
 * past it. Only when the leasts alone are wider than the room does the list scroll sideways; its
 * actions stay at the right edge.
 */
export function widthsOf(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  room?: number,
  totals?: Record<string, Total>,
  sort?: string | undefined,
): Record<string, number | undefined> {
  const span = spansOf(meta, cols, rows, totals, sort);
  const out: Record<string, number | undefined> = {};
  if (!room || !rows.length) {
    for (const f of cols) out[f.key] = f.key === meta.title ? undefined : span(f).want;
    return out;
  }
  const w = new Map(cols.map((f) => [f.key, span(f).least]));
  let spare = room - FIXED - cols.reduce((n, f) => n + span(f).least, 0);
  // A column of short words ("Company event checks") fills first: whole, it costs little.
  const passes = [
    (f: FieldMeta) => (span(f).want <= SHORT ? span(f).want : 0),
    (f: FieldMeta) => span(f).want,
    (f: FieldMeta) => span(f).need,
  ];
  for (const goal of passes) {
    if (spare <= 0) break;
    const short = cols
      .map((f) => [f, goal(f) - (w.get(f.key) ?? 0)] as const)
      .filter(([, d]) => d > 0);
    const all = short.reduce((n, [, d]) => n + d, 0);
    if (!all) continue;
    const share = Math.min(1, spare / all);
    for (const [f, d] of short) {
      const add = Math.floor(d * share);
      w.set(f.key, (w.get(f.key) ?? 0) + add);
      spare -= add;
    }
  }
  for (const f of cols) out[f.key] = f.key === meta.title ? undefined : w.get(f.key);
  return out;
}

/** Each column's span for the rows shown: the title's from its words, a field's from its cells. */
function spansOf(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  totals?: Record<string, Total>,
  sort?: string | undefined,
): (f: FieldMeta) => Span {
  const by = sort?.replace(/^-/, "");
  const spans = new Map(
    cols.map((f) => [
      f.key,
      f.key === meta.title
        ? titleSpan(meta, f, rows, f.key === by)
        : rows.length
          ? spanOf(f, rows, totals?.[f.key], f.key === by)
          : { least: widthOf(f), want: widthOf(f), need: widthOf(f) },
    ]),
  );
  return (f) => spans.get(f.key) as Span;
}

/**
 * The columns a list shows in its room (F1 `.nt`: it never scrolls sideways): the title, then each
 * column in order while it fits on one line, or wrapped at SHORT when longer. One that doesn't is left out of view; it stays
 * a Display pick away and on the record. Columns picked by hand all show, and scroll if they must.
 */
export function fitColumns(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  room: number | undefined,
  totals?: Record<string, Total>,
  sort?: string | undefined,
): FieldMeta[] {
  if (!room || !rows.length) return cols;
  const span = spansOf(meta, cols, rows, totals, sort);
  // A column costs its one line up to SHORT, a longer one wraps there: shown, it reads at a glance.
  const cost = (f: FieldMeta) => Math.max(span(f).least, Math.min(span(f).want, SHORT));
  let used = FIXED + cols.reduce((n, f) => n + (f.key === meta.title ? span(f).least : 0), 0);
  return cols.filter((f) => {
    if (f.key === meta.title) return true;
    if (used + cost(f) > room) return false;
    used += cost(f);
    return true;
  });
}

/**
 * A list's columns beside a docked record (`.nt-pk .nt`): the title, the first column, and the
 * time it waits, else its first date, each while the half holds its words.
 */
export function dockedOf(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  room: number | undefined,
  wait: string | undefined,
  totals?: Record<string, Total>,
  sort?: string | undefined,
): FieldMeta[] {
  const title = cols.filter((f) => f.key === meta.title);
  const rest = cols.filter((f) => f.key !== meta.title);
  const when = rest.find((f) => f.key === wait) ?? rest.find((f, i) => i > 0 && f.kind === "date");
  // The time comes first when the half holds one of the two.
  const pair = [when, rest[0]].filter((f, i, a): f is FieldMeta => !!f && a.indexOf(f) === i);
  const kept = new Set(fitColumns(meta, [...title, ...pair], rows, room, totals, sort));
  return [...title, ...[rest[0], when].filter((f): f is FieldMeta => !!f && kept.has(f))].filter(
    (f, i, a) => a.indexOf(f) === i,
  );
}

/** An element's width as it changes: a list fits its columns to it. */
export function useRoom(): [(el: HTMLDivElement | null) => void, number | undefined] {
  const [room, setRoom] = useState<number>();
  const watch = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    watch.current?.disconnect();
    if (!el || typeof ResizeObserver === "undefined") return;
    watch.current = new ResizeObserver(() => setRoom(el.clientWidth));
    watch.current.observe(el);
  }, []);
  return [ref, room];
}

/**
 * The columns a list draws: what's picked, less those blank on every row shown or only repeating the title (unless picked
 * by hand), and on a phone the title, the first state that tells the rows apart, and the next fields, three at most.
 */
export function shownColumns(
  meta: RecordMeta,
  cols: FieldMeta[],
  rows: Row[],
  { byHand, narrow, wait }: { byHand: boolean; narrow: boolean; wait?: string | undefined },
): FieldMeta[] {
  const title = (r: Row) => r[meta.title];
  // A column that mostly says the title again ("Text" whose first line is the "Post", on at least
  // half the rows) is left out: the rest read it on the record's page.
  const repeats = (f: FieldMeta) =>
    f.kind === "text" &&
    rows.filter((r) => {
      const [t, c] = [title(r), r[f.key]];
      return typeof t === "string" && t !== "" && typeof c === "string" && c.startsWith(t);
    }).length *
      2 >=
      rows.length;
  const filled =
    byHand || !rows.length
      ? cols
      : cols.filter(
          (f) => f.key === meta.title || (rows.some((r) => !blank(r[f.key])) && !repeats(f)),
        );
  if (!narrow) return filled;
  const tells = (f: FieldMeta) => new Set(rows.map((r) => String(r[f.key] ?? ""))).size > 1;
  const states = filled.filter((f) => f.key !== meta.title && f.kind === "status");
  const state = states.find(tells) ?? states[0];
  // A phone row: the title, the state, then the next fields, up to three; a state the same on every
  // row says nothing.
  // The wait a page watches comes first after its state, then the account a row is on: on a phone
  // it says who sends.
  const rest = filled
    .filter((f) => f.key !== meta.title && f !== state && (f.kind !== "status" || tells(f)))
    .sort(
      (a, b) =>
        Number(b.key === wait) - Number(a.key === wait) ||
        Number(b.key === meta.account) - Number(a.key === meta.account),
    );
  const lead = filled.filter((f) => f.key === meta.title);
  return [...lead, ...(state ? [state] : []), ...rest].slice(0, lead.length + NARROW_FIELDS);
}

/** How many fields a phone row shows under its title. */
const NARROW_FIELDS = 3;
