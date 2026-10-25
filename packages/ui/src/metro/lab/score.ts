/**
 * How good a laid-out scene is. Clashes must be 0. Likeness to the hand scene is the main score;
 * crossings, bends and area break ties.
 */
import { crossingsOf, routeOf, sceneClashes, trackEnds } from "../geometry.js";
import { isMark, type MetroScene } from "../types.js";

/** Two stations closer than this in x or y count as level. */
const LEVEL = 8;

export interface Score {
  /** Overlaps: a name, chip or track on another mark or name. Must be 0. */
  clashes: number;
  /** Columns whose stations are not one even step apart: the hand maps keep one step. */
  uneven: number;
  crossings: number;
  bends: number;
  /** Width in px: the narrow map fits a laptop with the side panel open. */
  width: number;
  /** Width × height, in thousands of px². */
  area: number;
  /** The share of station pairs whose left/right and up/down agree with the hand scene; 1 is the same. Absent with no hand. */
  likeness?: number;
  /** The first few clashes, to read. */
  why: string[];
}

const side = (d: number) => (d > LEVEL ? 1 : d < -LEVEL ? -1 : 0);

export function likeness(scene: MetroScene, hand: MetroScene): number {
  const a = new Map(scene.st.filter(isMark).map((s) => [s.id, s]));
  const b = hand.st.filter(isMark).filter((s) => a.has(s.id));
  let same = 0;
  let all = 0;
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) {
      const p = b[i] as (typeof b)[number];
      const q = b[j] as (typeof b)[number];
      const P = a.get(p.id) as (typeof b)[number];
      const Q = a.get(q.id) as (typeof b)[number];
      all += 2;
      if (side(q.x - p.x) === side(Q.x - P.x)) same++;
      if (side(q.y - p.y) === side(Q.y - P.y)) same++;
    }
  return all ? same / all : 1;
}

function bendsOf(scene: MetroScene): number {
  const ends = trackEnds(scene);
  let n = 0;
  for (const r of scene.tr) {
    const e = r.stub ? null : ends(r);
    if (e) n += Math.max(0, routeOf(r, e[0], e[1]).length - 2);
  }
  return n;
}

export function scoreScene(scene: MetroScene, hand?: MetroScene): Score {
  const all = sceneClashes(scene);
  const clashes = all.filter((w) => !w.startsWith("gaps in "));
  return {
    clashes: clashes.length,
    uneven: all.length - clashes.length,
    crossings: crossingsOf(scene),
    bends: bendsOf(scene),
    width: Math.round(scene.w ?? 0),
    area: Math.round(((scene.w ?? 0) * scene.h) / 1000),
    ...(hand ? { likeness: Math.round(likeness(scene, hand) * 1000) / 1000 } : {}),
    why: clashes.slice(0, 5),
  };
}
