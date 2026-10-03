/** Data as tables, facts, tallies and bars. Callers bring the rows; nothing here knows what they mean. */
import { cn } from "cn";
import type { ReactNode } from "react";
import { Table as ShadTable } from "./components/ui/table.js";
import { cx, num } from "./format.js";

/** The kit's table look on shadcn's table: label-case heads, hairline rows, a wash on hover. */
const TABLE =
  "border-collapse text-[14px] [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-(--ui-rule) [&_th]:text-(--ui-ink-2) [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:tracking-(--ui-label-tracking) [&_th]:text-left [&_th]:[text-transform:var(--ui-label-case)] [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-[13px] [&_td]:border-b [&_td]:border-(--ui-hair) [&_td]:align-top [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-200 [&_tbody_tr]:ease-(--ui-ease) [&_tbody_tr:hover]:bg-(--ui-wash) [&_tbody_tr[aria-selected=true]]:bg-(--ui-accent-wash) [&_.ui-num]:text-right";
/** On a phone, one block per row, each value under its `data-label`. */
const STACK =
  "max-[900px]:[&_[data-slot=table-container]]:overflow-visible max-[900px]:[&_table]:block max-[900px]:[&_tbody]:block max-[900px]:[&_thead]:absolute max-[900px]:[&_thead]:size-px max-[900px]:[&_thead]:overflow-hidden max-[900px]:[&_thead]:[clip-path:inset(50%)] max-[900px]:[&_tbody_tr]:flex max-[900px]:[&_tbody_tr]:flex-wrap max-[900px]:[&_tbody_tr]:gap-x-[22px] max-[900px]:[&_tbody_tr]:gap-y-3 max-[900px]:[&_tbody_tr]:px-3 max-[900px]:[&_tbody_tr]:py-4 max-[900px]:[&_tbody_tr]:border-b max-[900px]:[&_tbody_tr]:border-(--ui-hair) max-[900px]:[&_td]:block max-[900px]:[&_td]:min-w-0 max-[900px]:[&_td]:p-0 max-[900px]:[&_td]:border-0 max-[900px]:[&_td:first-child]:basis-full max-[900px]:[&_td[data-wide]]:basis-full max-[900px]:[&_td:empty]:hidden max-[900px]:[&_td[data-label]]:before:block max-[900px]:[&_td[data-label]]:before:mb-0.5 max-[900px]:[&_td[data-label]]:before:text-(--ui-ink-2) max-[900px]:[&_td[data-label]]:before:text-[11px] max-[900px]:[&_td[data-label]]:before:font-semibold max-[900px]:[&_td[data-label]]:before:tracking-(--ui-label-tracking) max-[900px]:[&_td[data-label]]:before:[text-transform:var(--ui-label-case)] max-[900px]:[&_td[data-label]]:before:content-[attr(data-label)] max-[900px]:[&_.ui-num]:text-left";

/**
 * A wide table that scrolls sideways on a phone. `stale` dims it while the next page loads.
 * `stack` instead turns each row into a block on a phone: every cell but the first shows its
 * `data-label` above it, and a cell marked `data-wide` takes the whole line.
 */
export function Table({
  stale = false,
  stack = false,
  className,
  children,
}: {
  stale?: boolean;
  stack?: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cn("-mx-3", stack && STACK, stale && "ui-stale", className)}>
      <ShadTable className={TABLE}>{children}</ShadTable>
    </div>
  );
}

/** Label and value pairs, one per line. */
export function Facts({
  items,
  className,
}: {
  items: [label: string, value: ReactNode][];
  className?: string | undefined;
}) {
  return (
    <dl className={cx("ui-facts", className)}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Counts by label, the number on the right. */
export function Tally({
  rows,
  className,
}: {
  rows: [label: string, count: number][];
  className?: string | undefined;
}) {
  return (
    <ul className={cx("ui-tally", className)}>
      {rows.map(([label, n]) => (
        <li key={label}>
          <span>{label}</span>
          <span className="ui-tally-n">{num(n)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Counts as bars, each a share of `total`. */
export function BarList({
  rows,
  total,
  className,
}: {
  rows: [label: string, count: number][];
  total: number;
  className?: string | undefined;
}) {
  return (
    <ul className={cx("ui-bars", className)}>
      {rows.map(([label, n]) => (
        <li key={label}>
          <span className="ui-bar-label">{label}</span>
          <span className="ui-bar-track">
            <span className="ui-bar-fill" style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
          </span>
          <span className="ui-bar-n">{num(n)}</span>
        </li>
      ))}
    </ul>
  );
}
