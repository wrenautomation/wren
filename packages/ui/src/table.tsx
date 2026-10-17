/**
 * Every table in the portal, on TanStack Table (designs/2026-10-16-portal-libs.md, "Table"). The
 * library keeps the state (sorting, which columns show and in what order, grouping, row
 * selection); this file draws it in the kit's look. Two shapes:
 *
 *   `useListTable`  a record list's rows: the address says the sort, columns and group; the
 *                   server sorts and pages, so the table only groups, orders and selects.
 *   `DataTable`     a small table of facts (a template's versions, a page's numbers), drawn
 *                   whole, stacking into cards on a phone where asked.
 *
 * Long lists draw only the rows in view (`useLines`, on TanStack Virtual).
 */
import {
  type ColumnDef,
  columnGroupingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createGroupedRowModel,
  flexRender,
  type RowData,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual";
import type { FieldMeta, RecordMeta } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import { cn } from "cn";
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

/** The features every table here registers: one set, so every table reads its state alike. */
export const TABLE_FEATURES = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  columnGroupingFeature,
  rowExpandingFeature,
  rowSelectionFeature,
  groupedRowModel: createGroupedRowModel(),
  expandedRowModel: createExpandedRowModel(),
});
type Features = typeof TABLE_FEATURES;

/** The column a "Needs you" / "For info" split groups by; never drawn. */
const TIER = "__tier";

/** A sort as the address says it (`-at`), as the table's sorting state. */
export function sortingOf(sort: string | undefined): { id: string; desc: boolean }[] {
  if (!sort) return [];
  const desc = sort.startsWith("-");
  return [{ id: desc ? sort.slice(1) : sort, desc }];
}

/** A selection as a set of row ids, and back. */
const selectionOf = (picked: ReadonlySet<string>): Record<string, true> =>
  Object.fromEntries([...picked].map((id) => [id, true as const]));

/** One line a record list draws, in order: a group's band, a tier's band, or a row. */
export type ListLine =
  | { kind: "group"; key: string; field: FieldMeta; value: string; first: Row; n: number }
  | { kind: "tier"; key: string; needs: boolean; n: number }
  | { kind: "row"; key: string; row: Row; index: number };

export interface ListTable {
  /** The columns to draw, in the address's order. */
  cols: FieldMeta[];
  /** The rows in the order they draw (grouped rows sit together). */
  rows: Row[];
  /** The bands and rows, in order. */
  lines: ListLine[];
  /** Whether a column is the one the list sorts by, and which way. */
  sorted: (key: string) => false | "asc" | "desc";
  all: boolean;
  some: boolean;
  /** Select every row shown, or none. */
  toggleAll: () => void;
  picked: (id: string) => boolean;
  /** Select one row, or let it go. */
  toggle: (id: string) => void;
}

/**
 * A record list's table. `cols` are the columns to show, in order; `split` is where "For info"
 * starts when what waits on the viewer comes first (-1 for no split). Rows group by `group`,
 * in the order the server sent them. A folded row (one person's messages, `RecordMeta.fold`)
 * is one row here: the server folds before it counts, filters and pages, and the row's
 * messages draw inside its title cell.
 */
export function useListTable({
  meta,
  rows,
  cols,
  sort,
  group,
  split,
  picked,
  onPicked,
}: {
  meta: Pick<RecordMeta, "fields">;
  rows: Row[];
  cols: FieldMeta[];
  sort: string | undefined;
  group: FieldMeta | null;
  split: number;
  picked: ReadonlySet<string>;
  onPicked: (next: Set<string>) => void;
}): ListTable {
  const fields = useMemo(() => meta.fields.filter((f) => f.column || f === group), [meta, group]);
  const columns = useMemo<ColumnDef<Features, Row>[]>(
    () => [
      ...fields.map((f) => ({
        id: f.key,
        accessorFn: (r: Row) => (f === group ? String(r[f.key] ?? "") : r[f.key]),
      })),
      { id: TIER, accessorFn: (_r: Row, i: number) => (i < split ? "needs" : "info") },
    ],
    [fields, group, split],
  );
  const shown = cols.map((f) => f.key);
  const grouping = group ? [group.key] : split > 0 ? [TIER] : [];
  const table = useTable({
    features: TABLE_FEATURES,
    columns,
    data: rows,
    getRowId: (r) => String(r.id),
    manualSorting: true,
    groupedColumnMode: false,
    enableRowSelection: true,
    state: {
      sorting: sortingOf(sort),
      columnOrder: shown,
      columnVisibility: Object.fromEntries(columns.map((c) => [c.id, shown.includes(c.id ?? "")])),
      grouping,
      expanded: true,
      rowSelection: selectionOf(picked),
    },
    onRowSelectionChange: (next) => {
      const now = typeof next === "function" ? next(selectionOf(picked)) : next;
      onPicked(new Set(Object.keys(now).filter((id) => now[id])));
    },
  });
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const visible = table
    .getVisibleLeafColumns()
    .flatMap((c) => (byKey.has(c.id) ? [byKey.get(c.id) as FieldMeta] : []));
  const lines: ListLine[] = [];
  const order: Row[] = [];
  for (const r of table.getRowModel().rows) {
    if (r.getIsGrouped()) {
      const n = r.getLeafRows().length;
      const first = r.subRows[0]?.original;
      if (!first) continue;
      if (group)
        lines.push({
          kind: "group",
          key: `group:${r.id}`,
          field: group,
          value: String(r.getGroupingValue(group.key) ?? ""),
          first,
          n,
        });
      else
        lines.push({
          kind: "tier",
          key: `tier:${r.id}`,
          needs: r.getGroupingValue(TIER) === "needs",
          n,
        });
      continue;
    }
    lines.push({ kind: "row", key: r.id, row: r.original, index: order.length });
    order.push(r.original);
  }
  const sorting = table.state.sorting;
  return {
    cols: visible,
    rows: order,
    lines,
    sorted: (key) => {
      const s = sorting.find((x: { id: string }) => x.id === key);
      return s ? (s.desc ? "desc" : "asc") : false;
    },
    all: table.getIsAllRowsSelected(),
    some: table.getIsSomeRowsSelected() || table.getIsAllRowsSelected(),
    toggleAll: () => table.toggleAllRowsSelected(),
    picked: (id) => !!table.state.rowSelection[id],
    toggle: (id) => {
      const next = new Set(picked);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onPicked(next);
    },
  };
}

/** Lines past this many draw only those in view. */
export const VIRTUAL_FROM = 120;

export interface Lines {
  /** Whether only the lines in view draw. */
  on: boolean;
  /** The lines to draw now, by index into the whole list. */
  shown: number[];
  /** Room above and below the drawn lines, in px, so the scrollbar keeps the whole list's size. */
  before: number;
  after: number;
  /** Put on each drawn line's element (with `data-index`) so its real height is used. */
  measure: (el: Element | null) => void;
  /** Scroll line `i` into view. */
  reveal: (i: number) => void;
}

/**
 * Which of `count` lines to draw. Past `VIRTUAL_FROM` only those in view of `scroller` (a
 * panel that scrolls) or of the window (`scroller` "window": a phone's page) draw; under it,
 * every line draws as before and `reveal` scrolls the line's element into view.
 */
export function useLines({
  count,
  scroller,
  root,
  estimate,
}: {
  count: number;
  /** The element that scrolls, or "window". */
  scroller: HTMLElement | null | "window";
  /** Where the lines sit, for `reveal` under the threshold: it finds `[data-index]` in it. */
  root: () => HTMLElement | null;
  estimate: number;
}): Lines {
  const on = count > VIRTUAL_FROM;
  const inPanel = on && scroller !== "window";
  const inWindow = on && scroller === "window";
  // Where the list starts on the page: the window scrolls past the page's head first.
  const [margin, setMargin] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the head above can grow as rows land.
  useLayoutEffect(() => {
    if (!inWindow) return;
    const el = root();
    if (el) setMargin(el.getBoundingClientRect().top + scrollY);
  }, [inWindow, root, count]);
  const panel = useVirtualizer<HTMLElement, Element>({
    count,
    getScrollElement: () => (scroller === "window" ? null : scroller),
    estimateSize: () => estimate,
    overscan: 12,
    enabled: inPanel,
  });
  const page = useWindowVirtualizer<Element>({
    count,
    estimateSize: () => estimate,
    overscan: 12,
    enabled: inWindow,
    scrollMargin: margin,
  });
  const v = inPanel ? panel : page;
  const items = on ? v.getVirtualItems() : [];
  const offset = inWindow ? margin : 0;
  const before = items.length ? (items[0]?.start ?? 0) - offset : 0;
  const after = items.length ? v.getTotalSize() - ((items.at(-1)?.end ?? 0) - offset) : 0;
  const reveal = useCallback(
    (i: number) => {
      if (on) v.scrollToIndex(i, { align: "auto" });
      else root()?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" });
    },
    [on, v, root],
  );
  return {
    on,
    shown: on ? items.map((x) => x.index) : Array.from({ length: count }, (_, i) => i),
    before,
    after,
    measure: on ? v.measureElement : () => {},
    reveal,
  };
}

/** A column of a `DataTable`: its head and what each row shows in it. */
export interface TableColumn<T extends RowData> {
  key: string;
  /** Its head: words, or a control (a select-all box). */
  label: ReactNode;
  /** Numbers sit at the end of their cell. */
  end?: boolean;
  /** Classes on its head and every cell: a width, or a breakpoint it shows from. */
  className?: string;
  cell: (row: T, index: number) => ReactNode;
}

/** What a `DataTable` row carries beyond its cells: a drag, a mark, a class. */
export type RowAttrs = HTMLAttributes<HTMLTableRowElement> & {
  [data: `data-${string}`]: string | number | boolean | undefined;
};

/** How a `DataTable` looks: plain facts on the page, or framed as a small list in a panel. */
const LOOKS = {
  plain: {
    table: "w-full text-left text-[13.5px]",
    head: "text-(--ui-ink-2)",
    headRow: "border-b border-(--ui-hair)",
    th: "py-1.5 pr-3 font-normal",
    row: "border-b border-(--ui-hair) align-top",
    td: "py-1.5 pr-3",
  },
  framed: {
    table:
      "w-full table-fixed border-collapse border border-(--ui-hair) text-[13px] [&_tbody>tr:last-child]:border-b-0",
    head: "bg-(--ui-band) text-[12px] text-(--ui-ink-2)",
    headRow: "",
    th: "h-8 truncate border-b border-(--ui-edge) px-2 font-semibold first:w-1/2 first:pl-3",
    row: "h-(--layout-row) border-b border-(--ui-hair)",
    // The first cell wraps: a cut-off name says nothing. The rest cut.
    td: "px-2 first:py-2 first:break-words first:pl-3 last:pr-3 [&:not(:first-child)]:truncate [&:not(:first-child)]:text-(--ui-ink-2)",
  },
  /** A list of things to pick and open (Learn's files): fixed columns, roomier rows. */
  list: {
    table: "w-full table-fixed border-collapse text-[13.5px]",
    head: "border-b border-(--ui-hair)",
    headRow: "",
    th: "h-9 px-2 text-[12px] font-medium text-(--ui-ink-2)",
    row: "border-b border-(--ui-hair) transition-colors duration-100 hover:bg-(--ui-wash)",
    td: "px-2 py-2",
  },
} as const;

/**
 * A small table of facts, drawn whole. With `stack`, a phone shows each row as a card: its
 * first cell on top, the rest as label and value, so the first column isn't crushed.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  rowKey,
  stack = false,
  look = "plain",
  rowProps,
  className,
}: {
  columns: TableColumn<T>[];
  data: readonly T[];
  rowKey?: (row: T, index: number) => string | number;
  stack?: boolean;
  look?: keyof typeof LOOKS;
  /** Each row's own attributes; its `className` joins the look's. */
  rowProps?: (row: T, index: number) => RowAttrs;
  className?: string;
}) {
  const at = LOOKS[look];
  const defs = useMemo<ColumnDef<Features, T>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        header: () => c.label,
        accessorFn: (_r: T, i: number) => i,
        cell: (ctx) => c.cell(ctx.row.original, ctx.row.index),
      })),
    [columns],
  );
  const table = useTable({
    features: TABLE_FEATURES,
    columns: defs,
    data: data as T[],
    getRowId: (r, i) => String(rowKey?.(r, i) ?? i),
  });
  const ends = new Set(columns.filter((c) => c.end).map((c) => c.key));
  const labels = new Map(columns.map((c) => [c.key, c.label]));
  const classes = new Map(columns.map((c) => [c.key, c.className]));
  const rows = table.getRowModel().rows;
  return (
    <>
      <div className={cn(stack ? "hidden overflow-x-auto sm:block" : "overflow-x-auto", className)}>
        <table className={at.table}>
          <thead className={at.head}>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id} className={at.headRow}>
                {g.headers.map((h) => (
                  <th
                    key={h.id}
                    className={cn(
                      at.th,
                      ends.has(h.column.id) ? "text-right" : "text-left",
                      classes.get(h.column.id),
                    )}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((r) => {
              const own = rowProps?.(r.original, r.index);
              return (
                <tr key={r.id} {...own} className={cn(at.row, own?.className)}>
                  {r.getVisibleCells().map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        at.td,
                        ends.has(c.column.id) && "text-right tabular-nums",
                        classes.get(c.column.id),
                      )}
                    >
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {stack ? (
        <ul className="grid gap-3 sm:hidden">
          {rows.map((r) => {
            const [lead, ...rest] = r.getVisibleCells();
            return (
              <li key={r.id} className="grid gap-2 border-b border-(--ui-hair) pb-3 text-[14px]">
                <div className="[overflow-wrap:anywhere]">
                  {lead ? flexRender(lead.column.columnDef.cell, lead.getContext()) : null}
                </div>
                <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5">
                  {rest.map((c) => {
                    const said = flexRender(c.column.columnDef.cell, c.getContext());
                    if (said === "" || said === null || said === undefined) return null;
                    return (
                      <div key={c.id} className="grid min-w-0 gap-0.5">
                        <dt className="text-[12px] text-(--ui-ink-3)">{labels.get(c.column.id)}</dt>
                        <dd className="[overflow-wrap:anywhere] tabular-nums">{said}</dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

/**
 * A positional table (heads, and rows of cells) as `DataTable` columns: for a page that already
 * has its cells in hand. A head as `[label, "r"]` sits at the end of its cell.
 */
export function cellsOf(
  head: readonly (string | readonly [string, "r"])[],
  rows: readonly ReactNode[][],
): { columns: TableColumn<ReactNode[]>[]; data: readonly ReactNode[][] } {
  return {
    columns: head.map((h, j) => {
      const [label, end] = typeof h === "string" ? [h, false] : [h[0], true];
      return { key: `${j}:${label}`, label, end: j > 0 && end, cell: (r) => r[j] };
    }),
    data: rows,
  };
}

/** A table of facts from heads and rows of cells: `DataTable` for a page with its cells in hand. */
export function FactsTable({
  head,
  rows,
  stack = false,
}: {
  head: readonly (string | readonly [string, "r"])[];
  rows: readonly ReactNode[][];
  stack?: boolean;
}) {
  return <DataTable {...cellsOf(head, rows)} stack={stack} />;
}
