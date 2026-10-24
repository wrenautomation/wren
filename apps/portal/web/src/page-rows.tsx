/**
 * A page's list of rows: the one shape every portal page uses for `Rows` (designs/2026-10-21-
 * crm-rows-everywhere.md). It sets what is the same on each page: a phone's rows, the page as the
 * scroller, and no panel or count foot (the app is flat). A page brings its columns, its lines and what
 * its rows do. A row's actions are `RowDoes`: each runs the page's own write path.
 */
import {
  type Action,
  type IconName,
  RowActions,
  Rows,
  type RowsLine,
  type RowsProps,
  rowActsOf,
  useNarrow,
} from "@wren/ui";
import { type ReactNode, useRef, useState } from "react";

/** The lines of `rows`, in order; `below` puts a box under a row (what a row opens). */
export function rowLines<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  below?: (row: T) => ReactNode,
): RowsLine<T>[] {
  return rows.flatMap((row, index): RowsLine<T>[] => {
    const key = keyOf(row);
    const box = below?.(row);
    return [
      { kind: "row", key, index, row },
      ...(box ? [{ kind: "box" as const, key: `${key}:box`, node: box }] : []),
    ];
  });
}

/** One thing a row does. `run` is the page's own write path; a `confirm` is asked first. */
export interface RowDo {
  id: string;
  label: string;
  /** Shown as the row's icon; none: behind ⋯. */
  icon?: IconName;
  /** Asked before it runs; the press stops on No. */
  confirm?: string;
  run: () => unknown;
}

/** A row's end cell: its actions as icons (a phone shows the first alone, the rest behind ⋯). */
export function RowDoes({
  title,
  does,
  busy = false,
  lone,
}: {
  title: string;
  does: readonly RowDo[];
  busy?: boolean;
  lone: boolean;
}) {
  if (does.length === 0) return null;
  const actions: Action[] = does.map((d) => ({ ...d, handler: "" }));
  const { main, more } = rowActsOf(actions, {});
  return (
    <RowActions
      title={title}
      main={main}
      more={more}
      reply={null}
      busy={busy}
      lone={lone}
      run={(a) => {
        const d = does.find((x) => x.id === a.id);
        if (!d || (d.confirm && !window.confirm(d.confirm))) return;
        void d.run();
      }}
    />
  );
}

type PageRowsProps<T> = Omit<RowsProps<T>, "narrow" | "scroller"> & {
  /** A pane too narrow for columns (a side list) draws the phone's shape at any width. */
  narrow?: boolean;
  scroller?: RowsProps<T>["scroller"];
};

/** `Rows` on the page, flat as the records lists: no panel, no inner scroll, no count foot. */
export function PageRows<T>({ narrow: fixed, scroller = "window", ...p }: PageRowsProps<T>) {
  const screen = useNarrow();
  return <Rows<T> {...p} narrow={fixed ?? screen} scroller={scroller} />;
}

/**
 * Which row a page's write is running on. A page's own write path takes one write at a time (a
 * second press is ignored), so this does too: `go` runs `fn` for the row `key` and shows it as
 * going until `fn` settles; a press on another row meanwhile does nothing.
 */
export function useGoing() {
  const [going, setGoing] = useState<{ key: string; word: string } | null>(null);
  const at = useRef<string | null>(null);
  const go = async (key: string, word: string, fn: () => Promise<unknown> | unknown) => {
    if (at.current !== null) return;
    at.current = key;
    setGoing({ key, word });
    try {
      await fn();
    } finally {
      at.current = null;
      setGoing(null);
    }
  };
  /** For `Rows`' `rowState`: the word on the row that is going. */
  const stateOf = (key: string) => ({ going: going?.key === key ? going.word : undefined });
  return { go, stateOf, busy: going !== null };
}
