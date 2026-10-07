/**
 * The launcher: one card per app, each opening into that app's pages. More apps make more cards,
 * never a longer menu.
 */
import type { ReactNode } from "react";
import { Skeleton } from "./components/ui/skeleton.js";
import { num } from "./format.js";
import { Icon, type IconName } from "./icons.js";

/** A row of app cards, under a label when there's more than one row. */
export function AppGrid({ label, children }: { label?: string | undefined; children: ReactNode }) {
  return (
    <section className="[section+&]:mt-11" aria-label={label}>
      {label ? (
        <h2 className="mb-3.5 text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
          {label}
        </h2>
      ) : null}
      <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
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
        className="group/app flex h-full flex-col gap-2 rounded-(--ui-radius) bg-(--ui-paper) px-[22px] pt-5 pb-[22px] no-underline shadow-[inset_0_0_0_1px_var(--ui-hair)] transition-colors duration-350 ease-(--ui-ease) hover:bg-(--ui-wash)"
        href={href}
      >
        <span className="mb-2 flex items-center justify-between">
          <span
            className="grid size-10 flex-none place-items-center rounded-(--ui-radius) bg-(--ui-accent-wash) text-(--ui-accent)"
            aria-hidden="true"
          >
            <Icon name={icon} size={20} />
          </span>
          <Icon
            name="arrow"
            className="text-(--ui-ink-3) transition-[color,transform] duration-350 ease-(--ui-ease) group-hover/app:translate-x-[3px] group-hover/app:text-(--ui-accent)"
          />
        </span>
        <span className="font-(family-name:--ui-font-display) text-[20px]/[1.2] font-(--ui-display-weight) tracking-[-0.015em]">
          {name}
        </span>
        {note ? <span className="-mt-1.5 text-[12.5px] text-(--ui-ink-3)">{note}</span> : null}
        <span className="text-[14px]/[1.5] text-pretty text-(--ui-ink-2)">{blurb}</span>
        {children ? <span className="mt-auto pt-3.5">{children}</span> : null}
      </a>
    </li>
  );
}

export interface GlanceFigure {
  label: string;
  value: number | string;
}

const GLANCE = "flex flex-wrap gap-x-[26px] gap-y-2.5 border-t border-(--ui-hair) pt-3.5";

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
