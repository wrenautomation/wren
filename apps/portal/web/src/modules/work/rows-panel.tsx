/**
 * A list of records drawn with `Rows`, in the bordered panel the design language's lists sit in
 * (artifact #inbox F1). Pass the records and a key for each; the part takes the phone's shape and
 * the page's scroll. Records in `groups` get a fold each (artifact #inbox F2), shut or open here.
 * Every page's list uses this, never its own wrapper.
 */
import { Rows, RowsFoot, type RowsLine, type RowsProps, statsOf, useNarrow } from "@wren/ui";
import { type ReactNode, useState } from "react";

/** Records under one fold. */
export interface RowsGroup<T> {
  key: string;
  label: ReactNode;
  rows: readonly T[];
}

export function RowsPanel<T>({
  rows,
  groups,
  rowKey,
  box,
  narrow: fixed,
  scroller = "window",
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
  const screen = useNarrow();
  const narrow = fixed ?? screen;
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
  // The artifact's foot (#inbox F1): the count of what is listed, as the records lists show it.
  const foot = rest.foot ?? (
    <RowsFoot stats={statsOf(Array<null>(index).fill(null))} waits={false} />
  );
  return (
    <div className="overflow-x-auto border border-(--ui-hair) bg-(--ui-paper) [border-radius:var(--ui-leaf-panel)]">
      <Rows<T>
        {...rest}
        foot={foot}
        narrow={narrow}
        scroller={scroller}
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
    </div>
  );
}
