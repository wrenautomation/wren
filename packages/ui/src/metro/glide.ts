/**
 * The glide between two states of a map (a depth step, a node opened or folded). Port of
 * `render` in the artifact's `mountZoom`: marks that stay slide and scale to their new place, marks
 * that appear grow out of the group that opened, the new lines fade in under them, and the old
 * frame fades out on top. Imperative on purpose: it measures the DOM after React has committed,
 * and uses the Web Animations API, so it costs no re-render.
 */
import type { Point } from "./types.js";

const EASE = "cubic-bezier(.22,1,.36,1)";

interface Box {
  n: SVGGraphicsElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The key of a mark that can glide: a station, a fold tab, a person pill. Null: it cannot. */
export function glideKey(n: Element): string | null {
  const el = n as SVGElement;
  if (el.dataset.id) return `i:${el.dataset.id}`;
  if (el.dataset.fold) return `f:${el.dataset.fold}`;
  if (el.dataset.tr && !el.classList.contains("hit")) return `p:${el.dataset.tr}`;
  return null;
}

/** Whether this environment can measure and animate. happy-dom cannot. */
const canGlide = (n: SVGGraphicsElement) =>
  typeof n.getBBox === "function" && typeof n.animate === "function";

/** Every glide-able mark of a map, with its centre and size. */
export function snapshot(svg: Element | null | undefined): Map<string, Box> {
  const out = new Map<string, Box>();
  if (!svg) return out;
  for (const n of svg.querySelectorAll<SVGGraphicsElement>(
    "[data-id],[data-fold],.pill[data-tr]",
  )) {
    const k = glideKey(n);
    if (!k || !canGlide(n)) continue;
    const b = n.getBBox();
    out.set(k, { n, x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height });
  }
  return out;
}

/** The centre of an element, in its map's units: where a group grows from. */
export function centreOf(n: Element | null): Point | null {
  const g = n as SVGGraphicsElement | null;
  if (!g || typeof g.getBBox !== "function") return null;
  const b = g.getBBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}

/**
 * Glide from `old` (a copy of the last frame, laid over the map) to `next` (the live svg).
 * Marks that appear grow out of the anchor; marks that go shrink back into it. The anchor is a
 * mark of the new frame (`anchorKey`: the circle a group folded into), else a point.
 * Returns how long the old frame must stay, in ms.
 */
export function glide(o: {
  old: SVGSVGElement;
  next: SVGSVGElement;
  anchor?: Point | null | undefined;
  anchorKey?: string | null | undefined;
}): number {
  const before = snapshot(o.old);
  const after = snapshot(o.next);
  const to = o.anchorKey ? after.get(o.anchorKey) : undefined;
  const anchor: Point | null = to ? [to.x, to.y] : (o.anchor ?? null);
  const gone = [...before].filter(([k]) => !after.has(k)).map(([, b]) => b);
  for (const [k, b] of before) if (after.has(k)) b.n.style.opacity = "0";
  // The old frame fades, except the marks that go: they shrink into the anchor first.
  const goneSet = new Set<Element>(gone.map((b) => b.n));
  for (const c of o.old.children) {
    if (goneSet.has(c) || gone.some((b) => c.contains(b.n))) continue;
    c.animate?.([{ opacity: 1 }, { opacity: 0 }], {
      duration: GLIDE_MS.fade,
      easing: "ease-out",
      fill: "forwards",
    });
  }
  for (const b of gone) {
    const [ax, ay] = anchor ?? [b.x, b.y];
    b.n.style.transformBox = "fill-box";
    b.n.style.transformOrigin = "center";
    b.n.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: `translate(${ax - b.x}px,${ay - b.y}px) scale(.4)` },
      ],
      { duration: GLIDE_MS.shrink, easing: EASE, fill: "forwards" },
    );
  }
  for (const n of o.next.querySelectorAll<SVGElement>(".case,.trk,.spur,.xfer,.hit,.opn")) {
    n.animate?.([{ opacity: 0 }, { opacity: 1 }], {
      duration: 320,
      delay: 80,
      easing: "ease-out",
      fill: "backwards",
    });
  }
  for (const [k, a] of after) {
    const prev = before.get(k);
    a.n.style.transformBox = "fill-box";
    a.n.style.transformOrigin = "center";
    if (prev) {
      // The hub keeps its width; every other mark scales to its new size.
      const sx = k === "i:hub" ? 1 : prev.w / a.w;
      const sy = prev.h / a.h;
      if (prev.x !== a.x || prev.y !== a.y || Math.abs(sy - 1) > 0.02) {
        a.n.animate(
          [
            {
              transform: `translate(${prev.x - a.x}px,${prev.y - a.y}px) scale(${Math.abs(sx - 1) > 0.02 ? sx : 1},${Math.abs(sy - 1) > 0.02 ? sy : 1})`,
            },
            { transform: "none" },
          ],
          { duration: GLIDE_MS.move, easing: EASE },
        );
      }
    } else if (a !== to) {
      // It grows out of the anchor, the way a closing mark goes back in.
      const [ax, ay] = anchor ?? [a.x, a.y];
      a.n.animate(
        [
          { opacity: 0, transform: `translate(${ax - a.x}px,${ay - a.y}px) scale(.4)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: GLIDE_MS.move, delay: 40, easing: EASE, fill: "backwards" },
      );
    } else {
      // The circle a group folds into fills in as the stations reach it.
      a.n.animate(
        [
          { opacity: 0, transform: "scale(.6)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: GLIDE_MS.move, delay: GLIDE_MS.shrink * 0.4, easing: EASE, fill: "backwards" },
      );
    }
  }
  return gone.length ? GLIDE_MS.shrink : GLIDE_MS.fade;
}

/** Fade the new frame in when there is nothing to glide from (reduced motion). */
export function fadeIn(next: Element): void {
  next.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
}

/** The map's own height eases between two frames. */
export function glideHeight(host: HTMLElement, from: number, to: number): void {
  if (from === to) return;
  host.animate?.([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: GLIDE_MS.move,
    easing: EASE,
  });
}

export const GLIDE_MS = { move: 460, fade: 180, shrink: 380 } as const;
