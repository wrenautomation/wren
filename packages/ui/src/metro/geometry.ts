/** The metro map's geometry: octilinear paths with rounded corners, marker boxes, the leaf. */
import type { MarkStation, Point, StationKind } from "./types.js";

/** Marker radius by kind. */
export const RADIUS: Record<StationKind, number> = {
  hub: 21,
  att: 14,
  time: 15,
  cash: 16,
  exit: 13,
  plan: 14,
  dec: 15,
  race: 15,
  par: 6,
  ab: 14,
  ok: 15,
  link: 15,
};

/** The glyph size a marker holds. */
export const GLYPH_SIZE: Partial<Record<StationKind, number>> = { hub: 22, exit: 15 };

/** Points of an octilinear route a to b: straight, then 45 degrees, then straight. */
export function octPts(a: Point, b: Point): Point[] {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (!dy || !dx) return [a, b];
  const d = Math.min(Math.abs(dy), Math.abs(dx));
  const f = (Math.abs(dx) - d) / 2;
  const s = Math.sign(dx);
  return [a, [x1 + s * f, y1], [x1 + s * (f + d), y2], b];
}

/** A path through `pts` with rounded corners of radius `r`. Repeated points drop out. */
export function rounded(points: Point[], r = 18): string {
  const p = points.filter((q, i) => {
    const prev = points[i - 1];
    return !prev || q[0] !== prev[0] || q[1] !== prev[1];
  });
  const first = p[0];
  if (!first) return "";
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1] as Point;
    const b = p[i] as Point;
    const c = p[i + 1] as Point;
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const k = Math.min(r, l1 / 2, l2 / 2);
    const u = [b[0] - ((b[0] - a[0]) / l1) * k, b[1] - ((b[1] - a[1]) / l1) * k];
    const v = [b[0] + ((c[0] - b[0]) / l2) * k, b[1] + ((c[1] - b[1]) / l2) * k];
    d += `L${u[0]} ${u[1]}Q${b[0]} ${b[1]} ${v[0]} ${v[1]}`;
  }
  const e = p[p.length - 1] as Point;
  return p.length > 1 ? `${d}L${e[0]} ${e[1]}` : d;
}

/** The route a to b, octilinear and rounded. */
export const octPath = (a: Point, b: Point, r?: number): string => rounded(octPts(a, b), r);

/** A marker's box: radius, centre y, top, height, width, corner. */
export function markerBox(s: Pick<MarkStation, "t" | "x" | "y" | "span">) {
  const sp = s.span ?? [s.y, s.y];
  const r = RADIUS[s.t];
  const cy = (sp[0] + sp[1]) / 2;
  const par = s.t === "par";
  return {
    r,
    cy,
    top: par ? cy - 17 : sp[0] - r,
    h: par ? 34 : sp[1] - sp[0] + 2 * r,
    w: s.t === "exit" ? 36 : par ? 10 : 2 * r,
    rx: s.t === "cash" || s.t === "ok" ? 8 : r,
    /** A diamond's half diagonal. */
    d: r * 1.4,
  };
}

/** A leaf rect: small radius top left and bottom right, large on the other two, as in the mark. */
export function leafPath(x: number, y: number, w: number, h: number, a: number, bigger: number) {
  const b = Math.min(bigger, h / 2, w / 2);
  return `M${x + a} ${y}H${x + w - b}A${b} ${b} 0 0 1 ${x + w} ${y + b}V${y + h - a}A${a} ${a} 0 0 1 ${x + w - a} ${y + h}H${x + b}A${b} ${b} 0 0 1 ${x} ${y + h - b}V${y + a}A${a} ${a} 0 0 1 ${x + a} ${y}Z`;
}

/** Mid point of two points. */
export const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** The point `f` (0 to 1) of the way along a polyline, by length. */
export function along(pts: readonly Point[], f: number): Point {
  const first = pts[0] ?? [0, 0];
  const lens = pts
    .slice(1)
    .map((q, i) => Math.hypot(q[0] - (pts[i] as Point)[0], q[1] - (pts[i] as Point)[1]));
  let rest = lens.reduce((a, b) => a + b, 0) * Math.min(1, Math.max(0, f));
  for (let i = 0; i < lens.length; i++) {
    const len = lens[i] as number;
    const a = pts[i] as Point;
    const b = pts[i + 1] as Point;
    if (rest <= len || i === lens.length - 1)
      return len ? [a[0] + ((b[0] - a[0]) * rest) / len, a[1] + ((b[1] - a[1]) * rest) / len] : a;
    rest -= len;
  }
  return first;
}

/**
 * A point `gap` px to the side of the route `f` of the way along it: above a level or diagonal run,
 * right of an upright one. A tag set there sits clear of the line.
 */
export function beside(pts: readonly Point[], f: number, gap: number): Point {
  const [x, y] = along(pts, f);
  // The direction of the route there: the segment that holds the point.
  let dx = 0;
  let dy = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) continue;
    // Distance from the point to the segment (both ends measured, enough for a polyline).
    const d = Math.abs((b[0] - a[0]) * (a[1] - y) - (a[0] - x) * (b[1] - a[1])) / len;
    const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (len * len);
    if (t >= -1e-6 && t <= 1 + 1e-6 && d < best) {
      best = d;
      dx = (b[0] - a[0]) / len;
      dy = (b[1] - a[1]) / len;
    }
  }
  let nx = dy;
  let ny = -dx;
  if (ny > 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return [x + nx * gap, y + ny * gap];
}
