/**
 * A map's ghost: its last drawn layout as muted shapes (stops, rails, name bars), kept per page in
 * this browser. The skeleton draws it at the map's own size and place, so the map lands on it
 * (William, 11-07: the skeleton "doesn't fit the actual layout"). A few KB per page; last 16 kept.
 */
import { labelBoxes, markerBox, routeOf, trackEnds } from "./geometry.js";
import { isBadge, isCapsule, isMark, isRing, type MetroScene } from "./types.js";

export interface Ghost {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Stops: x, y, w, h, corner radius. */
  st: [number, number, number, number, number][];
  /** Every rail as one path, with its width. */
  tr: [string, number][];
  /** Name bars: x, y, w. */
  names: [number, number, number][];
  /** The drawn map's top in the window, at window width `vw`: page chrome above it may load late. */
  top?: number;
  vw?: number;
}

const r1 = (n: number) => Math.round(n);

export function ghostOf(scene: MetroScene): Ghost {
  const ends = trackEnds(scene);
  const st: Ghost["st"] = scene.st.map((s) => {
    if (isMark(s)) {
      const b = markerBox(s);
      return [r1(s.x - b.w / 2), r1(b.top), r1(b.w), r1(b.h), r1(Math.min(b.rx, b.w / 2))];
    }
    if (isCapsule(s))
      return [r1(s.cap[0] - 14), r1(s.y - 14), r1(s.cap[1] - s.cap[0] + 28), 28, 14];
    if (isRing(s)) {
      const r = s.r ?? 16;
      return [r1(s.x - r), r1(s.y - r), 2 * r, 2 * r, r];
    }
    const w = isBadge(s) ? (s.w ?? 140) : 40;
    return [r1(s.x - w / 2), r1(s.y - 20), r1(w), 40, 12];
  });
  const tr: Ghost["tr"] = scene.tr.flatMap((r): Ghost["tr"] => {
    const e = ends(r);
    if (!e || r.stub) return [];
    const pts = routeOf(r, e[0], e[1]);
    return [[pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join(""), r.k ? 3 : 6]];
  });
  const names: Ghost["names"] = scene.st.flatMap((s) =>
    "n" in s && s.n && isMark(s)
      ? labelBoxes(s)
          .slice(0, 1)
          .map((b): [number, number, number] => [r1(b.x0), r1(b.y0 + 4), r1(b.x1 - b.x0)])
      : [],
  );
  return { x0: scene.x0 ?? 0, y0: scene.y0 ?? 0, w: scene.w ?? 960, h: scene.h, st, tr, names };
}

const PREFIX = "metro.ghost.v1.";
const INDEX = `${PREFIX}index`;
const KEEP = 16;

/** The last ghost drawn for this page, or null (none yet, or storage blocked). */
export function readGhost(key: string | undefined): Ghost | LayersGhost | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Ghost | LayersGhost) : null;
  } catch {
    return null;
  }
}

export function saveGhost(key: string, g: Ghost | LayersGhost) {
  try {
    const was = JSON.parse(localStorage.getItem(INDEX) ?? "[]") as string[];
    const keys = [key, ...was.filter((k) => k !== key)];
    for (const k of keys.slice(KEEP)) localStorage.removeItem(PREFIX + k);
    localStorage.setItem(PREFIX + key, JSON.stringify(g));
    localStorage.setItem(INDEX, JSON.stringify(keys.slice(0, KEEP)));
  } catch {
    // storage full or blocked: the skeleton falls back to its sketch
  }
}

/**
 * The Layers view's ghost: floor and plates as it last stood at its first fit, every point put
 * through the camera (view px), so the 3D view lands on it too.
 */
export interface LayersGhost {
  kind: "layers";
  /** The view's box and its place in the window, at window width `vw`. */
  bw: number;
  bh: number;
  top: number;
  left: number;
  vw: number;
  /** Faces, the floor first: polygon points. */
  faces: string[];
  tr: [string, number][];
  st: string[];
  names: string[];
}

type See = (x: number, y: number) => readonly [number, number];
const poly = (see: See, x: number, y: number, w: number, h: number) =>
  [see(x, y), see(x + w, y), see(x + w, y + h), see(x, y + h)]
    .map(([a, b]) => `${r1(a)},${r1(b)}`)
    .join(" ");

/** One scene's shapes through `see` (scene px to view px); `k`: the stroke scale. */
export function layerShapes(
  scene: MetroScene,
  see: See,
  k: number,
): Pick<LayersGhost, "tr" | "st" | "names"> & { face: string } {
  const g = ghostOf(scene);
  const ends = trackEnds(scene);
  const tr: LayersGhost["tr"] = scene.tr.flatMap((r): LayersGhost["tr"] => {
    const e = ends(r);
    if (!e || r.stub) return [];
    const pts = routeOf(r, e[0], e[1]).map(([x, y]) => see(x, y));
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join("");
    return [[d, Math.max(1.5, (r.k ? 3 : 6) * k)]];
  });
  return {
    face: poly(see, g.x0, g.y0, g.w, g.h),
    tr,
    st: g.st.map(([x, y, w, h]) => poly(see, x, y, w, h)),
    names: g.names.map(([x, y, w]) => poly(see, x, y, w, 7)),
  };
}
