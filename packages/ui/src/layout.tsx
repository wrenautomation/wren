/** How a page is laid out: a title with its lede, sections, a strip of figures, and cards. */
import type { ReactNode } from "react";
import { cx } from "./format.js";

export function PageHeader({
  title,
  lede,
  actions,
  className,
}: {
  title: string;
  /** One sentence on what this page is for. */
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <header className={cx("ui-page-head", className)}>
      <div>
        <h1>{title}</h1>
        {lede ? <p className="ui-lede">{lede}</p> : null}
      </div>
      {actions ? <div className="ui-page-actions">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  note,
  actions,
  className,
  children,
}: {
  title?: string | undefined;
  note?: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className={cx("ui-section", className)}>
      {title || note || actions ? (
        <div className="ui-section-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {note ? <p className="ui-note">{note}</p> : null}
          </div>
          {actions ? <div className="ui-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Figures in a row under one black rule, like the lander's sourced numbers. */
export function StatStrip({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return <dl className={cx("ui-stats", className)}>{children}</dl>;
}

/** A figure with its label. With `href`, the whole figure opens the rows behind it. */
export function Stat({
  label,
  value,
  note,
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  href?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cx("ui-stat", href && "ui-stat-link", className)}>
      <dt>{label}</dt>
      <dd className="ui-stat-value">{href ? <a href={href}>{value}</a> : value}</dd>
      {note ? <dd className="ui-stat-note">{note}</dd> : null}
    </div>
  );
}

/** A list of cards. `stale` dims it while the next page loads. */
export function CardList({
  stale = false,
  className,
  children,
}: {
  stale?: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  return <ul className={cx("ui-cards", stale && "ui-stale", className)}>{children}</ul>;
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return <li className={cx("ui-card", className)}>{children}</li>;
}
