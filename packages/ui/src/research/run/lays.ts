/** The web's shelf: sources with no finding, below the web. What it shows and where each goes. */
import type { GNode, Indexed } from "./model.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Size = (key: string) => { w: number; h: number };

/** Lay a list into rows of a set width; returns where they end. */
export function flow(
  keys: string[],
  size: Size,
  at: Map<string, Box>,
  x0: number,
  y0: number,
  w: number,
  gx: number,
  gy: number,
) {
  let x = x0;
  let y = y0;
  let rh = 0;
  for (const k of keys) {
    const s = size(k);
    if (x > x0 && x + s.w > x0 + w) {
      x = x0;
      y += rh + gy;
      rh = 0;
    }
    at.set(k, { x, y, ...s });
    x += s.w + gx;
    rh = Math.max(rh, s.h);
  }
  return y + rh;
}

export interface Shelf {
  quiet: { t: string; ns: GNode[]; id: "rd" | "gh" }[];
}
export function shelfOf(L: Indexed, on: (id: number) => boolean): Shelf {
  const quiet = L.nodes.filter((n) => !n.s.kept && !on(n.id));
  return {
    quiet: (
      [
        { t: "Read, no finding", ns: quiet.filter((n) => n.s.pages.length), id: "rd" },
        { t: "Kept, not read", ns: quiet.filter((n) => !n.s.pages.length), id: "gh" },
      ] as const
    )
      .filter((g) => g.ns.length)
      .map((g) => ({ ...g, ns: [...g.ns] })),
  };
}
/** Where each shelf mark sits, from the shelf's top left. */
export function layShelf(sh: Shelf, size: Size, wide: boolean) {
  const at = new Map<string, Box>();
  const sw = wide ? 900 : 330;
  let y = 0;
  let x = 0;
  for (const g of sh.quiet) {
    const lb = size(`shq${g.id}`);
    at.set(`shq${g.id}`, { x, y, ...lb });
    const w = Math.max(lb.w, Math.min(sw / 2 - 20, g.ns.length * 17));
    const yy = flow(
      g.ns.map((n) => `sh${n.id}`),
      size,
      at,
      x,
      y + lb.h + 6,
      w,
      5,
      5,
    );
    x += w + 40;
    if (x > sw - 60) {
      x = 0;
      y = yy + 14;
    }
  }
  return at;
}
