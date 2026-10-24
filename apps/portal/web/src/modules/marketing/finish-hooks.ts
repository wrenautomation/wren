/** The Finish view's hooks and pointer helpers: a steady signed URL, a drag, a measured width. */
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

/**
 * A signed URL that stays put while only its signature changes, so a read of the record doesn't
 * reload the player. After an error (an old signature ran out) it takes the newest.
 */
export function useSteadyUrl(url: string | null): [string | null, () => void] {
  const kept = useRef(url);
  const newest = useRef(url);
  const [, redraw] = useState(0);
  newest.current = url;
  if (!url) kept.current = null;
  else if (!kept.current || kept.current.split("?")[0] !== url.split("?")[0]) kept.current = url;
  const renew = () => {
    if (newest.current && newest.current !== kept.current) {
      kept.current = newest.current;
      redraw((n) => n + 1);
    }
  };
  return [kept.current, renew];
}

/** A drag: `move` on each pointer move, `up` once on release, both with the pointer's event. */
export function drag(
  e: ReactPointerEvent,
  move: (ev: PointerEvent) => void,
  up: (ev: PointerEvent, moved: boolean) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  // No focus move on a prevented press: a field he typed in would keep the keys (I, O, Space).
  const typing = document.activeElement;
  if (typing instanceof HTMLElement && typing.closest("input, textarea, select")) typing.blur();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
    moved = true;
    move(ev);
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    up(ev, moved);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

/** The width an element draws at, kept current. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e?.contentRect.width ?? 0));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
