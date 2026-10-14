/**
 * A list's numbered pages, as Google draws them: first, last, a few around the one you are on,
 * and a gap where the rest hide. The address holds the page (`pg`, from 1); the server skips
 * `offset` rows. No React.
 */

/** Rows a list page asks for; the server's own default. */
export const PAGE_SIZE = 50;

/** A page number, or a gap on the low (`before`) or high (`after`) side of the window. */
export type Slot = number | "before" | "after";

/** How many pages `total` rows fill; an empty list still has its one page. */
export const pagesOf = (total: number, size = PAGE_SIZE): number =>
  Math.max(1, Math.ceil(total / size));

/** The page an address names: a whole number from 1, else 1. */
export function pageAt(raw: string | null): number {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 1 ? n : 1;
}

/** Rows to skip to start page `page`. */
export const offsetOf = (page: number, size = PAGE_SIZE): number => (page - 1) * size;

/** The rows a page holds, 1-based and inclusive: 51 to 100 of 612. */
export function spanOf(page: number, shown: number, size = PAGE_SIZE): [number, number] {
  return shown ? [offsetOf(page, size) + 1, offsetOf(page, size) + shown] : [0, 0];
}

const run = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * The slots to draw: always page 1 and the last, `around` pages either side of the current, and
 * a gap only where it hides two pages or more (one hidden page is shown instead). The count
 * stays the same from page to page, so the bar doesn't shift under a thumb:
 * `2 * around + 5` slots once there are more pages than that.
 */
export function slotsOf(current: number, pages: number, around = 2): Slot[] {
  const last = Math.max(1, Math.floor(pages));
  const at = Math.min(Math.max(Math.floor(current), 1), last);
  const edge = 2 * around + 3;
  if (last <= edge + 2) return run(1, last);
  if (at <= around + 3) return [...run(1, edge), "after", last];
  if (at >= last - around - 2) return [1, "before", ...run(last - edge + 1, last)];
  return [1, "before", ...run(at - around, at + around), "after", last];
}
