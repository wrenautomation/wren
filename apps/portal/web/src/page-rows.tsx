/**
 * A page's list of rows: the one shape every portal page uses for `Rows` (designs/2026-10-21-
 * crm-rows-everywhere.md). It sets what is the same on each page: a phone's rows, the page as the
 * scroller, the bordered panel and a count foot. A page brings its columns, its lines and what
 * its rows do. A row's actions are `RowDoes`: each runs the page's own write path.
 */
import {
  type Action,
  RowActions,
  Rows,
  RowsFoot,
  type RowsLine,
  type RowsProps,
  rowActsOf,
  statsOf,
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
  /** Asked before it runs; the press stops on No. */
  confirm?: string;
  run: () => void | Promise<unknown>;
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
  const actions: Action[] = does.map((d) => ({ id: d.id, label: d.label, handler: "" }));
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

type PageRowsProps<T> = Omit<RowsProps<T>, "narrow" | "scroller" | "foot"> & {
  /** The foot; none draws the count. `false`: no foot. */
  foot?: ReactNode | false;
  /** The panel's own classes. */
  panel?: string;
};

/** `Rows` in its panel, for a page whose rows scroll with the page. */
export function PageRows<T>({ foot, panel, ...p }: PageRowsProps<T>) {
  const narrow = useNarrow();
  const count = p.lines.filter((l) => l.kind === "row").length;
  return (
    <div
      className={
        panel ??
        "overflow-x-auto border border-(--ui-hair) bg-(--ui-paper) [border-radius:var(--ui-leaf-panel)]"
      }
    >
      <Rows<T>
        {...p}
        narrow={narrow}
        scroller="window"
        foot={
          foot === false
            ? undefined
            : (foot ?? <RowsFoot stats={statsOf(Array(count).fill(null))} waits={false} />)
        }
      />
    </div>
  );
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
