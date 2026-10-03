/**
 * A table you sort by clicking a head: TanStack Table in the kit's table look. Import it from
 * `@wren/ui/data-table` so TanStack loads only with the page that uses it.
 */
import {
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { Table } from "./data.js";
import { num } from "./format.js";

export type Cell = string | number | boolean | null;

export interface Column {
  key: string;
  label: string;
  /** Right-aligned and grouped by thousands. */
  numeric?: boolean;
}

const SORT_ICON = { asc: " ↑", desc: " ↓" } as const;

export function DataTable({
  columns,
  rows,
  sortBy,
}: {
  columns: Column[];
  rows: Record<string, Cell>[];
  /** Sorted by this column, largest first, until someone clicks a head. */
  sortBy?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>(sortBy ? [{ id: sortBy, desc: true }] : []);
  const table = useReactTable({
    data: rows,
    columns: columns.map((c) => ({ id: c.key, accessorKey: c.key, header: c.label })),
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const numeric = new Set(columns.filter((c) => c.numeric).map((c) => c.key));
  return (
    <Table>
      <thead>
        {table.getHeaderGroups().map((g) => (
          <tr key={g.id}>
            {g.headers.map((h) => {
              const dir = h.column.getIsSorted();
              return (
                <th
                  key={h.id}
                  className={numeric.has(h.id) ? "ui-num" : undefined}
                  aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  <button
                    type="button"
                    onClick={h.column.getToggleSortingHandler()}
                    className="cursor-pointer border-0 bg-transparent p-0 text-inherit [font:inherit] [letter-spacing:inherit] [text-transform:inherit]"
                  >
                    {String(h.column.columnDef.header)}
                    {dir ? SORT_ICON[dir] : null}
                  </button>
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((r) => (
          <tr key={r.id}>
            {r.getVisibleCells().map((c) => {
              const v = c.getValue() as Cell;
              const n = numeric.has(c.column.id);
              return (
                <td key={c.id} className={n ? "ui-num" : undefined}>
                  {v === null ? "–" : n && typeof v === "number" ? num(v) : String(v)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
