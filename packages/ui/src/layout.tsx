/**
 * How a page is laid out: a title with its lede, then framed sections. Every part reads apart from
 * the next: a hair frame, a banded head strip with a rule under it, and a heading scale with
 * plain steps (page title, section title, group label).
 */
import { createContext, type ReactNode, useContext } from "react";
import { cx } from "./format.js";

/** The heading scale. A page has one title; each section one section title; a group in it a label. */
export const PAGE_TITLE =
  "font-(family-name:--ui-font-display) text-[28px] leading-[34px] font-semibold tracking-[calc(-0.022em*var(--ui-display-squeeze))] text-balance max-[900px]:text-[22px] max-[900px]:leading-7";
export const SECTION_TITLE = "text-[16px] leading-[22px] font-semibold";
export const GROUP_LABEL =
  "text-[12px] leading-4 font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]";

/** A part on the page: a raised panel on paper, its rim in the shadow, its corners soft. */
export const FRAME = "rounded-(--ui-radius-panel) bg-(--ui-paper) shadow-(--ui-raise)";
/** The strip a framed part is headed by: banded, with a rule under it, its top corners the frame's. */
export const FRAME_HEAD =
  "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-t-[inherit] border-b border-(--ui-hair) bg-(--ui-band) px-4 py-2.5";
/**
 * A framed part's body. A ruled list or facts inside it drops the rule the frame already draws,
 * at its top and under its last row.
 */
export const FRAME_BODY =
  "p-4 [&>:is(ul,ol,dl):first-child]:border-t-0 [&>:is(ul,ol,dl):last-child>:last-child]:border-b-0";

const ACTIONS = "flex flex-wrap items-center gap-2.5";

const AboutContext = createContext<string | undefined>(undefined);
/** The open page's `about`: one line under its title saying what it's for. */
export const AboutProvider = AboutContext.Provider;
export const useAbout = () => useContext(AboutContext);

/** The line under a title: the page's own lede, else what the page is for. */
export const ABOUT = "mt-1 max-w-[62ch] text-[14px] text-pretty text-(--ui-ink-2)";

/** A page's title, with its line under it. */
export function PageTitle({ title, lede }: { title: ReactNode; lede?: ReactNode }) {
  const about = useAbout();
  const line = lede ?? about;
  return (
    <div className="min-w-0">
      <h1 className={PAGE_TITLE}>{title}</h1>
      {line ? <p className={ABOUT}>{line}</p> : null}
    </div>
  );
}

export function PageHeader({
  title,
  lede,
  actions,
  className,
}: {
  title: string;
  /** Its own line under the title; without one, the page's declared `about` shows. */
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
      <PageTitle title={title} lede={lede} />
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
  count,
  note,
  actions,
  plain = false,
  className,
  children,
}: {
  title?: string | undefined;
  /** A mark before the title: the platform or site this section is about. */
  cue?: ReactNode;
  /** How many it holds, quiet after the title. */
  count?: number | undefined;
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
              {count === undefined ? null : (
                <span className="font-normal text-(--ui-ink-3) tabular-nums">
                  {count.toLocaleString("en-US")}
                </span>
              )}
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
    <section className={cx("min-w-0 [:is(section,[data-empty])+&]:mt-7", FRAME, className)}>
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
      <legend className="float-left w-full rounded-t-[inherit] border-b border-(--ui-hair) bg-(--ui-band) px-4 py-2.5">
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
