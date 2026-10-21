import { useLayoutEffect, useRef } from "react";

/** Where each row's bar last sat, by row: a row drawn again after a click slides from there. */
const last = new Map<string, { x: number; w: number }>();

const still = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The lit line under a row of tabs: it sits under the tab marked `aria-current="page"` and
 * slides to the next one when the choice moves. It sits inside the row, which is `relative`; its
 * tabs draw no line of their own. `row` names the row, so the slide survives the page drawing it
 * afresh. The row is read as the bar's parent: a ref on the row isn't set yet on first draw.
 */
export function TabBar({ on, row }: { on: string | undefined; row: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `on` moves the bar; the tab is read from the row
  useLayoutEffect(() => {
    const b = bar.current;
    const n = b?.parentElement;
    if (!b || !n) return;
    const place = (slide: boolean) => {
      const tab = n.querySelector<HTMLElement>('[aria-current="page"]');
      if (!tab) {
        b.style.opacity = "0";
        return;
      }
      const to = { x: tab.offsetLeft, w: tab.offsetWidth };
      const from = last.get(row);
      // A resize that moved nothing (the observer's first call is one) leaves a slide running.
      if (!slide && from && from.x === to.x && from.w === to.w && b.style.opacity === "1") return;
      b.style.transition = "none";
      if (slide && from && (from.x !== to.x || from.w !== to.w) && !still()) {
        b.style.transform = `translateX(${from.x}px)`;
        b.style.width = `${from.w}px`;
        b.getBoundingClientRect();
        b.style.transition = "";
      }
      b.style.opacity = "1";
      b.style.transform = `translateX(${to.x}px)`;
      b.style.width = `${to.w}px`;
      last.set(row, to);
    };
    place(true);
    const ro = new ResizeObserver(() => place(false));
    ro.observe(n);
    return () => ro.disconnect();
  }, [on, row]);
  return (
    <span
      ref={bar}
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-0 bg-(--ui-ink) opacity-0 transition-[transform,width] duration-300 ease-(--ui-ease)"
    />
  );
}
