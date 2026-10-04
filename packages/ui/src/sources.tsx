/**
 * Where a claim came from: numbered chips in the text, a card per source with how sure the
 * reading is, and a trail from a line back to the pages behind it. Callers map their own
 * records onto these props; nothing here knows what a source is about.
 */
import { cn } from "cn";
import { type MouseEvent, type ReactNode, useCallback, useState } from "react";
import { Icon } from "./icons.js";

/** A numbered chip in running text, pointing at a source card. */
export function Cite({
  n,
  label,
  href,
  on = false,
  onPick,
  className,
}: {
  n: number;
  /** What the chip points at, for screen readers ("Source 2: Job change"). */
  label?: string | undefined;
  href?: string | undefined;
  /** The source it points at is the one picked. */
  on?: boolean | undefined;
  onPick?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const pick = (e: MouseEvent) => {
    if (!onPick) return;
    e.preventDefault();
    onPick();
  };
  return (
    <a
      className={cn(
        "ml-[3px] inline-grid h-[18px] min-w-[18px] place-items-center rounded-[min(5px,var(--ui-radius-control))] bg-(--ui-accent-tint) px-[5px] align-[0.14em] text-[11px] leading-none font-semibold text-(--ui-accent) lining-nums tabular-nums no-underline transition-colors duration-200 ease-(--ui-ease) hover:bg-(--ui-accent) hover:text-(--ui-on-accent) data-on:bg-(--ui-accent) data-on:text-(--ui-on-accent)",
        className,
      )}
      data-on={on || undefined}
      href={href ?? `#source-${n}`}
      aria-label={label ?? `Source ${n}`}
      onClick={pick}
    >
      {n}
    </a>
  );
}

export interface SureLevel {
  /** The lowest reading that earns this level, 0 to 1. */
  min: number;
  label: string;
}

/** Four bars, like signal strength: how sure a reading is, in words. */
export const SURE_LEVELS: SureLevel[] = [
  { min: 0.9, label: "Sure" },
  { min: 0.7, label: "Fairly sure" },
  { min: 0.5, label: "Maybe" },
  { min: 0, label: "Unsure" },
];

export function Sure({
  value,
  levels = SURE_LEVELS,
  className,
}: {
  /** 0 to 1. */
  value: number;
  /** Highest first; the bars filled are how many levels from the bottom this reaches. */
  levels?: SureLevel[] | undefined;
  className?: string | undefined;
}) {
  // Below every level (or not a number): no bars, the lowest level's words.
  const found = Number.isFinite(value) ? levels.findIndex((l) => value >= l.min) : -1;
  const at = found < 0 ? levels.length - 1 : found;
  const filled = found < 0 ? 0 : levels.length - at;
  const label = levels[at]?.label ?? "";
  return (
    // The words carry it for screen readers; the bars are for the eye.
    <span
      className={cn(
        "inline-flex flex-none items-center gap-[7px] text-[12.5px] whitespace-nowrap text-(--ui-ink-2)",
        className,
      )}
      data-level={filled}
    >
      <span className="inline-flex h-3 items-end gap-0.5" aria-hidden="true">
        {levels.map((l, i) => (
          <i
            key={l.label}
            className="w-[3px] rounded-[1px] bg-(--ui-fill) data-on:bg-(--ui-ink)"
            data-on={i < filled || undefined}
            // Short to tall, like signal strength.
            style={{ height: `${4 + (8 * i) / Math.max(1, levels.length - 1)}px` }}
          />
        ))}
      </span>
      {label}
    </span>
  );
}

/** Numbered source cards, in the order the chips count. */
export function SourceList({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return <ol className={cn("flex list-none flex-col gap-2", className)}>{children}</ol>;
}

export function SourceCard({
  id,
  n,
  kind,
  meta,
  title,
  sure,
  detail = [],
  link,
  lit = false,
  className,
}: {
  /** The anchor its chips jump to. */
  id?: string | undefined;
  n?: number | undefined;
  /** What was found ("Job change"). */
  kind: ReactNode;
  /** Where and when ("Web search · Sep 2026"). */
  meta?: ReactNode;
  title?: ReactNode;
  /** 0 to 1; null or left out when it's a record, not a reading. */
  sure?: number | null | undefined;
  detail?: [label: string, value: ReactNode][] | undefined;
  /** The page it came from. A null href shows the page without a link. */
  link?: { href: string | null; label: string } | null | undefined;
  /** The one its chip just picked. */
  lit?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <li
      id={id}
      className={cn(
        "grid scroll-m-6 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-(--ui-radius-card) bg-(--ui-paper) pt-[13px] pr-4 pb-3.5 pl-3.5 text-[14px] wrap-anywhere shadow-(--ui-shadow-node) transition-shadow duration-350 ease-(--ui-ease)",
        lit && "ring-2 ring-(--ui-accent)",
        className,
      )}
    >
      {n !== undefined ? (
        <span
          className={cn(
            "grid size-[22px] place-items-center rounded-[min(6px,var(--ui-radius-control))] text-[12px] font-semibold lining-nums tabular-nums transition-colors duration-350 ease-(--ui-ease)",
            lit ? "bg-(--ui-accent) text-(--ui-on-accent)" : "bg-(--ui-tile) text-(--ui-ink-2)",
          )}
        >
          {n}
        </span>
      ) : null}
      <div>
        {/* ui-source-head: a marker the demo video's walk zooms to (reactivation/src/video/walk.ts). */}
        <div className="ui-source-head flex min-h-[22px] flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-0.5">
          <p>
            <b>{kind}</b>
            {meta ? <span className="text-(--ui-ink-2)"> · {meta}</span> : null}
          </p>
          {sure !== null && sure !== undefined ? <Sure value={sure} /> : null}
        </div>
        {title ? <p className="mt-0.5">{title}</p> : null}
        {detail.length ? (
          <dl className="mt-2 grid gap-[3px] border-t border-(--ui-hair) pt-2 text-[13.5px]">
            {detail.map(([label, value], i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: labels repeat ("Role"); rows never reorder.
              <div key={i} className="grid grid-cols-[minmax(84px,26%)_1fr] gap-3">
                <dt className="text-(--ui-ink-2)">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {link ? (
          link.href ? (
            <a
              className={cn(LINK, "text-(--ui-ink)")}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
              <Icon name="external" size={12} className="text-(--ui-ink-2)" />
            </a>
          ) : (
            <span className={cn(LINK, "text-(--ui-ink-2)")}>{link.label}</span>
          )
        ) : null}
      </div>
    </li>
  );
}

const LINK = "mt-2 inline-flex max-w-full items-center gap-[5px] text-[13px] wrap-anywhere";

export interface TrailStep {
  id: string;
  /** The small label over the step ("In the email"). */
  label: ReactNode;
  children: ReactNode;
}

/** A chain read top to bottom: a claim, then what it rests on, then what that rests on. */
export function Trail({
  steps,
  className,
}: {
  steps: TrailStep[];
  className?: string | undefined;
}) {
  return (
    // ui-trail and ui-trail-step: markers the demo video's walk finds (reactivation/src/video/walk.ts).
    <ol className={cn("ui-trail list-none", className)}>
      {steps.map((s) => (
        <li
          key={s.id}
          className={
            "ui-trail-step relative pb-[26px] pl-[26px] last:pb-0 " +
            // A dot per step, joined by a hairline down to the next.
            "before:absolute before:top-1 before:left-0 before:size-[9px] before:rounded-full before:border-2 before:border-(--ui-accent) before:bg-(--ui-paper) before:content-[''] " +
            "after:absolute after:top-[19px] after:bottom-0.5 after:left-[5.5px] after:w-0.5 after:rounded-[1px] after:bg-(--ui-accent-tint) after:content-[''] last:after:content-none"
          }
        >
          <p className="mb-2.5 text-[11.5px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
            {s.label}
          </p>
          <div>{s.children}</div>
        </li>
      ))}
    </ol>
  );
}

/** A paragraph that can show where it came from: a quiet chip at its end opens the trail. */
export function Traced({
  onTrace,
  label = "Why",
  title = "Why this line",
  on = false,
  className,
  children,
}: {
  onTrace: () => void;
  label?: string | undefined;
  /** What the chip does, for screen readers. */
  title?: string | undefined;
  /** Its trail is the one open. */
  on?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "-mx-2 rounded-[min(6px,var(--ui-radius-control))] px-2 py-0.5 transition-colors duration-250 ease-(--ui-ease) hover:bg-(--ui-accent-wash)",
        on && "bg-(--ui-accent-wash)",
        className,
      )}
    >
      {children}{" "}
      <button
        type="button"
        className={cn(
          "inline-grid h-[19px] cursor-pointer place-items-center rounded-(--ui-radius-tag) border-0 px-[7px] align-[0.1em] [font-family:inherit] text-[11px] font-semibold tracking-[0.02em] whitespace-nowrap transition-colors duration-200 ease-(--ui-ease) hover:bg-(--ui-accent) hover:text-(--ui-on-accent)",
          // A finger-sized target, same look.
          "pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1.5 pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:content-['']",
          on
            ? "bg-(--ui-accent) text-(--ui-on-accent)"
            : "bg-(--ui-accent-tint) text-(--ui-accent)",
        )}
        aria-label={title}
        onClick={onTrace}
      >
        {label}
      </button>
    </p>
  );
}

/** A text cites its sources with marks like [f12] or [f3, c7]. */
export const MARKS = /\[\s*([fc]\d+(?:\s*[,;]\s*[fc]\d+)*)\s*\]/gi;
/** The marks a line cites, lowercase, in order. */
export const marksOf = (text: string): string[] =>
  [...text.matchAll(MARKS)].flatMap((m) =>
    (m[1] ?? "").split(/\s*[,;]\s*/).map((id) => id.toLowerCase()),
  );
/** The words alone, for places too small for their sources. */
export const stripMarks = (s: string) => s.replace(MARKS, "").replace(/\s+([.,;:!?])/g, "$1");

/** Picks a source by its mark and scrolls its card into view. */
export type PickSource = (mark: string) => void;

/** A cited text with its marks as numbered chips pointing at the source cards (`src-<mark>`). */
export function Cited({
  text,
  order,
  lit,
  onPick,
}: {
  text: string;
  /** Marks in card order, lowercase: a chip's number is its place here. */
  order: string[];
  lit?: string | null | undefined;
  onPick: PickSource;
}) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKS)) {
    out.push(text.slice(last, m.index).replace(/\s+$/, ""));
    const ids = [...new Set(marksOf(m[0]))];
    out.push(
      <span key={m.index} className="whitespace-nowrap">
        {ids.map((id) => {
          const n = order.indexOf(id) + 1;
          return n ? (
            <Cite
              key={id}
              n={n}
              href={`#src-${id}`}
              label={`Source ${n}`}
              on={lit === id}
              onPick={() => onPick(id)}
            />
          ) : null;
        })}
      </span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** Lights a source card and brings it into view, leaving the page's address alone. */
export function useSourcePick(): [string | null, PickSource] {
  const [lit, setLit] = useState<string | null>(null);
  const pick = useCallback((mark: string) => {
    setLit(mark);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(`src-${mark}`)
      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, []);
  return [lit, pick];
}
