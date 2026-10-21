/** Facts: label and value pairs. Callers bring the values; nothing here knows what they mean. */
import type { ReactNode } from "react";
import { cx } from "./format.js";
import { NOT_SET, type SettingField, settingRows } from "./settings.js";

/** Label and value pairs, one per line. */
export function Facts({
  items,
  className,
}: {
  items: [label: string, value: ReactNode][];
  className?: string | undefined;
}) {
  return (
    // The artifact's label and value list (`.pk dl`): ink-3 labels, no rules between.
    <dl
      className={cx(
        "m-0 grid grid-cols-[minmax(96px,max-content)_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[13.5px]",
        className,
      )}
    >
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-(--ui-ink-3)">{label}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A list's items, each with a key of its own: the second "x" is "x#2". */
const keyed = (items: readonly string[]): [string, string][] => {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const n = (seen.get(item) ?? 0) + 1;
    seen.set(item, n);
    return [`${item}#${n}`, item];
  });
};

/** A part's settings as Facts: labels from its form, values in words, a list as its items. */
export function Settings({
  values,
  fields,
  className,
}: {
  values: Readonly<Record<string, unknown>> | null | undefined;
  fields?: readonly SettingField[] | null | undefined;
  className?: string | undefined;
}) {
  const rows = settingRows(values, fields);
  if (!rows.length) return null;
  return (
    <Facts
      className={className}
      items={rows.map(([label, v]) => [
        label,
        typeof v === "string" ? (
          <span key={label} className={v === NOT_SET ? "text-(--ui-ink-2)" : undefined}>
            {v}
          </span>
        ) : (
          <ul key={label} className="grid gap-0.5">
            {keyed(v).map(([key, item]) => (
              <li key={key}>{item}</li>
            ))}
          </ul>
        ),
      ])}
    />
  );
}
