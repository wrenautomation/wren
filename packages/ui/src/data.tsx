/** Data as tables and facts. Callers bring the rows; nothing here knows what they mean. */
import { cn } from "cn";
import type { ReactNode } from "react";
import { Table as ShadTable } from "./components/ui/table.js";
import { cx } from "./format.js";

/** The kit's table look on shadcn's table: label-case heads, hairline rows, a wash on hover. */
const TABLE =
  "border-collapse text-[14px] [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-(--ui-hair) [&_th]:text-(--ui-ink-2) [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:tracking-(--ui-label-tracking) [&_th]:text-left [&_th]:[text-transform:var(--ui-label-case)] [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-[13px] [&_td]:border-b [&_td]:border-(--ui-hair) [&_td]:align-top [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-200 [&_tbody_tr]:ease-(--ui-ease) [&_tbody_tr:hover]:bg-(--ui-wash) [&_tbody_tr[aria-selected=true]]:bg-(--ui-accent-wash) [&_.ui-num]:text-right";
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
    <div
      className={cn(
        "-mx-3",
        stack && STACK,
        stale && "opacity-55 transition-opacity duration-200",
        className,
      )}
    >
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
    <dl className={cx("grid text-[14px]", className)}>
      {items.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[minmax(120px,34%)_1fr] gap-4 border-b border-(--ui-hair) py-2 max-[640px]:grid-cols-1 max-[640px]:gap-0.5"
        >
          <dt className="text-(--ui-ink-2)">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
