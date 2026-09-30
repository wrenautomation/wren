/**
 * Where a claim came from: numbered chips in the text, a card per source with how sure the
 * reading is, and a trail from a line back to the pages behind it. Callers map their own
 * records onto these props; nothing here knows what a source is about.
 */
import type { MouseEvent, ReactNode } from "react";
import { cx } from "./format.js";
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
      className={cx("ui-cite", on && "ui-cite-on", className)}
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
    <span className={cx("ui-sure", className)} data-level={filled}>
      <span className="ui-sure-bars" aria-hidden="true">
        {levels.map((l, i) => (
          <i
            key={l.label}
            className={i < filled ? "ui-sure-on" : undefined}
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
  return <ol className={cx("ui-sources", className)}>{children}</ol>;
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
    <li id={id} className={cx("ui-source", lit && "ui-source-lit", className)}>
      {n !== undefined ? <span className="ui-source-n">{n}</span> : null}
      <div className="ui-source-body">
        <div className="ui-source-head">
          <p>
            <b>{kind}</b>
            {meta ? <span className="ui-source-meta"> · {meta}</span> : null}
          </p>
          {sure !== null && sure !== undefined ? <Sure value={sure} /> : null}
        </div>
        {title ? <p className="ui-source-title">{title}</p> : null}
        {detail.length ? (
          <dl className="ui-source-detail">
            {detail.map(([label, value], i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: labels repeat ("Role"); rows never reorder.
              <div key={i}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {link ? (
          link.href ? (
            <a
              className="ui-source-link"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
              <Icon name="external" />
            </a>
          ) : (
            <span className="ui-source-link">{link.label}</span>
          )
        ) : null}
      </div>
    </li>
  );
}

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
    <ol className={cx("ui-trail", className)}>
      {steps.map((s) => (
        <li key={s.id} className="ui-trail-step">
          <p className="ui-trail-label">{s.label}</p>
          <div className="ui-trail-body">{s.children}</div>
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
    <p className={cx("ui-traced", on && "ui-traced-on", className)}>
      {children}{" "}
      <button type="button" className="ui-traced-why" aria-label={title} onClick={onTrace}>
        {label}
      </button>
    </p>
  );
}
