/**
 * A list's page bar: ‹ Prev  1 2 3 … 12  Next ›. Soft, like the rest of the portal: ghost
 * cells with the control radius, the page you are on a quiet filled pill. The address
 * holds the page (`pg`), so a link reloads or shares it. One page draws nothing. A phone keeps
 * a window of one page and arrows alone, so it fits 393px without scrolling sideways.
 */
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { num } from "./format.js";
import { type Slot, slotsOf, spanOf } from "./pager.js";
import type { Place } from "./records.js";

const CELL =
  "inline-flex h-8 pointer-coarse:h-11 min-w-8 items-center justify-center rounded-(--ui-radius) px-2 text-[13px] tabular-nums no-underline select-none transition-colors";
const LINK =
  "text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-(--ui-focus)";

export function PageBar({
  place,
  page,
  pages,
  total,
  shown,
  size,
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
  narrow: boolean;
}) {
  if (pages <= 1) return null;
  const to = (n: number) => place.link({ pg: n <= 1 ? null : String(n) });
  const [from, upto] = spanOf(page, shown, size);
  const arrow = (dir: -1 | 1) => {
    const n = page + dir;
    const on = n >= 1 && n <= pages;
    const Icon = dir < 0 ? ChevronLeft : ChevronRight;
    const label = dir < 0 ? "Previous page" : "Next page";
    const inner = (
      <>
        {dir < 0 ? <Icon className="size-4" aria-hidden /> : null}
        {narrow ? null : dir < 0 ? "Prev" : "Next"}
        {dir > 0 ? <Icon className="size-4" aria-hidden /> : null}
      </>
    );
    const wide = narrow ? "" : "gap-0.5 px-2.5";
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
      <span
        key={s}
        aria-hidden
        className="inline-flex h-8 w-6 items-center justify-center text-(--ui-ink-3)"
      >
        …
      </span>
    ) : s === page ? (
      <span
        key={s}
        aria-current="page"
        className={cn(CELL, "bg-(--ui-fill) font-medium text-(--ui-ink)")}
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
        "flex items-center gap-3 text-[13px] text-(--ui-ink-2)",
        narrow ? "justify-center" : "justify-between",
      )}
    >
      {narrow ? null : (
        <span className="tabular-nums">
          {num(from)}–{num(upto)} of {num(total)}
        </span>
      )}
      <div className="flex items-center gap-1">
        {arrow(-1)}
        {slotsOf(page, pages, narrow ? 1 : 2).map(slot)}
        {arrow(1)}
      </div>
    </nav>
  );
}
