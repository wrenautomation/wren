/**
 * A list of records drawn with `Rows`, from records and a key for each (`PageRows` takes lines).
 * Records in `groups` get a fold each (artifact #inbox F2), shut or open here. The phone's
 * shape and the page's scroll are `PageRows`': one wrapper for every page.
 */
import type { RowsLine, RowsProps } from "@wren/ui";
import { type ReactNode, useState } from "react";
import { PageRows } from "../../page-rows.js";

/** Records under one fold. */
interface RowsGroup<T> {
  key: string;
  label: ReactNode;
  rows: readonly T[];
}

export function RowsPanel<T>({
  rows,
  groups,
  rowKey,
  box,
  ...rest
}: Omit<RowsProps<T>, "lines" | "narrow" | "scroller" | "group"> & {
  /** The records, in one run; or `groups`, each under its fold. */
  rows?: readonly T[];
  groups?: readonly RowsGroup<T>[];
  rowKey: (row: T) => string;
  /** A box under a row, when it has one (an answer under its question). */
  box?: (row: T) => ReactNode;
  /** A pane too narrow for columns (a side list) draws the phone's shape at any width. */
  narrow?: boolean;
  scroller?: RowsProps<T>["scroller"];
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const lines: RowsLine<T>[] = [];
  let index = 0;
  for (const g of groups ?? [{ key: "", label: null, rows: rows ?? [] }]) {
    if (groups) lines.push({ kind: "group", key: `group:${g.key}`, label: g.label });
    for (const row of g.rows) {
      const key = rowKey(row);
      lines.push({ kind: "row", key, index: index++, row });
      const under = box?.(row);
      if (under) lines.push({ kind: "box", key: `${key}:box`, node: under });
    }
  }
  return (
    <PageRows<T>
      {...rest}
      lines={lines}
      group={
        groups
          ? {
              folded,
              toggle: (k) =>
                setFolded((s) => {
                  const next = new Set(s);
                  if (!next.delete(k)) next.add(k);
                  return next;
                }),
            }
          : undefined
      }
    />
  );
}
