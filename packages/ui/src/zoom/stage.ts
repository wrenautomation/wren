/**
 * `useZoomStage`: the pan and zoom every hand-drawn graph shares (the weaver run graph, the
 * variants tree). d3-zoom on a stage element; the caller moves its world in `onZoom`.
 * React Flow graphs use `GraphFrame` instead.
 */
import "d3-transition";
import { select } from "d3-selection";
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { type RefObject, useLayoutEffect, useRef } from "react";

export interface ZoomBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** The room on screen a view may use, in stage pixels. */
export interface ZoomRoom {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface ZoomStageOpts {
  extent?: [number, number] | undefined;
  /** marks under this selector never start a pan or zoom (panels, cards) */
  ignore?: string | undefined;
  /** "pinch": a plain wheel scrolls the page (run graph). "pan": a plain wheel pans, and
   * scrolls the page only at an edge (canvas habit). */
  wheel?: "pinch" | "pan" | undefined;
  /** world bounds for "pan": the stage keeps some of it in view */
  bounds?: (() => ZoomBox | null) | undefined;
  onZoom: (t: ZoomTransform) => void;
}

export interface ZoomStage {
  T: RefObject<ZoomTransform>;
  go(t: ZoomTransform, ms?: number): void;
  /** translate (x, y), then scale k */
  set(x: number, y: number, k: number, ms?: number): void;
  scaleBy(k: number, ms?: number): void;
  /** B whole in R, scale clamped to [min, max] */
  fit(B: ZoomBox, R: ZoomRoom, o?: { min?: number; max?: number; ms?: number }): void;
  /** B into R when any of it is out; zooms only as far as needed, never under `min` */
  bring(
    B: ZoomBox,
    R: ZoomRoom,
    o?: { pad?: number; min?: number; max?: number; ms?: number },
  ): void;
}

const reduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useZoomStage(stage: HTMLElement | null, opts: ZoomStageOpts): ZoomStage {
  const T = useRef<ZoomTransform>(zoomIdentity);
  const zr = useRef<ZoomBehavior<HTMLElement, unknown> | null>(null);
  const o = useRef(opts);
  o.current = opts;
  const [lo, hi] = opts.extent ?? [0.2, 3];

  useLayoutEffect(() => {
    if (!stage) return;
    const pinch = (o.current.wheel ?? "pinch") === "pinch";
    const z = zoom<HTMLElement, unknown>()
      .scaleExtent([lo, hi])
      .clickDistance(5)
      .filter((e: Event & { button?: number; ctrlKey?: boolean; metaKey?: boolean }) => {
        const ig = o.current.ignore;
        if (ig && (e.target as Element | null)?.closest?.(ig)) return false;
        return e.type === "wheel" ? !!(e.ctrlKey || e.metaKey) : !e.button;
      })
      .on("zoom", (e: { transform: ZoomTransform }) => {
        T.current = e.transform;
        o.current.onZoom(e.transform);
      });
    zr.current = z;
    const sel = select(stage);
    sel.call(z).on("dblclick.zoom", null);
    T.current = zoomIdentity;
    // plain wheel pans; at an edge the page scrolls
    const onWheel = (e: WheelEvent) => {
      if (pinch || e.ctrlKey || e.metaKey) return;
      const ig = o.current.ignore;
      if (ig && (e.target as Element | null)?.closest?.(ig)) return;
      const t = T.current;
      const B = o.current.bounds?.();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (B) {
        // keep 48 px of the world in view on each side
        const W = stage.clientWidth;
        const H = stage.clientHeight;
        // the step left after the clamp, on one axis
        const clamp = (d: number, cur: number, a0: number, a1: number, size: number) =>
          cur - Math.max(48 - a1 * t.k, Math.min(size - 48 - a0 * t.k, cur - d));
        dx = clamp(dx, t.x, B.x0, B.x1, W);
        dy = clamp(dy, t.y, B.y0, B.y1, H);
      }
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      e.preventDefault();
      sel.call(z.translateBy, -dx / t.k, -dy / t.k);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      sel.on(".zoom", null);
      stage.removeEventListener("wheel", onWheel);
    };
  }, [stage, lo, hi]);

  const go = (t: ZoomTransform, ms = 0) => {
    const z = zr.current;
    if (!stage || !z) return;
    const sel = select(stage);
    if (ms && !reduced()) sel.transition().duration(ms).call(z.transform, t);
    else sel.call(z.transform, t);
  };
  const at = (B: ZoomBox, R: ZoomRoom, k: number) =>
    zoomIdentity
      .translate(
        (R.l + R.r) / 2 - ((B.x0 + B.x1) / 2) * k,
        (R.t + R.b) / 2 - ((B.y0 + B.y1) / 2) * k,
      )
      .scale(k);
  return {
    T,
    go,
    set: (x, y, k, ms = 0) => go(zoomIdentity.translate(x, y).scale(k), ms),
    scaleBy: (k, ms = 250) => {
      const z = zr.current;
      if (!stage || !z) return;
      const sel = select(stage);
      if (ms && !reduced()) sel.transition().duration(ms).call(z.scaleBy, k);
      else sel.call(z.scaleBy, k);
    },
    fit: (B, R, { min = lo, max = 1, ms = 0 } = {}) => {
      if (!(B.x1 > B.x0 && B.y1 > B.y0)) return;
      const k = Math.max(
        min,
        Math.min(max, (R.r - R.l) / (B.x1 - B.x0), (R.b - R.t) / (B.y1 - B.y0)),
      );
      go(at(B, R, k), ms);
    },
    bring: (B, R, { pad = 24, min = lo, max = hi, ms = 450 } = {}) => {
      const t = T.current;
      const inside =
        t.k >= min &&
        t.applyX(B.x0) >= R.l + pad &&
        t.applyX(B.x1) <= R.r - pad &&
        t.applyY(B.y0) >= R.t + pad &&
        t.applyY(B.y1) <= R.b - pad;
      if (inside) return;
      const k = Math.max(
        min,
        Math.min(
          max,
          Math.max(t.k, min),
          (R.r - R.l - pad * 2) / (B.x1 - B.x0 || 1),
          (R.b - R.t - pad * 2) / (B.y1 - B.y0 || 1),
        ),
      );
      go(at(B, R, k), ms);
    },
  };
}
