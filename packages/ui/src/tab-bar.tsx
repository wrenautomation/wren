import { useLayoutEffect, useRef } from "react";

/** Where each row's pill last sat, by row: a row drawn again after a click slides from there. */
const last = new Map<string, { x: number; y: number; w: number; h: number }>();

const still = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The lit pill behind a row of tabs (the artifact's `.tl button.on`: the accent's tint, a leaf of
 * 4 and 10): it sits behind the tab marked `aria-current="page"` and slides to the next one when the
 * choice moves. It sits inside the row, which is `relative`; the row turns `isolate`, so the pill
 * paints over the row's ground and under its tabs. The tabs draw no fill of their own.
 * Motion's `layoutId` can take the slide over once the kit has Motion. `row` names the row, so the slide survives the page drawing it
 * afresh. The row is read as the bar's parent: a ref on the row isn't set yet on first draw.
 */
export function TabBar({ on, row }: { on: string | undefined; row: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `on` moves the bar; the tab is read from the row
  useLayoutEffect(() => {
    const b = bar.current;
    const n = b?.parentElement;
    if (!b || !n) return;
    n.style.isolation = "isolate";
    const place = (slide: boolean) => {
      // A tab that holds its link and a menu marks itself `data-tab`: the pill covers all of it.
      const cur = n.querySelector<HTMLElement>('[aria-current="page"]');
      const tab = cur?.closest<HTMLElement>("[data-tab]") ?? cur;
      if (!tab) {
        b.style.opacity = "0";
        return;
      }
      const to = { x: tab.offsetLeft, y: tab.offsetTop, w: tab.offsetWidth, h: tab.offsetHeight };
      const from = last.get(row);
      // A resize that moved nothing (the observer's first call is one) leaves a slide running.
      const same = (a: typeof to) => a.x === to.x && a.y === to.y && a.w === to.w && a.h === to.h;
      if (!slide && from && same(from) && b.style.opacity === "1") return;
      b.style.transition = "none";
      if (slide && from && !same(from) && !still()) {
        b.style.transform = `translate(${from.x}px, ${from.y}px)`;
        b.style.width = `${from.w}px`;
        b.style.height = `${from.h}px`;
        b.getBoundingClientRect();
        b.style.transition = "";
      }
      b.style.opacity = "1";
      b.style.transform = `translate(${to.x}px, ${to.y}px)`;
      b.style.width = `${to.w}px`;
      b.style.height = `${to.h}px`;
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
      className="pointer-events-none absolute top-0 left-0 -z-1 h-0 w-0 rounded-[4px_10px_4px_10px] bg-(--ui-accent-tint) opacity-0 transition-[transform,width,height] duration-300 ease-(--ui-spring)"
    />
  );
}
