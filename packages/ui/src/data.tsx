/** Data as tables, facts, tallies and bars. Callers bring the rows; nothing here knows what they mean. */
import type { ReactNode } from "react";
import { cx, num } from "./format.js";

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
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("ui-table-wrap", stack && "ui-table-stack", stale && "ui-stale", className)}>
      <table className="ui-table">{children}</table>
    </div>
  );
}

/** Label and value pairs, one per line. */
export function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="ui-facts">
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
export function Tally({ rows }: { rows: [label: string, count: number][] }) {
  return (
    <ul className="ui-tally">
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
}: {
  rows: [label: string, count: number][];
  total: number;
}) {
  return (
    <ul className="ui-bars">
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
