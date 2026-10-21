/**
 * The launcher: one card per app, each opening into that app's pages. More apps make more cards,
 * never a longer menu. A card is the artifact's `.links a`: paper on the raise, a leaf of 4 and 14,
 * its name in 650, one line in ink-2; it lifts 2 px with an accent ring under the pointer.
 */
import type { ReactNode } from "react";
import { Skeleton } from "./components/ui/skeleton.js";
import { num } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { GROUP_LABEL } from "./layout.js";

/** A row of app cards, under a label when there's more than one row. */
export function AppGrid({ label, children }: { label?: string | undefined; children: ReactNode }) {
  return (
    <section className="[section+&]:mt-11" aria-label={label}>
      {label ? <h2 className={`mb-3.5 ${GROUP_LABEL}`}>{label}</h2> : null}
      <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-2.5">
        {children}
      </ul>
    </section>
  );
}

/** One app: the whole card is the link, so what's inside must not be one. */
export function AppCard({
  name,
  icon,
  href,
  blurb,
  note,
  children,
}: {
  name: string;
  icon: IconName;
  href: string;
  /** One sentence on what it does for the client. */
  blurb: string;
  /** One quiet line under the name, such as "In place of Calendly". */
  note?: string | null | undefined;
  /** Where it stands now: an `AppGlance`. */
  children?: ReactNode;
}) {
  return (
    <li>
      <a
        className="flex h-full flex-col gap-0.5 rounded-[4px_14px_4px_14px] bg-(--ui-paper) px-4 py-3 text-[15px] leading-[1.55] text-(--ui-ink) no-underline shadow-(--ui-raise) transition-[transform,box-shadow] duration-200 ease-(--ui-ease) hover:-translate-y-0.5 hover:shadow-[var(--ui-raise),0_0_0_2px_var(--ui-focus)] focus-visible:-translate-y-0.5 focus-visible:shadow-[var(--ui-raise),0_0_0_2px_var(--ui-focus)] focus-visible:outline-none"
        href={href}
      >
        <span className="flex min-w-0 items-center gap-[9px]">
          <Icon name={icon} size={16} className="flex-none text-(--ui-ink-2)" />
          <b className="min-w-0 font-[650]">{name}</b>
        </span>
        {note ? <span className="text-[12.5px] text-(--ui-ink-3)">{note}</span> : null}
        <span className="text-[13px] text-pretty text-(--ui-ink-2)">{blurb}</span>
        {children ? <span className="mt-auto pt-2.5">{children}</span> : null}
      </a>
    </li>
  );
}

export interface GlanceFigure {
  label: string;
  value: number | string;
}

const GLANCE = "flex flex-wrap gap-x-[26px] gap-y-2.5 border-t border-(--ui-hair) pt-2.5";

/** An app's few numbers on its card, and what's waiting on the viewer. Null while they load. */
export function AppGlance({ figures, note }: { figures: GlanceFigure[] | null; note?: ReactNode }) {
  if (!figures)
    return (
      <span className={GLANCE} aria-busy="true">
        <Skeleton className="h-[34px] w-16" />
        <Skeleton className="h-[34px] w-16" />
      </span>
    );
  return (
    <>
      <dl className={GLANCE}>
        {figures.map((f) => (
          <div key={f.label} className="flex flex-col-reverse gap-px">
            <dt className="text-[12.5px] text-(--ui-ink-2)">{f.label}</dt>
            <dd className="text-[19px] font-semibold tracking-[-0.01em] tabular-nums">
              {typeof f.value === "number" ? num(f.value) : f.value}
            </dd>
          </div>
        ))}
      </dl>
      {note ? <div className="mt-3">{note}</div> : null}
    </>
  );
}
