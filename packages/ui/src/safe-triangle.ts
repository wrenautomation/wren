/**
 * The invisible triangle (a hover submenu's grace area): leaving a row toward its flyout, the
 * pointer may cross the rows below on its diagonal. While it stays inside the shape from where
 * it left to the flyout's far edge, the flyout stays open and those rows are ignored; outside it,
 * or after `GRACE_MS` without reaching the flyout, the row under the pointer wins.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface Point {
  x: number;
  y: number;
}

/** How long the pointer may take to cross into the flyout. */
export const GRACE_MS = 350;
/** A row opens its flyout after this long under the pointer, so a pass over it doesn't. */
export const OPEN_MS = 90;

/** Even-odd ray cast: is `p` inside the polygon? */
export function inPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/**
 * The grace area from where the pointer left (nudged back 2px, so the start counts) to the
 * flyout: the triangle to its near edge, and the flyout itself.
 */
export function graceArea(exit: Point, flyout: DOMRectReadOnly): Point[] {
  const x = exit.x + (flyout.left >= exit.x ? -2 : 2);
  return [
    { x, y: exit.y },
    { x: flyout.left, y: flyout.top },
    { x: flyout.right, y: flyout.top },
    { x: flyout.right, y: flyout.bottom },
    { x: flyout.left, y: flyout.bottom },
  ];
}

/**
 * One flyout open at a time, by row id, held through the triangle. Rows call `enter`/`leave`,
 * the flyout calls `enterFlyout`/`leaveFlyout` and hangs `flyoutRef`.
 */
export function useHoverMenu() {
  const [open, setOpen] = useState<{ id: string; top: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const grace = useRef<{ area: Point[]; timer: number } | null>(null);
  const opening = useRef<number>(0);

  const endGrace = useCallback(() => {
    if (grace.current) window.clearTimeout(grace.current.timer);
    grace.current = null;
  }, []);
  const close = useCallback(() => {
    endGrace();
    window.clearTimeout(opening.current);
    setOpen(null);
  }, [endGrace]);

  /** The row under the pointer once grace ends: its flyout, or none. */
  const settle = useCallback(
    (at: Point) => {
      endGrace();
      const row = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>("[data-hover-row]");
      const id = row?.dataset.hoverRow;
      if (id) setOpen({ id, top: row.getBoundingClientRect().top });
      else setOpen(null);
    },
    [endGrace],
  );

  useEffect(() => {
    if (!open) return;
    const move = (e: PointerEvent) => {
      const g = grace.current;
      if (g && !inPolygon({ x: e.clientX, y: e.clientY }, g.area))
        settle({ x: e.clientX, y: e.clientY });
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointermove", move);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, settle, close]);
  useEffect(() => close, [close]);

  return {
    open,
    flyoutRef,
    close,
    enter(id: string, row: HTMLElement) {
      // Crossing a row on the way to the flyout: the triangle holds.
      if (grace.current) return;
      window.clearTimeout(opening.current);
      const top = row.getBoundingClientRect().top;
      // A flyout already open switches at once; the first waits a beat.
      if (open) setOpen({ id, top });
      else opening.current = window.setTimeout(() => setOpen({ id, top }), OPEN_MS);
    },
    leave(id: string, e: { clientX: number; clientY: number }) {
      window.clearTimeout(opening.current);
      // A row crossed on the way to another's flyout leaves it be.
      if (open?.id !== id) return;
      const box = flyoutRef.current?.getBoundingClientRect();
      if (!box) return setOpen(null);
      const at = { x: e.clientX, y: e.clientY };
      endGrace();
      grace.current = {
        area: graceArea(at, box),
        timer: window.setTimeout(() => settle(at), GRACE_MS),
      };
    },
    enterFlyout: endGrace,
    leaveFlyout(e: { clientX: number; clientY: number }) {
      settle({ x: e.clientX, y: e.clientY });
    },
  };
}
