/**
 * The launcher: one card per app, each opening into that app's pages. More apps make more cards,
 * never a longer menu.
 */
import type { ReactNode } from "react";
import { num } from "./format.js";
import { Icon, type IconName } from "./icons.js";

/** A row of app cards, under a label when there's more than one row. */
export function AppGrid({ label, children }: { label?: string | undefined; children: ReactNode }) {
  return (
    <section className="ui-apps" aria-label={label}>
      {label ? <h2 className="ui-apps-label">{label}</h2> : null}
      <ul className="ui-apps-grid">{children}</ul>
    </section>
  );
}

/** One app: the whole card is the link, so what's inside must not be one. */
export function AppCard({
  name,
  icon,
  href,
  blurb,
  children,
}: {
  name: string;
  icon: IconName;
  href: string;
  /** One sentence on what it does for the client. */
  blurb: string;
  /** Where it stands now: an `AppGlance`. */
  children?: ReactNode;
}) {
  return (
    <li>
      <a className="ui-appcard" href={href}>
        <span className="ui-appcard-top">
          <span className="ui-appmark" aria-hidden="true">
            <Icon name={icon} size={20} />
          </span>
          <Icon name="arrow" className="ui-appcard-go" />
        </span>
        <span className="ui-appcard-name">{name}</span>
        <span className="ui-appcard-blurb">{blurb}</span>
        {children ? <span className="ui-appcard-glance">{children}</span> : null}
      </a>
    </li>
  );
}

export interface GlanceFigure {
  label: string;
  value: number | string;
}

/** An app's few numbers on its card, and what's waiting on the viewer. Null while they load. */
export function AppGlance({ figures, note }: { figures: GlanceFigure[] | null; note?: ReactNode }) {
  if (!figures)
    return (
      <span className="ui-glance" aria-busy="true">
        <span className="ui-ghost" />
        <span className="ui-ghost" />
      </span>
    );
  return (
    <>
      <dl className="ui-glance">
        {figures.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{typeof f.value === "number" ? num(f.value) : f.value}</dd>
          </div>
        ))}
      </dl>
      {note ? <div className="ui-glance-note">{note}</div> : null}
    </>
  );
}
