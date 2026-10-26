/**
 * A whole and its parts (artifact section 15, `.ix-e`): the total first, one bar split by part,
 * then the parts as rows, each a link to its rows. The Inbox splits what waits by queue; Money
 * splits a month's spend by account. The rows carry the exact figures. The Inbox draws a share
 * bar; Money a ring (`shape="ring"`), its biggest parts each a slice and the rest one, a row and
 * its slice lit together. Flat on the page: no frame, the rows reach its edge.
 */
import { cn } from "cn";
import { type ReactNode, useState } from "react";
import { RingChart, type RingSlice } from "./charts/index.js";
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

/** Slices a ring gives their own colour; the rest share one, so it never needs a sixth hue. */
const RING_SLICES = 5;
const OTHER = "__other";
/** The rest's slice: a quiet neutral, apart from every series hue. */
const OTHER_COLOR = "color-mix(in srgb, var(--ui-ink-3) 45%, var(--ui-paper))";

/** A row's colour on a ring, by its place among the parts biggest first: a chart series, then the rest's. */
export const sliceColor = (i: number) =>
  i < RING_SLICES ? `var(--ui-chart-${i + 1})` : OTHER_COLOR;

const share = (part: number, whole: number) => {
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
};

/** The total, its line, the bar and the rows. */
export function SplitPanel({
  label,
  total,
  line,
  rows,
  shape = "bar",
}: {
  /** What the panel holds, for a screen reader: "What waits on you". */
  label: string;
  total: ReactNode;
  /** Beside the total: "wait on you · oldest 2 days". */
  line: ReactNode;
  rows: readonly SplitRow[];
  /** A bar across, or a ring beside the rows (rows biggest first, coloured by `sliceColor`). */
  shape?: "bar" | "ring";
}) {
  const bar = rows.filter((r) => r.weight > 0);
  if (shape === "ring") return <SplitRing label={label} total={total} line={line} rows={rows} />;
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

/**
 * The ring shape: the total over a ring and the rows, side by side when there is room. The hole
 * names the lit part's share, or the biggest part's when none is lit.
 */
function SplitRing({
  label,
  total,
  line,
  rows,
}: {
  label: string;
  total: ReactNode;
  line: ReactNode;
  rows: readonly SplitRow[];
}) {
  const [hot, setHot] = useState<string | null>(null);
  const parts = rows.filter((r) => r.weight > 0);
  const whole = parts.reduce((n, r) => n + r.weight, 0);
  const own = parts.slice(0, RING_SLICES);
  const rest = parts.slice(RING_SLICES);
  const slices: RingSlice[] = own.map((r) => ({ key: r.key, value: r.weight, color: r.color }));
  if (rest.length)
    slices.push({
      key: OTHER,
      value: rest.reduce((n, r) => n + r.weight, 0),
      color: OTHER_COLOR,
    });
  const sliceOf = (key: string) => (rest.some((r) => r.key === key) ? OTHER : key);
  const shown = hot ?? slices[0]?.key ?? null;
  const named =
    shown === OTHER
      ? { label: `${rest.length} more`, weight: slices.at(-1)?.value ?? 0 }
      : parts.find((r) => r.key === shown);
  return (
    <section aria-label={label} className="@container grid gap-4">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <b className="text-[48px] leading-[.9] font-semibold tracking-[-0.04em] tabular-nums">
          {total}
        </b>
        <span className="text-[15px] text-(--ui-ink-2)">{line}</span>
      </div>
      <div className="grid items-start gap-6 @[32rem]:grid-cols-[176px_minmax(0,1fr)]">
        <div className="relative justify-self-center" aria-hidden="true">
          {whole > 0 ? (
            <RingChart slices={slices} hot={hot} onHot={setHot} />
          ) : (
            <div className="size-[176px] rounded-full border-22 border-(--ui-fill)" />
          )}
          {named && whole > 0 ? (
            <div className="pointer-events-none absolute inset-[30px] grid place-content-center gap-0.5 text-center">
              <b className="text-[26px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
                {share(named.weight, whole)}
              </b>
              {/* The row beside it names the part whole; the hole has room for three lines. */}
              <span className="line-clamp-3 wrap-anywhere text-[12.5px] leading-[1.25] text-(--ui-ink-3)">
                {named.label}
              </span>
            </div>
          ) : null}
        </div>
        <ul className="-mx-3 m-0 grid list-none p-0 [&>li+li>a]:shadow-[0_-1px_0_var(--ui-hair)]">
          {rows.map((r) => (
            <li
              key={r.key}
              onMouseEnter={() => r.weight > 0 && setHot(sliceOf(r.key))}
              onMouseLeave={() => setHot(null)}
              onFocus={() => r.weight > 0 && setHot(sliceOf(r.key))}
              onBlur={() => setHot(null)}
            >
              <SplitLine r={r} lit={hot !== null && r.weight > 0 && sliceOf(r.key) === hot} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SplitLine({ r, lit = false }: { r: SplitRow; lit?: boolean }) {
  const quiet = r.weight === 0;
  return (
    <a
      href={r.href}
      className={cn(
        "grid items-center gap-3 px-3 py-2.5 text-[15px] no-underline transition-[background-color] duration-200 outline-none [border-radius:4px_12px_4px_12px] hover:bg-(--ui-accent-wash) focus-visible:bg-(--ui-accent-wash) motion-reduce:transition-none",
        lit && "bg-(--ui-accent-wash)",
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

/** The panel's shape while the first read is out: the number, the bar or ring, a row per part. */
export function SplitGhost({
  label,
  lines,
  shape = "bar",
}: {
  label: string;
  lines: number;
  shape?: "bar" | "ring";
}) {
  const rows = (
    <Loading shape="rows" lines={lines} label={`Loading ${label.toLowerCase()}`} className="py-0" />
  );
  return (
    <section
      aria-busy="true"
      aria-label={label}
      className={cn("grid", shape === "ring" ? "@container gap-4" : "gap-3")}
    >
      <Skeleton className="h-[43px] w-44" />
      {shape === "ring" ? (
        <div className="grid items-start gap-6 @[32rem]:grid-cols-[176px_minmax(0,1fr)]">
          <div className="size-[176px] justify-self-center rounded-full border-22 border-(--ui-fill)" />
          {rows}
        </div>
      ) : (
        <>
          <Skeleton className="h-2.5" />
          {rows}
        </>
      )}
    </section>
  );
}
