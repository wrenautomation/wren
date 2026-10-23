/**
 * The metro map's geometry: octilinear paths with rounded corners, marker boxes, the leaf, and the
 * boxes every mark fills. Layout, marks and tests read the same boxes, so a label is never placed
 * where the drawing would put it somewhere else.
 */
import type { IconName } from "../icons.js";
import {
  isMark,
  type MarkStation,
  type MetroScene,
  type MetroTrack,
  type Point,
  type StationKind,
} from "./types.js";

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

/** The room a fold tab takes above an open group's top: the tab and a gap. */
export const TAB_ROOM = 38;

/** The glyph size a marker holds. */
export const GLYPH_SIZE: Partial<Record<StationKind, number>> = { hub: 22, exit: 15 };

/** Points of an octilinear route a to b: straight, then 45 degrees, then straight. */
export function octPts(a: Point, b: Point, bend?: "a" | "b"): Point[] {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (!dy || !dx) return [a, b];
  const d = Math.min(Math.abs(dy), Math.abs(dx));
  const s = Math.sign(dx);
  // The 45 degree part at one end: lines leave a hub at once, each on its own diagonal.
  if (bend === "a" && d === Math.abs(dy)) return [a, [x1 + s * d, y2], b];
  if (bend === "b" && d === Math.abs(dy)) return [a, [x2 - s * d, y1], b];
  const f = (Math.abs(dx) - d) / 2;
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
export function markerBox(s: Pick<MarkStation, "t" | "x" | "y" | "r">) {
  const r = s.r ?? RADIUS[s.t];
  const cy = s.y;
  const par = s.t === "par";
  return {
    r,
    cy,
    top: par ? cy - 17 : cy - r,
    h: par ? 34 : 2 * r,
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

/** The length of a polyline. */
export const lengthOf = (pts: readonly Point[]): number =>
  pts
    .slice(1)
    .reduce(
      (n, q, i) => n + Math.hypot(q[0] - (pts[i] as Point)[0], q[1] - (pts[i] as Point)[1]),
      0,
    );

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

/** The route of a transfer: a 45 degree connector from `a` that merges into the line at `c`. */
export function xferGeometry(a: Point, c: Point, f = 0.62) {
  const dy = c[1] - a[1];
  const dx = c[0] - a[0];
  const k = Math.min(Math.abs(dy), Math.abs(dx));
  const e: Point = [a[0] + Math.sign(dx) * k, c[1]];
  const m: Point = [a[0] + (e[0] - a[0]) * f, a[1] + (e[1] - a[1]) * f];
  return { d: rounded([a, e, c], 22), m, pts: [a, e, c] as Point[] };
}

// ---------------------------------------------------------------------------------------------
// Text and boxes. One width estimate serves the whole map.

/**
 * Rough width of a text in px: 14px at weight 650 is 7.4 px a letter. `bold` is the 700 weight of
 * chips and pills. Layout and marks both call this, so they agree on how wide a name is.
 */
export function textWidth(t: string, px = 14, bold = false): number {
  return t.length * px * (bold ? 0.58 : 0.53);
}

/** A rectangle: left, top, right, bottom. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const boxAt = (cx: number, cy: number, w: number, h: number): Box => ({
  x0: cx - w / 2,
  y0: cy - h / 2,
  x1: cx + w / 2,
  y1: cy + h / 2,
});

/** The two boxes share area, or lie closer than `gap`. Boxes that only touch do not overlap. */
export const overlaps = (a: Box, b: Box, gap = 0): boolean =>
  a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

export const joinBoxes = (boxes: readonly Box[]): Box => ({
  x0: Math.min(...boxes.map((b) => b.x0)),
  y0: Math.min(...boxes.map((b) => b.y0)),
  x1: Math.max(...boxes.map((b) => b.x1)),
  y1: Math.max(...boxes.map((b) => b.y1)),
});

/** A free chip (retry, hold, branch label): a pill 21 high, with or without a glyph. */
export const chipWidth = (t: string, icon?: IconName | null): number =>
  textWidth(t, 11, true) + (icon === null ? 18 : 30);
/** A branch chip's height. */
export const CHIP_H = 21;
export const chipBox = (x: number, y: number, t: string, icon?: IconName | null): Box =>
  boxAt(x, y, chipWidth(t, icon), CHIP_H);

/** The tag of a split or join gate. */
export const ruleWidth = (t: string): number => textWidth(t) + 14;

/** A person track's pill: avatar, then the promise. */
export const pillWidth = (who: string): number =>
  textWidth(who.split(" · ")[1] ?? "", 12, true) + 42;
export const pillBox = (at: Point, who: string, bdy = 0): Box =>
  boxAt(at[0], at[1] + bdy, pillWidth(who), 26);

/** Air a person's pill or a branch chip keeps from every mark, on both sides (William, 10-21). */
export const CHIP_ROOM = 12;

/** The dot a pill folds to when its track has no room: a ring 20 across. */
export const DOT = 20;
export const dotBox = (at: Point): Box => boxAt(at[0], at[1], DOT, DOT);

/** A transfer's label pill. */
export const xferWidth = (lab: string): number => textWidth(lab, 11, true) + 20;
export const xferBox = (m: Point, lab: string): Box => boxAt(m[0], m[1], xferWidth(lab), 21);

/** A diff tag: a dot 16 across. */
const tagBox = (p: Point): Box => boxAt(p[0], p[1], 16, 16);

/** The rows of room the label of a station may use at its side: name 14px, sub 12px. */
type LabelStation = Pick<
  MarkStation,
  | "t"
  | "x"
  | "y"
  | "r"
  | "n"
  | "s"
  | "p"
  | "rep"
  | "repGlyph"
  | "plans"
  | "bundle"
  | "mark"
  | "rule"
>;

/**
 * Where a station's name sits: the text anchor, the point of its baseline, the baseline of the sub,
 * and the diff tag. `Marker` draws from this, and `labelBoxes` measures from it.
 */
export function labelOf(s: LabelStation) {
  const { r, cy, top, h, w } = markerBox(s);
  const bot = top + h;
  const p = s.p ?? "up";
  const anchor: "start" | "middle" | "end" =
    p === "right" ? "start" : p === "left" ? "end" : "middle";
  const x = p === "right" ? s.x + w / 2 + 10 : p === "left" ? s.x - w / 2 - 10 : s.x;
  const y =
    p === "up"
      ? top - 10 - (s.s ? 15 : 0)
      : p === "down"
        ? bot + 19 + (s.rep ? 26 : 0) + (s.plans ? 26 : 0)
        : cy + (s.s ? -3 : 5);
  const nw = s.n ? textWidth(s.n) : 0;
  // The diff tag sits beside the name, on the side it reads towards.
  const tag: Point = s.n
    ? [anchor === "end" ? x - nw - 12 : x + (anchor === "start" ? nw : nw / 2) + 12, y - 4]
    : [s.x + w / 2, top];
  return { p, anchor, x, y, sub: y + 15, tag, r };
}

/** The boxes of a station's name, its sub and its diff tag. Empty when it has no name. */
export function labelBoxes(s: LabelStation): Box[] {
  if (!s.n) return [];
  const l = labelOf(s);
  const at = (w: number): [number, number] =>
    l.anchor === "start"
      ? [l.x, l.x + w]
      : l.anchor === "end"
        ? [l.x - w, l.x]
        : [l.x - w / 2, l.x + w / 2];
  const [n0, n1] = at(textWidth(s.n));
  const out: Box[] = [{ x0: n0, y0: l.y - 11, x1: n1, y1: l.y + 4 }];
  if (s.s) {
    const [s0, s1] = at(textWidth(s.s, 12));
    out.push({ x0: s0, y0: l.sub - 9.5, x1: s1, y1: l.sub + 3.5 });
  }
  if (s.mark) out.push(tagBox(l.tag));
  return out;
}

/** The boxes a station's mark fills: the marker, a stack behind it, its chips and its rule tag. */
export function markBoxes(s: LabelStation): Box[] {
  const { r, cy, top, h, w, d } = markerBox(s);
  const diamond = s.t === "dec" || s.t === "race";
  // The ring and the shadow add about 2 px.
  const pad = 2;
  const body: Box = diamond
    ? { x0: s.x - d - pad, y0: cy - d - pad, x1: s.x + d + pad, y1: cy + d + pad }
    : { x0: s.x - w / 2 - pad, y0: top - pad, x1: s.x + w / 2 + pad, y1: top + h + pad };
  const out = [body];
  if (s.bundle || s.t === "link")
    out.push({ x0: body.x0 + 5, y0: body.y0 - 5, x1: body.x1 + 5, y1: body.y1 - 5 });
  if (s.rep)
    out.push(chipBox(s.x, s.y + r + 17, s.rep, s.repGlyph === undefined ? "repeat" : s.repGlyph));
  if (s.plans) out.push(chipBox(s.x, s.y + r + 17 + (s.rep ? 26 : 0), s.plans, "card"));
  if (s.rule) out.push(boxAt(s.x, top - 14, ruleWidth(s.rule), 18));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tracks: where they run, where they cross, and which boxes the scene holds.

/** Where a track starts and ends; null when it has neither station nor points. */
export function trackEnds(scene: Pick<MetroScene, "st">): (r: MetroTrack) => [Point, Point] | null {
  const byId = new Map(scene.st.map((s) => [s.id, s]));
  const at = (id: string, o: number): Point | null => {
    const s = byId.get(id);
    return s ? [s.x ?? 0, s.y + o] : null;
  };
  return (r) => {
    const a = r.pa ?? (r.a ? at(r.a, r.oa ?? r.o ?? 0) : r.pts?.[0]);
    const c = r.pc ?? (r.b ? at(r.b, r.ob ?? r.o ?? 0) : r.pts ? r.pts[r.pts.length - 1] : a);
    return a && c ? [a, c] : null;
  };
}

/** The corners of the route a track draws from `a` to `c`. */
export const routeOf = (r: MetroTrack, a: Point, c: Point): Point[] =>
  r.k === "xfer"
    ? xferGeometry(a, c, r.f).pts
    : (r.pts ?? (r.back ? railPts(a, c, r.back) : octPts(a, c, r.bend)));

/** A track back along its own row: down from its start, along under the row, up into its end. */
export const railPts = (a: Point, c: Point, d: number): Point[] => [
  a,
  [a[0], a[1] + d],
  [c[0], c[1] + d],
  c,
];

const side = (p: Point, q: Point, o: Point) =>
  (q[0] - p[0]) * (o[1] - p[1]) - (q[1] - p[1]) * (o[0] - p[0]);
const within = (p: Point, q: Point, o: Point) =>
  Math.min(p[0], q[0]) <= o[0] &&
  o[0] <= Math.max(p[0], q[0]) &&
  Math.min(p[1], q[1]) <= o[1] &&
  o[1] <= Math.max(p[1], q[1]);

/** Two segments meet: they cross, touch or lie on one another. */
function meet(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  return (
    (d1 === 0 && within(a, b, c)) ||
    (d2 === 0 && within(a, b, d)) ||
    (d3 === 0 && within(c, d, a)) ||
    (d4 === 0 && within(c, d, b))
  );
}

/** A polyline runs through the inside of a box. Running along its edge does not count. */
export function routeHits(pts: readonly Point[], box: Box): boolean {
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1] as Point;
    const q = pts[i] as Point;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    let t0 = 0;
    let t1 = 1;
    // Liang-Barsky: clip the segment to the box, side by side.
    const clip = (pn: number, qn: number): boolean => {
      if (pn === 0) return qn > 0;
      const t = qn / pn;
      if (pn < 0) {
        if (t > t1) return false;
        t0 = Math.max(t0, t);
      } else {
        if (t < t0) return false;
        t1 = Math.min(t1, t);
      }
      return true;
    };
    if (
      clip(-dx, p[0] - box.x0) &&
      clip(dx, box.x1 - p[0]) &&
      clip(-dy, p[1] - box.y0) &&
      clip(dy, box.y1 - p[1]) &&
      t1 - t0 > 1e-9
    )
      return true;
  }
  return false;
}

/**
 * How many pairs of tracks cross. Two tracks that share a station only meet there, so they do not
 * count. The count a layout tries to cut.
 */
export function crossingsOf(scene: Pick<MetroScene, "st" | "tr">): number {
  const ends = trackEnds(scene);
  const routes: { r: MetroTrack; pts: Point[] }[] = [];
  for (const r of scene.tr) {
    const e = r.stub ? null : ends(r);
    if (e) routes.push({ r, pts: routeOf(r, e[0], e[1]) });
  }
  const shares = (p: MetroTrack, q: MetroTrack) =>
    (!!p.a && (p.a === q.a || p.a === q.b)) || (!!p.b && (p.b === q.a || p.b === q.b));
  let n = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const p = routes[i] as (typeof routes)[number];
      const q = routes[j] as (typeof routes)[number];
      if (shares(p.r, q.r)) continue;
      let hit = false;
      for (let a = 1; a < p.pts.length && !hit; a++)
        for (let b = 1; b < q.pts.length && !hit; b++)
          hit = meet(
            p.pts[a - 1] as Point,
            p.pts[a] as Point,
            q.pts[b - 1] as Point,
            q.pts[b] as Point,
          );
      if (hit) n++;
    }
  }
  return n;
}

/** A box with the id of the mark that owns it. */
export interface Boxed {
  id: string;
  box: Box;
  /** A chip that keeps `CHIP_ROOM` clear of every mark: a person's pill or a branch chip. */
  room?: true;
}

/** Every box a scene fills, by kind. The layout and the tests read these; the drawing agrees. */
export interface SceneBoxes {
  /** Names, subs and diff tags of stations. */
  labels: Boxed[];
  /** Station marks, their stacks, chips and rule tags; the hub is apart. */
  marks: Boxed[];
  hub: Boxed[];
  /** A person track's pill, or its dot. */
  chips: Boxed[];
  /** A transfer's label and a branch label. */
  tracks: Boxed[];
}

export function sceneBoxes(scene: Pick<MetroScene, "st" | "tr">): SceneBoxes {
  const out: SceneBoxes = { labels: [], marks: [], hub: [], chips: [], tracks: [] };
  for (const s of scene.st) {
    if (!isMark(s)) continue;
    for (const box of labelBoxes(s)) out.labels.push({ id: s.id, box });
    for (const box of markBoxes(s)) (s.t === "hub" ? out.hub : out.marks).push({ id: s.id, box });
  }
  const ends = trackEnds(scene);
  scene.tr.forEach((r, i) => {
    const e = r.stub ? null : ends(r);
    if (!e) return;
    const id = r.id ?? `t${i}`;
    if (r.k === "xfer") {
      out.tracks.push({ id, box: xferBox(xferGeometry(e[0], e[1], r.f).m, r.lab ?? "") });
      return;
    }
    // A shared condition draws one chip, on the track that leads the group.
    if (r.cond && !r.condShared)
      out.tracks.push({
        id,
        box: chipBox(...(r.cat ?? mid(e[0], e[1])), r.cond, r.condGlyph ?? null),
        room: true,
      });
    if (r.k !== "exit" && r.who && r.who !== "auto") {
      const at = r.at ?? mid(e[0], e[1]);
      out.chips.push(
        r.dot ? { id, box: dotBox(at) } : { id, box: pillBox(at, r.who, r.bdy), room: true },
      );
    }
  });
  return out;
}

/**
 * What a calm map must not do, as one line each. Empty when the map is calm: no name on a name or a
 * mark, no chip on a mark, a name or the hub, no track under the hub, one step between the
 * stations of a column, and the hub's inputs on its left and its offers on its right. The tests, the stories and the layout's own checks read this one copy.
 */
export function sceneClashes(scene: Pick<MetroScene, "st" | "tr" | "zones">): string[] {
  const out: string[] = [];
  const b = sceneBoxes(scene);
  const solid = [...b.marks, ...b.hub];
  b.labels.forEach((l, i) => {
    for (const m of b.labels.slice(i + 1))
      if (overlaps(l.box, m.box)) out.push(`name of ${l.id} meets name of ${m.id}`);
    for (const m of solid)
      if (overlaps(l.box, m.box)) out.push(`name of ${l.id} meets mark ${m.id}`);
  });
  for (const c of [...b.chips, ...b.tracks]) {
    for (const m of solid) {
      if (overlaps(c.box, m.box)) out.push(`chip ${c.id} meets mark ${m.id}`);
      else if (c.room && overlaps(c.box, m.box, CHIP_ROOM))
        out.push(`chip ${c.id} is less than ${CHIP_ROOM}px from mark ${m.id}`);
    }
    for (const l of b.labels)
      if (overlaps(c.box, l.box)) out.push(`chip ${c.id} meets name of ${l.id}`);
  }

  const marks = scene.st.filter(isMark);
  const ends = trackEnds(scene);
  const hubIds = new Set(marks.filter((s) => s.t === "hub").map((h) => h.id));
  const at = new Map(marks.map((s) => [s.id, s]));
  for (const r of scene.tr) {
    const e = r.stub ? null : ends(r);
    if (!e) continue;
    const touches = (r.a && hubIds.has(r.a)) || (r.b && hubIds.has(r.b));
    if (!touches) {
      const pts = routeOf(r, e[0], e[1]);
      for (const h of b.hub)
        if (routeHits(pts, h.box)) out.push(`track ${r.id} passes under hub ${h.id}`);
    }
    const into = r.b ? at.get(r.b) : undefined;
    const from = r.a ? at.get(r.a) : undefined;
    if (into?.t === "hub" && from && from.t !== "hub" && from.x >= into.x)
      out.push(`track ${r.id} enters hub ${into.id} from the right`);
    if (from?.t === "hub" && into && into.t !== "hub" && into.x <= from.x)
      out.push(`track ${r.id} leaves hub ${from.id} to the left`);
  }

  // One step in a column: every gap between neighbours there is the same.
  for (const [x0, x1, name] of scene.zones ?? []) {
    const xs = [
      ...new Set(marks.filter((s) => s.t !== "exit" && s.x >= x0 && s.x < x1).map((s) => s.x)),
    ].sort((p, q) => p - q);
    const steps = new Set<number>();
    for (let i = 1; i < xs.length; i++)
      steps.add(Math.round(((xs[i] as number) - (xs[i - 1] as number)) * 100) / 100);
    if (steps.size > 1) out.push(`gaps in ${name} differ: ${[...steps].join(", ")}`);
  }
  return out;
}
