/**
 * Where the player shows over a slot, and how much of it a scrolling parent hides. The host is a
 * fixed element over the page, so a slot scrolled half under the app bar must clip the player
 * to what the page itself still shows.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How much of the box to cut from each side, in px. */
export interface Clip {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The cut that leaves the part of `box` inside every box in `within`, or null when none of it
 * is left.
 */
export function clipTo(box: Box, within: readonly Box[]): Clip | null {
  let { left, top, right, bottom } = box;
  for (const w of within) {
    left = Math.max(left, w.left);
    top = Math.max(top, w.top);
    right = Math.min(right, w.right);
    bottom = Math.min(bottom, w.bottom);
  }
  if (right <= left || bottom <= top) return null;
  return {
    left: left - box.left,
    top: top - box.top,
    right: box.right - right,
    bottom: box.bottom - bottom,
  };
}

/** `clip-path` for a cut: none when nothing is cut, everything when null. */
export function clipPath(clip: Clip | null): string {
  if (!clip) return "inset(100%)";
  const { top, right, bottom, left } = clip;
  if (!top && !right && !bottom && !left) return "none";
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

/** The ancestors of `el` that cut what sits in them (a scroller, `overflow: hidden`). */
export function clippersOf(el: Element): Element[] {
  const out: Element[] = [];
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(o.overflowX + o.overflowY)) out.push(p);
  }
  return out;
}
