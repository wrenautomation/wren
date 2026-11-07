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
export function readGhost(key: string | undefined): Ghost | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Ghost) : null;
  } catch {
    return null;
  }
}

export function saveGhost(key: string, g: Ghost) {
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
