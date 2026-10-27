/**
 * A list's page bar: ‹ Prev  1 2 3 … 12  Next › (the artifact's `.pager`): small ink-2 numbers
 * with a leaf of 3 and 8, the page you are on in the accent's tint. The address
 * holds the page (`pg`), so a link reloads or shares it. One page draws nothing. A phone keeps
 * a window of one page and arrows alone, so it fits 393px without scrolling sideways.
 */
import { cn } from "cn";
import { num } from "./format.js";
import { Icon } from "./icons.js";
import { pgOf, type Slot, slotsOf, spanOf } from "./pager.js";
import type { Place } from "./records.js";

/** The artifact's `.pg b`; a finger gets a 44 px cell. */
const CELL =
  "inline-flex pointer-coarse:h-11 pointer-coarse:min-w-11 items-center justify-center rounded-[3px_8px_3px_8px] px-[7px] py-[3px] text-[12.5px] font-semibold tabular-nums no-underline select-none transition-colors duration-150 ease-(--ui-ease)";
const LINK =
  "text-(--ui-ink-2) hover:bg-(--ui-accent-wash) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-(--ui-focus)";

export function PageBar({
  place,
  page,
  pages,
  total,
  shown,
  size,
  next = null,
  narrow,
}: {
  place: Place;
  /** The page on show, from 1. */
  page: number;
  pages: number;
  total: number;
  /** Rows on this page. */
  shown: number;
  size: number;
  /** This page's last-row cursor: the next page starts after it. */
  next?: string | null;
  narrow: boolean;
}) {
  if (pages <= 1) return null;
  const to = (n: number) => place.link({ pg: pgOf(n, page, next) });
  const [from, upto] = spanOf(page, shown, size);
  const arrow = (dir: -1 | 1) => {
    const n = page + dir;
    const on = n >= 1 && n <= pages;
    const label = dir < 0 ? "Previous page" : "Next page";
    const inner = (
      <>
        {dir < 0 ? <Icon name="left" className="size-3.5" /> : null}
        {narrow ? null : dir < 0 ? "Prev" : "Next"}
        {dir > 0 ? <Icon name="right" className="size-3.5" /> : null}
      </>
    );
    const wide = narrow ? "" : "gap-0.5";
    return on ? (
      <a
        href={to(n)}
        rel={dir < 0 ? "prev" : "next"}
        aria-label={label}
        className={cn(CELL, LINK, wide)}
      >
        {inner}
      </a>
    ) : (
      <span aria-hidden className={cn(CELL, "text-(--ui-ink-3)", wide)}>
        {inner}
      </span>
    );
  };
  const slot = (s: Slot) =>
    typeof s === "string" ? (
      <span key={s} aria-hidden className={cn(CELL, "text-(--ui-ink-2)")}>
        …
      </span>
    ) : s === page ? (
      <span
        key={s}
        aria-current="page"
        className={cn(CELL, "bg-(--ui-accent-tint) text-(--ui-active)")}
      >
        {num(s)}
      </span>
    ) : (
      <a key={s} href={to(s)} aria-label={`Page ${s}`} className={cn(CELL, LINK)}>
        {num(s)}
      </a>
    );
  return (
    <nav
      aria-label="Pages"
      className={cn(
        "flex items-center gap-3 pt-1.5 text-[12.5px] text-(--ui-ink-3)",
        // A side control: the count and the pages sit together, not at the page's two ends.
        narrow ? "justify-center" : "w-fit gap-5",
      )}
    >
      {narrow ? null : (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {num(from)}–{num(upto)} of {num(total)}
        </span>
      )}
      <div className="flex items-center gap-0.5">
        {arrow(-1)}
        {slotsOf(page, pages, narrow ? 1 : 2).map(slot)}
        {arrow(1)}
      </div>
    </nav>
  );
}
