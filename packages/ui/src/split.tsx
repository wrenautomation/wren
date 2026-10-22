/**
 * A whole and its parts (artifact section 15, `.ix-e`): the total first, one bar split by part,
 * then the parts as rows, each a link to its rows. The Inbox splits what waits by queue; Money
 * splits a month's spend by account. A share bar reads part of a whole better than a pie, and
 * the rows under it carry the exact figures. Flat on the page: no frame, the rows reach its edge.
 */
import { cn } from "cn";
import type { ReactNode } from "react";
import { Skeleton } from "./components/ui/skeleton.js";
import { Loading } from "./feedback.js";
import { Icon, type IconName } from "./icons.js";

export interface SplitRow {
  key: string;
  label: string;
  /** Under the label: "oldest 2 days", "Anthropic, Cloudflare". */
  note?: ReactNode;
  /** "late" in amber text, never a fill; "bad" when its read failed. */
  noteTone?: "late" | "bad" | undefined;
  /** Its share of the bar; 0 leaves it out of the bar and draws the row quiet. */
  weight: number;
  /** The figure at its end. */
  value: ReactNode;
  /** A CSS colour: its slice and its dot. */
  color: string;
  href: string;
  icon?: IconName | undefined;
}

const LATE = "text-(--ui-warn-ink)";

/** The total, its line, the bar and the rows. */
export function SplitPanel({
  label,
  total,
  line,
  rows,
}: {
  /** What the panel holds, for a screen reader: "What waits on you". */
  label: string;
  total: ReactNode;
  /** Beside the total: "wait on you · oldest 2 days". */
  line: ReactNode;
  rows: readonly SplitRow[];
}) {
  const bar = rows.filter((r) => r.weight > 0);
  return (
    <section aria-label={label} className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <b className="text-[48px] leading-[.9] font-semibold tracking-[-0.04em] tabular-nums">
          {total}
        </b>
        <span className="text-[15px] text-(--ui-ink-2)">{line}</span>
      </div>
      <div className="flex h-2.5 gap-0.5" aria-hidden="true">
        {bar.length ? (
          bar.map((r) => (
            <i
              key={r.key}
              className="block min-w-1 rounded-[2px_6px_2px_6px]"
              style={{ flex: r.weight, background: r.color }}
            />
          ))
        ) : (
          <i className="block flex-1 rounded-[2px_6px_2px_6px] bg-(--ui-fill)" />
        )}
      </div>
      <ul className="-mx-3 m-0 grid list-none p-0 [&>li+li>a]:shadow-[0_-1px_0_var(--ui-hair)]">
        {rows.map((r) => (
          <li key={r.key}>
            <SplitLine r={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SplitLine({ r }: { r: SplitRow }) {
  const quiet = r.weight === 0;
  return (
    <a
      href={r.href}
      className={cn(
        "grid items-center gap-3 px-3 py-2.5 text-[15px] no-underline transition-[background-color] duration-200 outline-none [border-radius:4px_12px_4px_12px] hover:bg-(--ui-accent-wash) focus-visible:bg-(--ui-accent-wash) motion-reduce:transition-none",
        r.icon
          ? "grid-cols-[10px_18px_minmax(0,1fr)_auto_12px]"
          : "grid-cols-[10px_minmax(0,1fr)_auto_12px]",
        quiet ? "text-(--ui-ink-3)" : "text-(--ui-ink)",
      )}
    >
      <i
        aria-hidden="true"
        className={cn("size-2.5 [border-radius:2px_5px_2px_5px]", quiet && "opacity-50")}
        style={{ background: r.color }}
      />
      {r.icon ? (
        <Icon
          name={r.icon}
          size={18}
          className={cn("[stroke-width:1.8]", quiet ? "text-(--ui-ink-3)" : "text-(--ui-ink-2)")}
        />
      ) : null}
      <span className="grid min-w-0 leading-[1.3]">
        <span className="wrap-anywhere whitespace-normal">{r.label}</span>
        {r.note ? (
          <small
            data-late={r.noteTone === "late" ? "" : undefined}
            className={cn(
              "wrap-anywhere whitespace-normal text-[12.5px]",
              r.noteTone === "late"
                ? LATE
                : r.noteTone === "bad"
                  ? "text-(--ui-bad)"
                  : "text-(--ui-ink-3)",
            )}
          >
            {r.note}
          </small>
        ) : null}
      </span>
      <b
        className={cn(
          "min-w-7 px-2 py-0.5 text-center text-[15px] font-semibold tabular-nums [border-radius:3px_10px_3px_10px]",
          quiet ? "text-(--ui-ink-3)" : "bg-(--ui-fill)",
        )}
      >
        {r.value}
      </b>
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="size-3 fill-none stroke-(--ui-ink-3) [stroke-width:2]"
      >
        <path d="M4 2l4 4-4 4" />
      </svg>
    </a>
  );
}

/** The panel's shape while the first read is out: the number, the bar, a row per part. */
export function SplitGhost({ label, lines }: { label: string; lines: number }) {
  return (
    <section aria-busy="true" aria-label={label} className="grid gap-3">
      <Skeleton className="h-[43px] w-44" />
      <Skeleton className="h-2.5" />
      <Loading
        shape="rows"
        lines={lines}
        label={`Loading ${label.toLowerCase()}`}
        className="py-0"
      />
    </section>
  );
}
