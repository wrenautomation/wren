/**
 * How a page is laid out: a title with its lede, then framed sections. Every part reads apart from
 * the next: a hair frame, a banded head strip with a rule under it, and a heading scale with
 * plain steps (page title, section title, group label).
 */
import type { ReactNode } from "react";
import { cx } from "./format.js";

/** The heading scale. A page has one title; each section one section title; a group in it a label. */
export const PAGE_TITLE =
  "font-(family-name:--ui-font-display) text-[24px] leading-8 font-semibold tracking-[calc(-0.015em*var(--ui-display-squeeze))] text-balance max-[900px]:text-[22px] max-[900px]:leading-7";
export const SECTION_TITLE = "text-[16px] leading-[22px] font-semibold";
export const GROUP_LABEL =
  "text-[12px] leading-4 font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]";

/** A part on the page: hair frame on paper. */
export const FRAME = "border border-(--ui-hair) bg-(--ui-paper)";
/** The strip a framed part is headed by: banded, with a rule under it. */
export const FRAME_HEAD =
  "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-(--ui-hair) bg-(--ui-band) px-4 py-2.5";
/**
 * A framed part's body. A ruled list or facts inside it drops the rule the frame already draws,
 * at its top and under its last row.
 */
export const FRAME_BODY =
  "p-4 [&>:is(ul,ol,dl):first-child]:border-t-0 [&>:is(ul,ol,dl):last-child>:last-child]:border-b-0";

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
      className={cx(
        "mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-(--ui-hair) pb-5",
        className,
      )}
    >
      <div>
        <h1 className={PAGE_TITLE}>{title}</h1>
        {lede ? (
          <p className="mt-1 max-w-[62ch] text-[14px] text-pretty text-(--ui-ink-2)">{lede}</p>
        ) : null}
      </div>
      {actions ? <div className={ACTIONS}>{actions}</div> : null}
    </header>
  );
}

/**
 * A part of a page, framed with its title in a banded strip. `plain` leaves the frame off, for a
 * section around something that draws its own (a list of records, a grid of cards).
 */
export function Section({
  title,
  cue,
  note,
  actions,
  plain = false,
  className,
  children,
}: {
  title?: string | undefined;
  /** A mark before the title: the platform or site this section is about. */
  cue?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  plain?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const head =
    title || note || actions ? (
      <div
        className={
          plain ? "mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3" : FRAME_HEAD
        }
      >
        <div className="min-w-0">
          {title ? (
            <h2 className={cx("flex items-center gap-2", SECTION_TITLE)}>
              {cue}
              {title}
            </h2>
          ) : null}
          {note ? (
            <p className="mt-0.5 max-w-[68ch] text-[13.5px] text-pretty text-(--ui-ink-2)">
              {note}
            </p>
          ) : null}
        </div>
        {actions ? <div className={ACTIONS}>{actions}</div> : null}
      </div>
    ) : null;
  if (plain)
    return (
      <section className={cx("[section+&]:mt-10", className)}>
        {head}
        {children}
      </section>
    );
  return (
    <section className={cx("min-w-0 [section+&]:mt-6", FRAME, className)}>
      {head}
      <div className={FRAME_BODY}>{children}</div>
    </section>
  );
}

/** A group of fields in a form, framed, with its name as the legend in the head strip. */
export function Fieldset({
  legend,
  note,
  className,
  children,
}: {
  legend: string;
  note?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <fieldset className={cx("m-0 min-w-0 p-0", FRAME, className)}>
      {/* Floated full width, a legend leaves the border's notch and reads as the head strip. */}
      <legend className="float-left w-full border-b border-(--ui-hair) bg-(--ui-band) px-4 py-2.5">
        <span className={cx("block", GROUP_LABEL)}>{legend}</span>
        {note ? (
          <span className="mt-0.5 block max-w-[68ch] text-[13px] text-pretty text-(--ui-ink-2)">
            {note}
          </span>
        ) : null}
      </legend>
      <div className="clear-both grid gap-4 p-4">{children}</div>
    </fieldset>
  );
}
