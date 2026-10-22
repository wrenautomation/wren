/**
 * How a page is laid out: a title with its lede, then framed sections. Every part reads apart from
 * the next: a hair frame, a head on the paper with no rule, and a heading scale with
 * plain steps (page title, section title, group label).
 */
import { cn } from "cn";
import { createContext, type ReactNode, useContext } from "react";
import { cx } from "./format.js";

/** The heading scale. A page has one title; each section one section title; a group in it a label. */
export const PAGE_TITLE =
  "font-(family-name:--ui-font-display) text-[22px] leading-[1.55] font-semibold tracking-[calc(-0.02em*var(--ui-display-squeeze))] text-balance";
/** The artifact's `h3`: 16 px, 650, -0.01em. */
export const SECTION_TITLE = "text-[16px] leading-[1.55] font-semibold tracking-[-0.01em]";
/** A group's label: sentence case, 12.5 px, 650, ink-3. A look can set case and tracking back. */
export const GROUP_LABEL =
  "text-[12.5px] leading-4 font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-3) [text-transform:var(--ui-label-case)]";

/**
 * A flat part's head: its title and a link or tabs at the right, on the page itself, no panel
 * around it (10-21: the app stays flat, so a part is a heading and its content).
 */
export const FLAT_HEAD = "flex flex-wrap items-center justify-between gap-x-6 gap-y-2";

/** A part on the page: a raised panel on paper, its rim in the shadow, its corners a leaf. */
export const FRAME = "relative rounded-(--ui-leaf-panel) bg-(--ui-paper) shadow-(--ui-raise)";
/**
 * What a framed part is headed by (artifact `.panel`): on the paper, no band and no rule, 18 px
 * from the top and 20 from the side. `ui-head` is the mark the body reads to close the gap to 12.
 */
export const FRAME_HEAD =
  "ui-head flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pt-[18px]";
/**
 * A framed part's body. A ruled list or facts inside it drops the rule the frame already draws,
 * at its top and under its last row.
 */
export const FRAME_BODY =
  "p-5 [.ui-head+&]:pt-3 [&>:is(ul,ol,dl):first-child]:border-t-0 [&>:is(ul,ol,dl):last-child>:last-child]:border-b-0";

const ACTIONS = "flex flex-wrap items-center gap-2.5";

/** A label in the sidebar or a sheet ("Pinned"): the artifact's `.nl`, 12 px, 600, ink-3, no rule. */
export const NAV_LABEL =
  "px-2 pt-3 pb-1 text-[12px] leading-[1.55] font-semibold text-(--ui-ink-3)";
/**
 * A row in the sidebar (the artifact's `.nav`): 6 px by 8, 14 px ink-2, a leaf of 3 and 12; the
 * row on screen is tinted and bolder, and `ui-nav-sweep` draws its arc. Hover is the wash a task
 * row takes. Snug density takes 3 px off each side.
 */
export const NAV_ROW =
  "ui-nav-sweep flex w-full min-w-0 items-center gap-[9px] rounded-(--ui-leaf-nav) px-2 py-1.5 in-data-[density=snug]:py-[3px] text-[14px] leading-[1.55] text-(--ui-ink-2) no-underline transition-colors duration-150 ease-(--ui-ease) hover:bg-(--ui-accent-wash) hover:text-(--ui-ink) [&>svg]:[stroke-width:1.8]";
/** The sidebar row on screen (`.nav[aria-current]`). */
export const NAV_ON =
  "aria-[current=page]:bg-(--ui-accent-tint) aria-[current=page]:font-semibold aria-[current=page]:text-(--ui-ink) aria-[current=true]:bg-(--ui-accent-tint) aria-[current=true]:font-semibold aria-[current=true]:text-(--ui-ink)";

const AboutContext = createContext<string | undefined>(undefined);
/** The open page's `about`: one line under its title saying what it's for. */
export const AboutProvider = AboutContext.Provider;
export const useAbout = () => useContext(AboutContext);

/** The line under a title: the page's own lede, else what the page is for. */
export const ABOUT = "max-w-[70ch] text-[13.5px] leading-[1.55] text-pretty text-(--ui-ink-2)";

/** A page's title, with its line under it. A refresh leaves the old data and marks nothing. */
/** A page's kicker over its title (Studio board: "Studio · week of Oct 20"): 13 px, 500, ink-3. */
const KICKER = "m-0 text-[13px] leading-[18px] font-medium text-(--ui-ink-3)";
/** A hub's big title (Studio board `h1`): 28 px, 700, -0.02em; 24 px on a phone. */
const HERO_TITLE =
  "m-0 text-[28px] leading-[34px] font-semibold tracking-[-0.02em] text-balance max-sm:text-[24px] max-sm:leading-[30px]";

export function PageTitle({
  title,
  lede,
  kicker,
  hero = false,
}: {
  title: ReactNode;
  lede?: ReactNode;
  kicker?: ReactNode;
  hero?: boolean | undefined;
}) {
  const about = useAbout();
  const line = lede ?? about;
  return (
    <div className={cx("min-w-0", kicker ? "grid gap-1" : undefined)}>
      {kicker ? <p className={KICKER}>{kicker}</p> : null}
      <h1 className={hero ? HERO_TITLE : PAGE_TITLE}>{title}</h1>
      {line ? <p className={ABOUT}>{line}</p> : null}
    </div>
  );
}

export function PageHeader({
  title,
  lede,
  kicker,
  hero,
  actions,
  className,
}: {
  title: ReactNode;
  /** Its own line under the title; without one, the page's declared `about` shows; `false`, none. */
  lede?: ReactNode;
  /** A small line over the title: where you are and when ("Studio · week of Oct 20"). */
  kicker?: ReactNode;
  /** The hub's big title (Studio): 28 px, 700. */
  hero?: boolean | undefined;
  actions?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <header
      className={cn("mb-3.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2.5", className)}
    >
      <PageTitle title={title} lede={lede} kicker={kicker} hero={hero} />
      {actions ? <div className={ACTIONS}>{actions}</div> : null}
    </header>
  );
}

/**
 * A part of a page: its title, then its content, flat on the page (10-22: no panel around a part).
 * The next part keeps 32 px off it.
 */
export function Section({
  title,
  cue,
  count,
  note,
  actions,
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
  className?: string | undefined;
  children: ReactNode;
}) {
  const head =
    title || note || actions ? (
      <div className={cx("ui-head", FLAT_HEAD)}>
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
            <p className="max-w-[70ch] text-[13.5px] leading-[1.55] text-pretty text-(--ui-ink-2)">
              {note}
            </p>
          ) : null}
        </div>
        {actions ? <div className={ACTIONS}>{actions}</div> : null}
      </div>
    ) : null;
  return (
    <section className={cx("min-w-0 [:is(section,[data-empty])+&]:mt-8", className)}>
      {head}
      <div className="[.ui-head+&]:pt-3 [&>:is(ul,ol,dl):first-child]:border-t-0">{children}</div>
    </section>
  );
}

/** A group of fields in a form, flat, with its name as the legend in the head. */
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
    <fieldset className={cx("m-0 min-w-0 border-0 p-0", className)}>
      {/* Floated full width, a legend sits in the flow and reads as the head. */}
      <legend className="float-left w-full p-0">
        <span className={cx("block", GROUP_LABEL)}>{legend}</span>
        {note ? (
          <span className="mt-0.5 block max-w-[68ch] text-[13px] text-pretty text-(--ui-ink-2)">
            {note}
          </span>
        ) : null}
      </legend>
      <div className="clear-both grid gap-4 pt-3">{children}</div>
    </fieldset>
  );
}
