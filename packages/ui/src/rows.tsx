/**
 * One rows part for every list (designs/2026-10-21-crm-rows-everywhere.md): the F1 look of the
 * design language's Inbox section. A header with a glyph before each label and hairline column
 * lines; hairline rows; a gutter box that shows on hover; a name with its avatar and an Open chip;
 * one quiet icon at the row's end; a count foot. A group is a fold. A phone draws the same rows as
 * a name, one property and the quiet icon, and swipes.
 *
 * `List` (records) maps a record type and its page into `Rows`; a hand page with plain data passes
 * columns and rows. `DataTable` and `FactsTable` stay for facts. The table is a real `<table>`.
 */
import { hoursSince, lateOf } from "@wren/core/promise";
import type { FieldMeta, State, Tone } from "@wren/core/records";
import { cn } from "cn";
import {
  type CSSProperties,
  type LiHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { Tag } from "./controls.js";
import { initials, waited } from "./format.js";
import { clipProps } from "./hint.js";
import { Icon, type IconName } from "./icons.js";
import { lineColor, StageSquare, tintColor } from "./marks.js";
import { SwipeRow, type Swipes } from "./phone.js";
import { RowActions } from "./row-acts.js";
import { type RowAttrs, useLines } from "./table.js";

export { StageSquare };

/** What a phone row takes from a page's `rowProps`: an li's attributes, minus the ones `SwipeRow` owns. */
type LiAttrs = Omit<LiHTMLAttributes<HTMLLIElement>, "onClick"> & {
  [data: `data-${string}`]: string | number | boolean | undefined;
};

/** The glyph before a column's head, by what the column holds. One table, so every list reads alike. */
export const KIND_ICON: Record<FieldMeta["kind"], IconName> = {
  text: "text",
  name: "user",
  company: "building",
  status: "selected",
  choice: "selected",
  verdict: "selected",
  number: "hash",
  money: "dollar",
  percent: "percent",
  rate: "percent",
  score: "gauge",
  duration: "clock",
  date: "clock",
  tags: "tag",
  link: "link",
  actor: "user",
  prose: "lines",
  cited: "quote",
};

/** A value's colour for a pill: its lane, its tint, else its tone. */
export function stateColor(s: State | undefined): string {
  if (!s) return "var(--ui-ink-3)";
  if (s.line !== undefined) return lineColor(s.line);
  if (s.tint !== undefined) return tintColor(s.tint);
  const TONE: Record<Tone, string> = {
    good: "var(--ui-good)",
    warn: "var(--ui-warn)",
    bad: "var(--ui-bad)",
    neutral: "var(--ui-ink-3)",
  };
  return TONE[s.tone];
}

/** A colour pill: a soft ground of its colour and text of its colour, in ink. */
export function Pill({
  color,
  className,
  children,
}: {
  color?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-[5px] truncate px-2 py-0.5 text-[12.5px] font-semibold whitespace-nowrap [border-radius:3px_9px_3px_9px]",
        "bg-[color-mix(in_srgb,var(--c)_15%,var(--ui-paper))] text-[color-mix(in_srgb,var(--c)_72%,var(--ui-ink))]",
        className,
      )}
      style={{ "--c": color ?? "var(--ui-ink-3)" } as CSSProperties}
    >
      {children}
    </span>
  );
}

/** How long a row has waited, and whether that is past its promise. */
export interface RowsWait {
  hours: number;
  late: boolean;
}

/**
 * A wait, as words. Past its promise it reads amber, heavier: text only, never a fill. (Amber
 * means late and nothing else: designs/2026-10-20-design-language.md.)
 */
export function Age({ hours, late, className }: RowsWait & { className?: string }) {
  return (
    <span
      data-late={late ? "" : undefined}
      className={cn(
        "text-[13.5px] whitespace-nowrap tabular-nums",
        late
          ? "font-[650] text-[color-mix(in_srgb,var(--ui-warn)_80%,var(--ui-ink))]"
          : "text-(--ui-ink-2)",
        className,
      )}
    >
      {waited(hours)}
    </span>
  );
}

/** What a set of rows says about its waits: how many, how many are late, and the longest. */
export interface WaitStats {
  n: number;
  late: number;
  /** The longest wait, or null when no row waits. */
  oldest: RowsWait | null;
}

/**
 * A row's wait from the date it began (`at`). Past `promise` it reads late, but only while the row
 * is `open`: an answered row shows its age and never as late. No promise: never late. No date: it
 * does not wait (null).
 */
export function waitFrom(
  at: string,
  promise: string | undefined,
  open: boolean,
  now: Date,
): RowsWait | null {
  const hours = hoursSince(at, now);
  return hours === null ? null : { hours, late: open && lateOf(at, promise, now) };
}

/** The count, late count and oldest wait of `waits`, one per row (null: the row does not wait). */
export function statsOf(waits: readonly (RowsWait | null)[]): WaitStats {
  let late = 0;
  let oldest: RowsWait | null = null;
  for (const w of waits) {
    if (!w) continue;
    if (w.late) late++;
    if (!oldest || w.hours > oldest.hours) oldest = w;
  }
  return { n: waits.length, late, oldest };
}

/** The foot's line: "Count 6 · Late 3 · Oldest 2 days". Late and Oldest show where rows wait. */
export function RowsFoot({ stats, waits }: { stats: WaitStats; waits: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4.5 gap-y-1" title="Of the rows on this page">
      <span>
        Count <b className="font-[650] text-(--ui-ink-2) tabular-nums">{stats.n}</b>
      </span>
      {waits ? (
        <>
          <span className="max-[720px]:hidden">
            Late <b className="font-[650] text-(--ui-ink-2) tabular-nums">{stats.late}</b>
          </span>
          {stats.oldest ? (
            <span className="max-[720px]:hidden">
              Oldest <b className="font-[650] text-(--ui-ink-2)">{waited(stats.oldest.hours)}</b>
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** A column of `Rows`: its head and what each row shows in it. */
export interface RowsColumn<T> {
  key: string;
  /** Its head, in words. */
  label: ReactNode;
  /** The glyph before the label. */
  icon?: IconName | undefined;
  align?: "end" | undefined;
  /** Its width in px; none takes what the others leave. */
  width?: number | undefined;
  /** The least it needs when it takes what is left; sizes the table's own least width. */
  min?: number | undefined;
  /** Classes on its head and every cell: a width, or the breakpoint it shows from. */
  className?: string | undefined;
  /** The head's own node (a sort link) in place of the label. */
  sort?: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** The one column a phone's row shows beside the name. At most one. */
  phone?: boolean | undefined;
  /** Reads quieter than the rest: when something happened. */
  quiet?: boolean | undefined;
  /** The totals row's cell under this column. */
  total?: ReactNode;
}

/** The name column: who or what the row is, and where it opens. */
export interface RowsName<T> {
  label: ReactNode;
  icon?: IconName | undefined;
  sort?: ReactNode;
  width?: number | undefined;
  min?: number | undefined;
  className?: string | undefined;
  title: (row: T) => string;
  /** The row's own page. None: the title is a button that opens the row (a side sheet). */
  href?: ((row: T) => string) | undefined;
  /** The title's weight and ink. */
  weight?: ((row: T) => string) | undefined;
  /** Initials in a round avatar. */
  avatar?: ((row: T) => string | null) | undefined;
  /** A platform or kind mark before the title (an avatar wins). */
  mark?: ((row: T) => ReactNode) | undefined;
  /** Under the title: a message's first words. */
  sub?: ((row: T) => ReactNode) | undefined;
  /** After the title: small marks (a pin, a star, a tag). */
  tail?: ((row: T) => ReactNode) | undefined;
}

/** One line `Rows` draws, in order: a group's fold, a tier's band, a row, or a box under a row. */
export type RowsLine<T> =
  | { kind: "row"; key: string; index: number; row: T }
  | { kind: "box"; key: string; node: ReactNode }
  | { kind: "group"; key: string; label: ReactNode; color?: string | undefined }
  | { kind: "tier"; key: string; head: ReactNode };

/** The rows picked. */
export interface RowsPick {
  picked: (id: string) => boolean;
  /** Pick one, or let it go; `range` is a shift-click. */
  toggle: (id: string, range?: boolean) => void;
  all: boolean;
  some: boolean;
  toggleAll: () => void;
  /** How many are picked: once any is, every gutter box shows. */
  count: number;
}

/** A row's actions, as `RowActions` draws them. */
export interface RowsAct {
  main: Parameters<typeof RowActions>[0]["main"];
  more: Parameters<typeof RowActions>[0]["more"];
  reply: (() => void) | null;
  /** The record's own page; none: ⋯ has no "Open as a page". */
  page?: string | undefined;
  busy: boolean;
  run: Parameters<typeof RowActions>[0]["run"];
}

export interface RowsProps<T> {
  /** The table's name for a screen reader ("people"). */
  label: string;
  /** One row, in a word, for the boxes' names ("person"): "Select every person shown". */
  noun?: string | undefined;
  columns: RowsColumn<T>[];
  name: RowsName<T>;
  lines: RowsLine<T>[];
  /** The rows are still being read: placeholder rows draw. */
  loading?: boolean | undefined;
  /** Nothing to draw: the part hides, and the page says why. */
  empty?: boolean | undefined;
  pick?: RowsPick | undefined;
  /** A row's actions; null: none. The quiet icon is the reply, else the first main one. */
  act?: ((row: T) => RowsAct | null) | undefined;
  /** In place of `act`: the row's end cell. */
  end?: ((row: T) => ReactNode) | undefined;
  /** The row that is open beside the list, and what a press on a row does. */
  open?: { id: string | null; onOpen: (row: T, index: number) => void } | undefined;
  /** The row the keyboard is on. */
  cursor?: number | undefined;
  /** A row's own state: the word an optimistic press shows, and a flash after it changed. */
  rowState?:
    | ((row: T) => { going?: string | undefined; changed?: boolean | undefined })
    | undefined;
  /** The flash ended. */
  onSettled?: (() => void) | undefined;
  /** How long a row has waited and whether that is late. */
  wait?: ((row: T) => RowsWait | null) | undefined;
  /** The foot; set where the page has none of its own. */
  foot?: ReactNode;
  /** Groups that fold: which are shut, and shut or open one. */
  group?: { folded: ReadonlySet<string>; toggle: (key: string) => void } | undefined;
  /** The element that scrolls the rows, or "window" where the page does (a phone's always does). */
  scroller: HTMLElement | null | "window";
  narrow: boolean;
  /** A phone row's swipes. */
  swipes?: ((row: T) => Swipes | null) | undefined;
  /** A row's own attributes (a drag, a mark); its `className` joins the part's. */
  rowProps?: ((row: T, index: number) => RowAttrs) | undefined;
  className?: string | undefined;
}

const GUTTER = 28;
const END = 44;
const TH_LINE = "[&:not(:first-child)]:shadow-[inset_1px_0_0_var(--ui-hair)]";

/**
 * A row's ground, which its actions sit over at its right end. As the artifact's `.nt .r`: the
 * open row (and a picked one) on the accent tint, hover and the key cursor on the accent wash.
 */
function groundOf(open: boolean, picked: boolean, cursor: boolean) {
  if (open || picked)
    return "bg-(--ui-accent-tint) [--row-ground:color-mix(in_srgb,var(--ui-active)_10%,var(--ui-paper))]";
  if (cursor)
    return "bg-(--ui-accent-wash) [--row-ground:color-mix(in_srgb,var(--ui-active)_7%,var(--ui-paper))]";
  return "[--row-ground:var(--ui-paper)] hover:bg-(--ui-accent-wash) hover:[--row-ground:color-mix(in_srgb,var(--ui-active)_7%,var(--ui-paper))]";
}

type Drawn<T> = RowsLine<T> & { stats?: WaitStats };

/**
 * The lines to draw. A group's fold shows its count and oldest wait: of the rows loaded on this
 * page, not of the whole list, which the server pages. A folded group's rows (and their boxes)
 * leave.
 */
export function drawnOf<T>(
  lines: readonly RowsLine<T>[],
  folded: ReadonlySet<string> | undefined,
  wait: ((row: T) => RowsWait | null) | undefined,
): Drawn<T>[] {
  const waits = new Map<string, (RowsWait | null)[]>();
  let key: string | null = null;
  for (const l of lines) {
    if (l.kind === "group") {
      key = l.key;
      waits.set(key, []);
    } else if (l.kind === "tier") key = null;
    else if (l.kind === "row" && key) waits.get(key)?.push(wait?.(l.row) ?? null);
  }
  const out: Drawn<T>[] = [];
  let shut = false;
  for (const l of lines) {
    if (l.kind === "group") {
      shut = !!folded?.has(l.key);
      out.push({ ...l, stats: statsOf(waits.get(l.key) ?? []) });
    } else if (l.kind === "tier") {
      shut = false;
      out.push(l);
    } else if (!shut) out.push(l);
  }
  return out;
}

/** The fold over a group of rows: its chevron, pill, count and oldest wait. */
function GroupFold({
  label,
  color,
  stats,
  shut,
  toggle,
}: {
  label: ReactNode;
  color: string | undefined;
  stats: WaitStats;
  shut: boolean;
  toggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={!shut}
      onClick={toggle}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-none border-0 bg-transparent px-3.5 pt-3 pb-2 text-left text-[13px] text-(--ui-ink-3) select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--ui-focus) max-[900px]:min-h-11"
    >
      <Icon
        name="down"
        size={15}
        className={cn(
          "[stroke-width:1.8] transition-transform duration-[250ms] ease-(--ui-spring) motion-reduce:transition-none",
          shut && "-rotate-90",
        )}
      />
      <Pill color={color}>{label}</Pill>
      <b className="font-bold text-(--ui-ink) tabular-nums">{stats.n}</b>
      {stats.oldest ? (
        <span className="text-(--ui-ink-3)">
          oldest <Age hours={stats.oldest.hours} late={stats.oldest.late} className="text-[13px]" />
        </span>
      ) : null}
    </button>
  );
}

/** A person's initials in a round tint: 22px in a row, `lg` 32px in a peek's head. */
export function Avatar({ initials: text, lg = false }: { initials: string; lg?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid flex-none place-items-center rounded-full bg-(--ui-accent-tint) font-bold text-(--ui-link)",
        lg ? "size-8 text-[12px]" : "size-[22px] text-[10px]",
      )}
    >
      {text}
    </span>
  );
}

/** A name: avatar or mark, the title (a link), and the Open chip on hover. */
function NameCell<T>({
  name,
  row,
  narrow,
  onOpen,
  className,
}: {
  name: RowsName<T>;
  row: T;
  narrow: boolean;
  /** What a title with no page does; none: the title is plain text. */
  onOpen: (() => void) | undefined;
  className?: string;
}) {
  const title = name.title(row);
  const initial = name.avatar?.(row);
  const mark = initial ? null : (name.mark?.(row) ?? null);
  const sub = name.sub?.(row);
  const tail = name.tail?.(row);
  const link = name.href?.(row);
  const text = title || <span className="text-(--ui-ink-3)">-</span>;
  const titled = cn(
    // Cut inside the link, so focusing it never scrolls the cell sideways.
    "block no-underline",
    narrow ? "line-clamp-2 leading-snug wrap-anywhere" : "truncate",
    name.weight?.(row) ?? "font-[650] text-(--ui-ink)",
  );
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {initial ? <Avatar initials={initial} /> : mark}
      <div className="grid min-w-0 flex-1">
        {link ? (
          <a href={link} {...clipProps()} className={titled}>
            {text}
          </a>
        ) : onOpen ? (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={onOpen}
            {...clipProps()}
            className={cn(titled, "w-full cursor-pointer border-0 bg-transparent p-0 text-left")}
          >
            {text}
          </button>
        ) : (
          <span {...clipProps()} className={titled}>
            {text}
          </span>
        )}
        {sub}
      </div>
      {tail}
    </div>
  );
}

const OPEN_CHIP =
  "ml-auto inline-flex flex-none items-center gap-1 px-[7px] py-0.5 text-[11.5px] font-[650] text-(--ui-ink-2) no-underline opacity-0 transition-opacity duration-150 [border-radius:3px_8px_3px_8px] bg-(--ui-paper) shadow-[0_0_0_1px_var(--ui-hair)] group-hover:opacity-100 group-focus-within:opacity-100 group-data-cursor:opacity-100 max-[900px]:hidden";

/** A gutter box shows on its row's hover or focus. Its look is the global checkbox's (tailwind.css). */
const BOX =
  "align-middle transition-opacity duration-150 focus-visible:opacity-100 checked:opacity-100";

/** The rows part: see the file's head. */
export function Rows<T>(p: RowsProps<T>) {
  const { columns, name, narrow, pick, open } = p;
  const body = useRef<HTMLTableSectionElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const drawn = drawnOf(p.lines, p.group?.folded, p.wait);
  const root = useCallback(() => body.current ?? list.current, []);
  // A long list draws the lines in view: the panel scrolls them, on a phone the page does.
  const lines = useLines({
    count: drawn.length,
    scroller: narrow ? "window" : p.scroller,
    root,
    estimate: narrow ? 76 : 42,
  });
  // The keyboard's row comes into view, drawn first in a long list.
  const reveal = useRef(lines.reveal);
  reveal.current = lines.reveal;
  const at = useRef(drawn);
  at.current = drawn;
  const cursor = p.cursor ?? -1;
  useEffect(() => {
    if (cursor < 0) return;
    const i = at.current.findIndex((l) => l.kind === "row" && l.index === cursor);
    if (i >= 0) reveal.current(i);
  }, [cursor]);

  const span = columns.length + 3;
  const anyPicked = (pick?.count ?? 0) > 0;
  const phoneCol = columns.find((c) => c.phone);
  // Column lines draw in the table; a grouped table (the folds) reads by its rows only.
  const ruled = p.group ? "" : TH_LINE;
  const totals = columns.some((c) => c.total);
  const rows = p.lines.filter((l) => l.kind === "row").length;

  /** One row's own pieces, shared by the table and the phone. */
  const rowOf = (l: Extract<RowsLine<T>, { kind: "row" }>) => {
    const state = p.rowState?.(l.row);
    return {
      id: l.key,
      isOpen: open?.id === l.key,
      going: state?.going,
      changed: !!state?.changed,
      picked: pick?.picked(l.key) ?? false,
      onOpen: () => open?.onOpen(l.row, l.index),
    };
  };

  if (narrow)
    return (
      <>
        <ul
          ref={list}
          className={cn("list-none", p.empty && "hidden", p.className)}
          aria-label={p.label}
        >
          {p.loading ? (
            Array.from({ length: 8 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
              <li key={i} className="grid gap-2 border-b border-(--ui-hair) px-4 py-4">
                <div className="h-3.5 w-2/3 animate-pulse bg-(--ui-fill)" />
                <div className="h-3 w-1/3 animate-pulse bg-(--ui-wash)" />
              </li>
            ))
          ) : (
            <>
              {lines.before ? <li aria-hidden style={{ height: lines.before }} /> : null}
              {lines.shown.map((n) => {
                const l = drawn[n];
                if (!l) return null;
                const line = { "data-index": n, ref: lines.measure };
                if (l.kind === "tier" || l.kind === "group")
                  return (
                    <li
                      key={l.key}
                      {...line}
                      className={cn(
                        // The fold's look (artifact `.gh`), a tier's head too.
                        "sticky top-(--phone-bar,0px) z-2 border-b border-(--ui-hair) bg-(--ui-paper) text-[13px] font-semibold text-(--ui-ink-3)",
                      )}
                    >
                      {l.kind === "tier" ? (
                        <div className="px-3.5 pt-3 pb-2">{l.head}</div>
                      ) : (
                        <GroupFold
                          label={l.label}
                          color={l.color}
                          stats={l.stats ?? statsOf([])}
                          shut={!!p.group?.folded.has(l.key)}
                          toggle={() => p.group?.toggle(l.key)}
                        />
                      )}
                    </li>
                  );
                if (l.kind === "box")
                  return (
                    <li
                      key={l.key}
                      {...line}
                      className="border-b border-(--ui-hair) bg-(--ui-wash) px-4 py-3"
                    >
                      {l.node}
                    </li>
                  );
                const r = rowOf(l);
                const act = p.act?.(l.row);
                const side = phoneCol?.cell(l.row, l.index);
                // The page's own attributes (a mark, a drag, a focus hook) ride on the phone's row too.
                // They are typed for a table row; an li takes the same events.
                const { className: own, ...attrs } = (p.rowProps?.(l.row, l.index) ??
                  {}) as LiAttrs;
                return (
                  <SwipeRow
                    key={l.key}
                    {...attrs}
                    swipes={p.swipes?.(l.row) ?? null}
                    data-row={l.index}
                    data-index={n}
                    measure={lines.measure}
                    onTap={(e) => {
                      // Its box, links and buttons do their own thing.
                      if ((e.target as Element).closest("input, a, button, label")) return;
                      r.onOpen();
                    }}
                    onAnimationEnd={(e) => {
                      if (e.animationName === "ui-changed") p.onSettled?.();
                    }}
                    className={cn(
                      "cursor-pointer border-b border-(--ui-hair) last:border-b-0 [&>[data-face]]:flex [&>[data-face]]:min-h-11 [&>[data-face]]:items-center active:[&>[data-face]]:bg-(--ui-accent-wash)",
                      r.isOpen && "[&>[data-face]]:bg-(--ui-fill)",
                      r.picked && "[&>[data-face]]:bg-(--ui-accent-tint)",
                      r.changed && "[&>[data-face]]:animate-ui-changed",
                      r.going && "[&>[data-face]]:bg-(--ui-wash)",
                      own,
                    )}
                  >
                    {pick ? (
                      <label className="grid size-11 flex-none cursor-pointer place-items-center">
                        <input
                          type="checkbox"
                          aria-label={`Select ${name.title(l.row)}`}
                          checked={r.picked}
                          onChange={() => pick.toggle(l.key)}
                        />
                      </label>
                    ) : (
                      <span className="w-4 flex-none" />
                    )}
                    <div className="min-w-0 flex-1 py-3 pr-2">
                      <NameCell
                        name={name}
                        row={l.row}
                        narrow
                        onOpen={open ? r.onOpen : undefined}
                      />
                      {r.going ? (
                        <span className="mt-1 block">
                          <Tag tone="accent" busy>
                            {r.going}
                          </Tag>
                        </span>
                      ) : null}
                    </div>
                    {side ? (
                      <div className="max-w-[40%] flex-none truncate pr-1 text-right text-[13.5px] text-(--ui-ink-2)">
                        {side}
                      </div>
                    ) : null}
                    <div className="flex size-11 flex-none items-center justify-center">
                      {act ? (
                        <RowActions
                          lone
                          title={name.title(l.row)}
                          main={act.main}
                          more={act.more}
                          reply={act.reply}
                          page={act.page}
                          busy={act.busy}
                          run={act.run}
                        />
                      ) : (
                        (p.end?.(l.row) ?? null)
                      )}
                    </div>
                  </SwipeRow>
                );
              })}
              {lines.after ? <li aria-hidden style={{ height: lines.after }} /> : null}
            </>
          )}
        </ul>
        {/* The artifact's phone foot: the count alone (Late and Oldest hide under 720px). */}
        {!p.loading && rows && p.foot && !p.empty ? (
          <div className="border-t border-(--ui-hair) px-3.5 py-2.5 text-[12px] text-(--ui-ink-3)">
            {p.foot}
          </div>
        ) : null}
      </>
    );

  return (
    <table
      aria-label={p.label}
      // An empty view shows what fills it, not a row of column heads over nothing.
      className={cn(
        "w-full table-fixed border-collapse text-[14px]",
        p.empty && "hidden",
        p.className,
      )}
      style={{
        minWidth:
          GUTTER +
          END +
          (name.width ?? name.min ?? 220) +
          columns.reduce((n, c) => n + (c.width ?? c.min ?? 144), 0),
      }}
    >
      <colgroup>
        <col style={{ width: GUTTER }} />
        <col style={name.width === undefined ? undefined : { width: name.width }} />
        {columns.map((c) => (
          // A column with no width takes what the others leave; the min width keeps its share.
          <col key={c.key} style={c.width === undefined ? undefined : { width: c.width }} />
        ))}
        <col style={{ width: END }} />
      </colgroup>
      <thead>
        <tr className="text-[12.5px] text-(--ui-ink-3) [&>th]:font-normal">
          <th
            className={cn(
              "group/all sticky top-0 z-10 h-[34px] border-y border-(--ui-hair) bg-(--ui-paper) p-0 text-center",
            )}
          >
            {pick ? (
              <input
                type="checkbox"
                aria-label={`Select every ${p.noun ?? "row"} shown`}
                checked={pick.all}
                onChange={pick.toggleAll}
                className={cn(
                  BOX,
                  "opacity-0 group-hover/all:opacity-100",
                  anyPicked && "opacity-100",
                )}
              />
            ) : (
              // A head with no text fails a reader; the gutter holds no box here.
              <span className="sr-only">Row</span>
            )}
          </th>
          {[{ ...name, key: "name", align: undefined }, ...columns].map((c) => (
            <th
              key={c.key}
              scope="col"
              className={cn(
                "sticky top-0 z-10 h-[34px] border-y border-(--ui-hair) bg-(--ui-paper) px-2.5 leading-tight whitespace-nowrap",
                ruled,
                c.align === "end" ? "text-right" : "text-left",
                c.className,
              )}
            >
              <span
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 align-middle",
                  c.align === "end" && "flex-row-reverse",
                )}
              >
                {c.icon ? (
                  <Icon name={c.icon} size={15} className="text-(--ui-ink-3) [stroke-width:1.8]" />
                ) : null}
                {c.sort ?? <span className="truncate">{c.label}</span>}
              </span>
            </th>
          ))}
          <th
            className={cn("sticky top-0 z-10 border-y border-(--ui-hair) bg-(--ui-paper)", ruled)}
          >
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody ref={body}>
        {p.loading ? (
          Array.from({ length: 10 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
            <tr key={i} className="h-(--layout-row) border-b border-(--ui-hair)">
              <td colSpan={span} className="px-3">
                <div className="h-3 w-2/3 animate-pulse bg-(--ui-fill)" />
              </td>
            </tr>
          ))
        ) : (
          <>
            {lines.before ? (
              <tr aria-hidden style={{ height: lines.before }}>
                <td colSpan={span} />
              </tr>
            ) : null}
            {lines.shown.map((n) => {
              const l = drawn[n];
              if (!l) return null;
              const line = { "data-index": n, ref: lines.measure };
              if (l.kind === "group")
                return (
                  <tr key={l.key} {...line} data-group="" className="border-b border-(--ui-hair)">
                    <td colSpan={span} className="p-0">
                      <GroupFold
                        label={l.label}
                        color={l.color}
                        stats={l.stats ?? statsOf([])}
                        shut={!!p.group?.folded.has(l.key)}
                        toggle={() => p.group?.toggle(l.key)}
                      />
                    </td>
                  </tr>
                );
              if (l.kind === "tier")
                return (
                  <tr key={l.key} {...line} className="border-b border-(--ui-hair)">
                    <th
                      colSpan={span}
                      scope="colgroup"
                      className="px-3.5 pt-3 pb-2 text-left text-[13px] font-semibold text-(--ui-ink-3)"
                    >
                      {l.head}
                    </th>
                  </tr>
                );
              if (l.kind === "box")
                return (
                  <tr key={l.key} {...line} className="border-b border-(--ui-hair) bg-(--ui-wash)">
                    <td />
                    <td colSpan={span - 1} className="px-3 py-3">
                      {l.node}
                    </td>
                  </tr>
                );
              const r = rowOf(l);
              const own = p.rowProps?.(l.row, l.index);
              const act = p.act?.(l.row);
              const shown = name.sub ? "py-1.5" : "";
              return (
                <tr
                  key={l.key}
                  {...own}
                  {...line}
                  data-row={l.index}
                  data-cursor={l.index === cursor && !r.isOpen ? "" : undefined}
                  onClick={(e) => {
                    // Its checkbox, links and buttons do their own thing.
                    if ((e.target as Element).closest("input, a, button, label")) return;
                    r.onOpen();
                  }}
                  onAnimationEnd={(e) => {
                    if (e.animationName === "ui-changed") p.onSettled?.();
                  }}
                  className={cn(
                    "group h-(--layout-row) cursor-pointer border-b border-(--ui-hair) transition-[background-color] duration-150 pointer-coarse:h-12 has-[+[data-group]]:border-b-0 motion-reduce:transition-none",
                    groundOf(r.isOpen, r.picked, l.index === cursor),
                    r.changed && "animate-ui-changed",
                    r.going && "bg-(--ui-wash)",
                    own?.className,
                  )}
                >
                  <td className="p-0 text-center">
                    {pick ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${name.title(l.row)}`}
                        checked={r.picked}
                        onChange={() => {}}
                        onClick={(e) => pick.toggle(l.key, e.shiftKey)}
                        className={cn(
                          BOX,
                          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-cursor:opacity-100",
                          anyPicked && "opacity-100",
                        )}
                      />
                    ) : null}
                  </td>
                  <td className={cn("px-2.5", shown, ruled, name.className)}>
                    <div className="flex min-w-0 items-center gap-2">
                      <NameCell
                        name={name}
                        row={l.row}
                        narrow={false}
                        onOpen={open ? r.onOpen : undefined}
                        className="flex-1"
                      />
                      {name.href ? (
                        <a href={name.href(l.row)} tabIndex={-1} className={OPEN_CHIP}>
                          <Icon name="expand" size={12} />
                          Open
                        </a>
                      ) : open ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={r.onOpen}
                          className={OPEN_CHIP}
                        >
                          <Icon name="expand" size={12} />
                          Open
                        </button>
                      ) : null}
                    </div>
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      {...clipProps()}
                      className={cn(
                        // A cut cell drops its break chances: Chrome breaks at <wbr> even under
                        // nowrap, so "example.com" wrapped onto two lines.
                        "truncate px-2.5 [&_wbr]:hidden",
                        ruled,
                        shown,
                        c.align === "end" ? "text-right" : "text-left",
                        // When it happened reads quieter than what it is.
                        c.quiet
                          ? "text-(--ui-ink-3) tabular-nums"
                          : "text-[13.5px] text-(--ui-ink-2)",
                        c.className,
                      )}
                    >
                      {c.cell(l.row, l.index)}
                    </td>
                  ))}
                  <td className={cn("relative pr-2 text-right", ruled)}>
                    {r.going ? (
                      <span className="absolute inset-y-0 right-2 z-1 flex items-center">
                        <Tag tone="accent" busy>
                          {r.going}
                        </Tag>
                      </span>
                    ) : act ? (
                      <RowActions
                        title={name.title(l.row)}
                        main={act.main}
                        more={act.more}
                        reply={act.reply}
                        page={act.page}
                        busy={act.busy}
                        run={act.run}
                      />
                    ) : (
                      (p.end?.(l.row) ?? null)
                    )}
                  </td>
                </tr>
              );
            })}
            {lines.after ? (
              <tr aria-hidden style={{ height: lines.after }}>
                <td colSpan={span} />
              </tr>
            ) : null}
          </>
        )}
      </tbody>
      {!p.loading && rows && (p.foot || totals) ? (
        <tfoot>
          {totals ? (
            <tr className="text-[12px] text-(--ui-ink-2)">
              <td
                className={cn(
                  "sticky h-9 border-t border-(--ui-edge) bg-(--ui-paper)",
                  p.foot ? "bottom-[34px]" : "bottom-0",
                )}
              />
              <td
                className={cn(
                  "sticky border-t border-(--ui-edge) bg-(--ui-paper)",
                  p.foot ? "bottom-[34px]" : "bottom-0",
                )}
              />
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "sticky truncate border-t border-(--ui-edge) bg-(--ui-paper) px-2.5",
                    p.foot ? "bottom-[34px]" : "bottom-0",
                    c.align === "end" ? "text-right" : "text-left",
                  )}
                >
                  {c.total}
                </td>
              ))}
              <td
                className={cn(
                  "sticky border-t border-(--ui-edge) bg-(--ui-paper)",
                  p.foot ? "bottom-[34px]" : "bottom-0",
                )}
              />
            </tr>
          ) : null}
          {p.foot ? (
            <tr className="text-[12px] text-(--ui-ink-3)">
              <td
                colSpan={span}
                className="sticky bottom-0 border-t border-(--ui-hair) bg-(--ui-paper) pt-[9px] pr-3.5 pb-2.5 pl-[38px] max-[900px]:pl-3.5"
              >
                {p.foot}
              </td>
            </tr>
          ) : null}
        </tfoot>
      ) : null}
    </table>
  );
}

/** Initials for an avatar from a person's name. */
export const avatarOf = (title: string): string | null => initials(title) || null;
