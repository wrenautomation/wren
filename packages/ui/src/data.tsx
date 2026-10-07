/** Facts: label and value pairs. Callers bring the values; nothing here knows what they mean. */
import type { ReactNode } from "react";
import { cx } from "./format.js";

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
          <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
