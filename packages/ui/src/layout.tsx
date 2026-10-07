/** How a page is laid out: a title with its lede, and sections. */
import type { ReactNode } from "react";
import { cx } from "./format.js";

/** A page title, the same size as the record templates' (20px). */
const TITLE = "text-[20px] leading-7 font-semibold tracking-[-0.01em] text-balance";
const ACTIONS = "flex flex-wrap items-center gap-2.5";

export function PageHeader({
  title,
  lede,
  actions,
  className,
}: {
  title: string;
  /** One line, only when the page needs an instruction. */
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <header
      className={cx("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}
    >
      <div>
        <h1 className={TITLE}>{title}</h1>
        {lede ? (
          <p className="mt-1 max-w-[62ch] text-[14px] text-pretty text-(--ui-ink-2)">{lede}</p>
        ) : null}
      </div>
      {actions ? <div className={ACTIONS}>{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  cue,
  note,
  actions,
  className,
  children,
}: {
  title?: string | undefined;
  /** A mark before the title: the platform or site this section is about. */
  cue?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className={cx("[section+&]:mt-10", className)}>
      {title || note || actions ? (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            {title ? (
              <h2 className="flex items-center gap-2 text-[15px]/[1.3] font-semibold">
                {cue}
                {title}
              </h2>
            ) : null}
            {note ? (
              <p className="mt-1 max-w-[68ch] text-[14px] text-pretty text-(--ui-ink-2)">{note}</p>
            ) : null}
          </div>
          {actions ? <div className={ACTIONS}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
