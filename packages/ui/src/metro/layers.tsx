/**
 * Layers (experiment, 2026-11-06; designs/2026-11-06-orrery-business-look.md): the map in 2.5D,
 * as the artifact's "Layers (3D)". The floor is one level with its folds shut: each fold a stacked
 * stop. Each fold's inside floats on a plate over its stop, on one dashed drop line. "Together"
 * lands the plates onto their stops: the fold, as a move. By line, each line is a plate over its
 * own place. A plate opens as the main flat view, or becomes the floor.
 * CSS 3D over `MetroSvg`: no new renderer, text stays vector. Camera springs: `motion`.
 */
import { allOpen, type FoldNode, pathTo } from "@wrenautomation/orrery";
import { animate } from "motion";
import { useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type MouseEvent,
  memo,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Seg } from "../controls.js";
import { cx } from "../format.js";
import { Icon } from "../icons.js";
import { MetroSvg } from "./draw.js";
import { type FocusSpec, focusScene } from "./focus.js";
import type { MetroZoom } from "./fold.js";
import { labelBoxes, markerBox } from "./geometry.js";
import { layerShapes, saveGhost } from "./ghost.js";
import { MetroSkeleton } from "./skeleton.js";
import {
  isCapsule,
  isMark,
  type MetroScene,
  type MetroTrack,
  type Point,
  type SceneStation,
} from "./types.js";

/** A part of the map: a fold node, or one line. */
export type LayerPart = { kind: "node" | "line"; id: string };
/** What the floor shows: the whole map, or one part and what it holds. */
export type LayerFloor = LayerPart | null;
/** How a level comes apart: one plate per fold, or one per line. */
export type LayerSplit = "folds" | "lines";

/** A box on the floor: left, top, width, height (px from the floor's corner). */
type Box = { left: number; top: number; width: number; height: number };

interface Plate {
  part: LayerPart;
  label: string;
  /** What it shows: a cut of the level. */
  scene: MetroScene;
  /** Where it sits over the floor. */
  box: Box;
  /** Where its drop line stands on the floor: a fold's stop, a line's centre. */
  at: readonly [number, number];
  /** How high it floats when apart (px). */
  z: number;
  /** It holds parts of its own: it can be the floor. */
  deep: boolean;
  /** The lift/shut toggle on the floor: centre, size, and whether it draws its own stacked glyph. */
  knob: Knob;
}

/** On the floor, in floor px. `glyph`: the floor has no stop here (a line), so the knob draws one. */
type Knob = { x: number; y: number; d: number; glyph: boolean };

interface Level {
  floor: MetroScene;
  plates: Plate[];
  split: LayerSplit;
  /** The splits that give plates here. */
  can: Record<LayerSplit, boolean>;
  lines: { id: string; n: string }[];
  /** Floor tracks into a fold, by the plates they join: to its stop when apart or shut, to the
   * station itself when landed. */
  joins: Join[];
}

interface Join {
  parts: string[];
  apart: MetroTrack[];
  landed: MetroTrack[];
}

/** Room round a plate's stations, so names show. */
const PAD = { top: 62, bottom: 48, side: 64 };
/** Room past a name's box to the plate edge. */
const LABEL_GAP = 16;
/** The artifact's lift; a plate whose footprint overlaps one in front of it rises a step more. */
const LIFT = { base: 120, step: 60, most: 360 } as const;

const grpOf = (s: SceneStation): string | undefined =>
  "grp" in s && typeof s.grp === "string" ? s.grp : undefined;
const lineOf = (s: SceneStation): string | undefined =>
  isMark(s) ? s.ln : "l" in s && typeof s.l === "string" ? s.l : undefined;
const centreOf = (s: SceneStation): readonly [number, number] => [
  isCapsule(s) ? (s.x ?? (s.cap[0] + s.cap[1]) / 2) : (s.x ?? 0),
  s.y,
];
/** The middle of a scene's stations. */
function midOf(scene: MetroScene): readonly [number, number] {
  const pts = scene.st.map(centreOf);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
type Quad = readonly (readonly [number, number])[];
/** Floor px → screen at the Apart turn, flat projection: enough to judge overlap. */
const turn = (x: number, y: number, z: number): readonly [number, number] => {
  const [cz, sz] = [Math.cos(APART.rz * RAD), Math.sin(APART.rz * RAD)];
  const [cx, sx] = [Math.cos(APART.rx * RAD), Math.sin(APART.rx * RAD)];
  return [x * cz - y * sz, (x * sz + y * cz) * cx - z * sx];
};
const RAD = Math.PI / 180;
/** Nearer the eye = lower on screen at the Apart turn. */
const depthOf = (p: { at: readonly [number, number] }) => turn(p.at[0], p.at[1], 0)[1];
/** TAG: the name pill under a plate, in floor px. */
const TAG = 34;
type See = (x: number, y: number, z: number) => readonly [number, number];
/** A plate's footprint with its tag, on screen. */
const footOf = (b: Box, z: number, see: See): Quad =>
  corners(b.left, b.top, b.width, b.height + TAG).map(([x, y]) => see(x, y, z));
/**
 * The tag strip alone, plus CLEAR: it must stay clear, or it reads as the front plate's name.
 * CLEAR covers the gap between this k-1 model and the fitted camera (~15 px, Upsells anchor).
 */
const CLEAR = 32;
const tagOf = (b: Box, z: number, see: See): Quad =>
  corners(b.left, b.top + b.height, b.width, TAG + CLEAR).map(([x, y]) => see(x, y, z));
/** `a` (in front) covers over `most` of `b`: 13 × 13 points inside `b`. */
function hides(a: Quad, b: Quad, most = 0.08) {
  // a grid inside b itself (bilinear): a bbox grid leaves a thin tilted tag nearly unsampled
  const [p0, p1, p2, p3] = b as [Quad[0], Quad[0], Quad[0], Quad[0]];
  let hit = 0;
  for (let i = 0; i <= 12; i++)
    for (let j = 0; j <= 12; j++) {
      const [u, v] = [i / 12, j / 12];
      const at = (k: 0 | 1) =>
        (1 - v) * ((1 - u) * p0[k] + u * p1[k]) + v * ((1 - u) * p3[k] + u * p2[k]);
      const pt = [at(0), at(1)] as const;
      if (inQuad(pt, a)) hit++;
    }
  return hit / 169 > most;
}

/**
 * A plate: a focused scene cut to its stations, no stubs (the floor's rail shows where it joins),
 * no outline of its own fold.
 */
function band(scene: MetroScene): MetroScene {
  const pts = scene.st.map(centreOf);
  if (!pts.length) return scene;
  const ys = pts.map((p) => p[1]);
  const half = (s: SceneStation) => (isCapsule(s) ? (s.cap[1] - s.cap[0]) / 2 : 0);
  // names and subs under or beside a stop stay on the plate, clear of its tag
  const names = scene.st.flatMap((s) => (isMark(s) ? labelBoxes(s) : []));
  const x0 = Math.max(
    0,
    Math.min(
      ...scene.st.map((s) => centreOf(s)[0] - half(s) - PAD.side),
      ...names.map((b) => b.x0 - LABEL_GAP),
    ),
  );
  const x1 = Math.max(
    ...scene.st.map((s) => centreOf(s)[0] + half(s) + PAD.side),
    ...names.map((b) => b.x1 + LABEL_GAP),
  );
  const y0 = Math.max(
    0,
    Math.min(...ys.map((y) => y - PAD.top), ...names.map((b) => b.y0 - LABEL_GAP)),
  );
  const y1 = Math.max(...ys.map((y) => y + PAD.bottom), ...names.map((b) => b.y1 + LABEL_GAP));
  return {
    ...scene,
    x0,
    w: x1 - x0,
    y0,
    h: y1 - y0,
    tr: scene.tr.filter((r) => !r.stub),
    opened: [],
    still: true,
    click: false,
  };
}

const only = (ids: Iterable<string>): FocusSpec =>
  [...ids].map((id) => ({ kind: "station" as const, id }));

/** The fold node a station sits under, at the first of `kids` up its chain. */
function underOf(zoom: MetroZoom, kids: ReadonlySet<string>) {
  const parent = new Map(zoom.nodes.map((n) => [n.id, n.parent]));
  const lineNode = (ln: string) => zoom.nodes.find((n) => n.id.startsWith(`${ln}@`))?.id;
  const up = (id: string | undefined) => {
    for (let k = id; k; k = parent.get(k)) if (kids.has(k)) return k;
    return undefined;
  };
  return (s: SceneStation) => {
    const ln = lineOf(s);
    return up(grpOf(s)) ?? up("g" in s ? s.g : undefined) ?? (ln ? up(lineNode(ln)) : undefined);
  };
}

/** What the flat map focuses to open a part: a line as is, a node as its stations, all open. */
export async function partFocus(zoom: MetroZoom, part: LayerPart): Promise<FocusSpec> {
  if (part.kind === "line") return { kind: "line", id: part.id };
  const scene = await zoom.scene(allOpen(zoom.nodes));
  const under = underOf(zoom, new Set([part.id]));
  const ids = scene.st.filter((s) => under(s)).map((s) => s.id);
  return ids.length ? only(ids) : { kind: "station", id: part.id };
}

/**
 * The open layout with each fold shut in place, as the artifact's floor: its stations go, one
 * stacked stop stands at their middle, and the rail runs on through it. Nothing else moves, so a
 * plate's place on the floor is its own.
 */
function shutFloor(
  all: MetroScene,
  frame: MetroScene,
  byFold: ReadonlyMap<string, readonly string[]>,
  stops: ReadonlyMap<string, SceneStation>,
  mids: ReadonlyMap<string, readonly [number, number]>,
): { floor: MetroScene; joins: Join[] } {
  const hidden = new Map<string, string>();
  for (const [k, ids] of byFold) for (const id of ids) hidden.set(id, k);
  const lineOfFold = new Map([...stops].map(([k, s]) => [k, lineOf(s)]));
  const stations: SceneStation[] = [...byFold.keys()].flatMap((k): SceneStation[] => {
    const stop = stops.get(k);
    const [x, y] = mids.get(k) ?? [0, 0];
    if (!stop) return [];
    if (isCapsule(stop)) return [{ ...stop, x, cap: [x, x], y }];
    return [{ ...stop, x, y }];
  });
  const byId = new Map(all.st.map((s) => [s.id, s]));
  const joins = new Map<string, Join>();
  const seen = new Set<string>();
  const tr = all.tr.flatMap((r) => {
    const ka = r.a ? hidden.get(r.a) : undefined;
    const kb = r.b ? hidden.get(r.b) : undefined;
    if (!ka && !kb) return [r];
    // Inside a fold, only its own rail stays, bare: the stop sits on it.
    if (ka && ka === kb) {
      if (r.k || r.l !== lineOfFold.get(ka)) return [];
      const { who, late, dot, cond, condGlyph, cat, lab, mv, dots, task, ...bare } = r;
      void [who, late, dot, cond, condGlyph, cat, lab, mv, dots, task];
      return [bare];
    }
    // Across a fold's edge (lead into core offer): off the floor, into its join.
    const key = [ka, kb].filter(Boolean).sort().join("|");
    const join = joins.get(key) ?? {
      parts: [...new Set([ka, kb])].flatMap((k) => (k ? [`node:${k}`] : [])),
      apart: [],
      landed: [],
    };
    joins.set(key, join);
    const at = (id: string | undefined, o: number | undefined): Point | undefined => {
      const s = id ? byId.get(id) : undefined;
      return s ? [s.x ?? 0, s.y + (o ?? r.o ?? 0)] : undefined;
    };
    const pa = r.pa ?? at(r.a, r.oa);
    const pc = r.pc ?? at(r.b, r.ob);
    if (pa && pc) join.landed.push({ ...r, pa, pc });
    // apart: the flat map's shut route, a bare track to the stacked stop
    const stopAt = (k: string) => mids.get(k) as Point | undefined;
    const sa = ka ? stopAt(ka) : at(r.a, 0);
    const sc = kb ? stopAt(kb) : at(r.b, 0);
    const near = `${ka ?? r.a}>${kb ?? r.b}`;
    if (sa && sc && ka !== kb && !seen.has(near)) {
      seen.add(near);
      join.apart.push({ ...(r.l ? { l: r.l } : {}), ...(r.w ? { w: r.w } : {}), pa: sa, pc: sc });
    }
    return [];
  });
  const inBox = (x: number, y: number, k: string) => {
    const o = all.opened?.find((p) => p.grp === k);
    if (!o) return false;
    const [l, t, rr, b] = o.box ?? [o.cap[0], o.y - 30, o.cap[1], o.y + 30];
    return x >= l && x <= rr && y >= t && y <= b;
  };
  const folded = (x: number, y: number) => [...byFold.keys()].some((k) => inBox(x, y, k));
  const floor: MetroScene = {
    ...all,
    ...(frame.x0 === undefined ? {} : { x0: frame.x0 }),
    ...(frame.w === undefined ? {} : { w: frame.w }),
    ...(frame.y0 === undefined ? {} : { y0: frame.y0 }),
    h: frame.h,
    st: [...all.st.filter((s) => !hidden.has(s.id)), ...stations],
    tr,
    chips: (all.chips ?? []).filter((c) => !folded(c.x, c.y)),
    frames: (all.frames ?? []).filter((f) => !folded(f.x + f.w / 2, f.y + f.h / 2)),
    folds: (all.folds ?? []).filter((f) => !byFold.has(f.grp)),
    opened: (all.opened ?? []).filter((o) => !byFold.has(o.grp)),
  };
  return { floor, joins: [...joins.values()] };
}

/**
 * One level, apart. The floor is the level as it stands, its folds shut as stacked stops. By fold:
 * `all` opens every fold at once, and each plate is a cut of it, hung over its fold's stop. By line:
 * each plate is that line's cut of the floor, over its own place.
 */
async function levelOf(zoom: MetroZoom, at: LayerFloor, want: LayerSplit): Promise<Level> {
  let open = new Set<string>();
  // Stations outside a node floor: what shows with the node shut.
  let outside: Set<string> | null = null;
  if (at?.kind === "node") {
    const shut = new Set(pathTo(zoom.nodes, at.id).map((n) => n.id));
    shut.delete(at.id);
    open = new Set([...shut, at.id]);
    outside = new Set((await zoom.scene(shut)).st.map((s) => s.id));
  } else if (at?.kind === "line") {
    const n = zoom.nodes.find((p) => p.id.startsWith(`${at.id}@`))?.id;
    if (n) open = new Set(pathTo(zoom.nodes, n).map((p) => p.id));
  }
  const mine = (s: SceneStation) =>
    outside ? !outside.has(s.id) : at?.kind === "line" ? lineOf(s) === at.id : true;
  const flat = await zoom.scene(open);
  const ours = flat.st.filter(mine);
  // The shut folds here: each a stacked stop, each a plate.
  const stops = new Map<string, SceneStation>();
  for (const s of ours) {
    const k = grpOf(s);
    if (k && !flat.st.some((m) => isMark(m) && m.g === k)) stops.set(k, s);
  }
  const kids = [...stops.keys()];
  // One layout opens every fold at once: each plate is a cut of it.
  const all = kids.length ? await zoom.scene(new Set([...open, ...kids])) : flat;
  const under = underOf(zoom, new Set(kids));
  const byFold = new Map<string, string[]>();
  const foldOf = new Map<string, string>();
  for (const s of all.st) {
    const k = stops.has(s.id) ? undefined : under(s);
    if (k) foldOf.set(s.id, k);
  }
  // An exit follows its source: it is in the fold when every track into it starts there.
  for (const s of all.st) {
    if (foldOf.has(s.id) || !isMark(s) || s.t !== "exit") continue;
    const from = all.tr.filter((r) => r.b === s.id && r.a).map((r) => foldOf.get(r.a ?? ""));
    const k = from[0];
    if (k && from.every((f) => f === k)) foldOf.set(s.id, k);
  }
  for (const [id, k] of foldOf) byFold.set(k, [...(byFold.get(k) ?? []), id]);
  // By line: each line's own stops; the hub stays on the floor.
  const byLine = new Map<string, string[]>();
  for (const s of ours) {
    const ln = isMark(s) && s.t === "hub" ? undefined : lineOf(s);
    if (ln) byLine.set(ln, [...(byLine.get(ln) ?? []), s.id]);
  }
  for (const [ln, ids] of byLine) if (ids.length < 2) byLine.delete(ln);
  const can = { folds: byFold.size > 0, lines: at?.kind !== "line" && byLine.size > 1 };
  const split: LayerSplit = can[want] ? want : can.folds ? "folds" : "lines";

  // The floor's frame: the open layout; a part floor keeps only what is inside it.
  const inside = new Set(all.st.filter(mine).map((s) => s.id));
  const frame = at ? band(focusScene(all, only(inside))) : all;
  const fx = frame.x0 ?? 0;
  const fy = frame.y0 ?? 0;
  const lineNode = (id: string) => zoom.nodes.find((n) => n.id.startsWith(`${id}@`))?.id;
  const place = (scene: MetroScene): Box => ({
    left: (scene.x0 ?? 0) - fx,
    top: (scene.y0 ?? 0) - fy,
    width: scene.w ?? 0,
    height: scene.h,
  });
  let cut: Omit<Plate, "z">[] = [];
  let floor: MetroScene = { ...frame, still: true, click: false };
  let joins: Join[] = [];
  if (split === "folds" && can.folds) {
    const mids = new Map<string, readonly [number, number]>();
    cut = [...byFold].flatMap(([id, ids]) => {
      const scene = band(focusScene(all, only(ids)));
      const mid = midOf(scene);
      mids.set(id, mid);
      const stop = stops.get(id);
      // over the floor's stacked stop: its circle plus the stack offset
      const mb = stop && isMark(stop) ? markerBox({ ...stop, x: mid[0], y: mid[1] }) : null;
      const knob: Knob = {
        x: mid[0] - fx + 2.5,
        y: (mb?.cy ?? mid[1]) - fy - 2.5,
        d: Math.max(mb?.w ?? 28, mb?.h ?? 28) + 18,
        glyph: false,
      };
      return [
        {
          part: { kind: "node" as const, id },
          label: zoom.nodes.find((n) => n.id === id)?.label ?? id,
          scene,
          box: place(scene),
          at: [mid[0] - fx, mid[1] - fy] as const,
          deep: zoom.nodes.some((n) => n.parent === id),
          knob,
        },
      ];
    });
    const shut = shutFloor(all, frame, byFold, stops, mids);
    floor = { ...shut.floor, still: true, click: false };
    joins = shut.joins;
  } else if (split === "lines" && can.lines) {
    cut = [...byLine].map(([id, ids]) => {
      const scene = band(focusScene(flat, only(ids)));
      const box = place(scene);
      return {
        part: { kind: "line" as const, id },
        label: flat.lines?.[id]?.n ?? id,
        scene,
        box,
        at: [box.left + box.width / 2, box.top + box.height / 2] as const,
        deep: zoom.nodes.some((n) => n.parent === lineNode(id)),
        knob: { x: box.left + box.width / 2, y: box.top + box.height / 2, d: 40, glyph: true },
      };
    });
    // Lifted off the floor: the rest stays in the same frame.
    const lifted = new Set([...byLine.values()].flat());
    const rest = ours.filter((s) => !lifted.has(s.id)).map((s) => s.id);
    const shut = at ? band(focusScene(flat, only(ours.map((s) => s.id)))) : flat;
    floor = {
      ...(rest.length ? focusScene(flat, only(rest)) : { ...flat, st: [], tr: [] }),
      ...(shut.x0 === undefined ? {} : { x0: shut.x0 }),
      ...(shut.w === undefined ? {} : { w: shut.w }),
      ...(shut.y0 === undefined ? {} : { y0: shut.y0 }),
      h: shut.h,
      still: true,
      click: false,
    };
  }
  // The floor reaches under every plate.
  const right = Math.max(floor.w ?? 0, ...cut.map((p) => p.box.left + p.box.width + 16));
  const bottom = Math.max(floor.h, ...cut.map((p) => p.box.top + p.box.height + 16));
  floor = { ...floor, w: right, h: bottom };
  // Front to back at the Apart pose. A plate rises in half steps till no plate in front hides
  // more than a little of it, or any of its tag (spec S6 rule 5): back plates step up like a stair.
  const front = [...cut].sort((a, b) => depthOf(b) - depthOf(a));
  // through the view's perspective (k 1, centred): a lifted plate grows toward the eye, so a
  // flat projection puts its tag too high (Upsells, anchor play)
  const [fw, fh] = [floor.w ?? 960, floor.h];
  const see: See = (x, y, z) => toView({ ...APART, k: 1, x: 0, y: 0 }, fw, fh, [fw, fh], x, y, z);
  const placed: { q: Quad; z: number }[] = [];
  const plates = front.map((p) => {
    let z = LIFT.base;
    const hid = (z: number) =>
      placed.some((o) => hides(o.q, footOf(p.box, z, see)) || hides(o.q, tagOf(p.box, z, see), 0));
    while (z < LIFT.base + LIFT.most && hid(z)) z += LIFT.step / 2;
    placed.push({ q: footOf(p.box, z, see), z });
    return { ...p, z };
  });
  const lines = Object.entries(all.lines ?? {})
    .filter(([id]) => all.st.some((s) => lineOf(s) === id))
    .map(([id, l]) => ({ id, n: l.n }));
  return { floor, plates, split, can, lines, joins };
}

/** Perspective on `.mlay-view` (px) and its origin's height (share of the box). */
const PERSPECTIVE = 2200;
const EYE_Y = 0.3;
/** Room kept clear at the foot of the view for the hint and the plates' names (px). */
const FOOT = 36;
/** Room over the top plate: its acts (26 + 10 astride) and the hover pull. */
const HEAD = 44;

/** Where the camera is: the turn, how far apart (0 landed, 1 apart), and the scale and shift. */
interface Cam {
  rx: number;
  rz: number;
  e: number;
  k: number;
  x: number;
  y: number;
}
type Pose = Pick<Cam, "rx" | "rz" | "e">;

const FLAT: Pose = { rx: 0, rz: 0, e: 0 };
/** Apart: the artifact's pose. */
const APART: Pose = { rx: 56, rz: -32, e: 1 };
/** Tilt below this lands the plates; the lift follows the tilt up to `TILT_APART`. */
const SNAP_FLAT = 16;
const TILT_APART = 32;
const apartAt = (rx: number) => Math.min(1, Math.max(0, (rx - 4) / (TILT_APART - 4)));

/** A box on the floor (left, top, width, height, px) and how high it floats at full apart. */
type Rect = readonly [number, number, number, number, number];

/**
 * Scale and shift so `rects` fill the box at `pose`: corners projected as the browser does
 * (rotateZ, rotateX, scale, then the parent's perspective). Three passes: perspective is not linear.
 */
/**
 * A floor point (px from its corner; `up` px over it) to view px, as CSS draws it: the stage's
 * `translate scale3d rotateX rotateZ` under the view's perspective. Fit and hover share it.
 */
function toView(
  c: Pick<Cam, "rx" | "rz" | "k" | "x" | "y">,
  w: number,
  h: number,
  [bw, bh]: readonly [number, number],
  px: number,
  py: number,
  up: number,
): readonly [number, number] {
  const [cz, sz] = [Math.cos((c.rz * Math.PI) / 180), Math.sin((c.rz * Math.PI) / 180)];
  const [cx, sx] = [Math.cos((c.rx * Math.PI) / 180), Math.sin((c.rx * Math.PI) / 180)];
  const [x0, y0] = [px - w / 2, py - h / 2];
  const [x1, y1] = [x0 * cz - y0 * sz, x0 * sz + y0 * cz];
  const [X, Y, Z] = [c.k * x1, c.k * (y1 * cx - up * sx), c.k * (y1 * sx + up * cx)];
  const at = PERSPECTIVE / (PERSPECTIVE - Z);
  const eye = [bw / 2, bh * EYE_Y] as const;
  return [eye[0] + (bw / 2 + c.x + X - eye[0]) * at, eye[1] + (bh / 2 + c.y + Y - eye[1]) * at];
}

const corners = (l: number, t: number, pw: number, ph: number) =>
  [
    [l, t],
    [l + pw, t],
    [l + pw, t + ph],
    [l, t + ph],
  ] as const;

/** In a convex quad (any winding). */
function inQuad([x, y]: readonly [number, number], q: readonly (readonly [number, number])[]) {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const [ax, ay] = q[i] ?? [0, 0];
    const [bx, by] = q[(i + 1) % q.length] ?? [0, 0];
    const s = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (s && sign && s !== sign) return false;
    sign ||= s;
  }
  return true;
}

function fitOf(
  w: number,
  h: number,
  rects: readonly Rect[],
  pose: Pose,
  [bw, bh]: readonly [number, number],
  fill = 0.94,
): Pick<Cam, "k" | "x" | "y"> {
  if (!bw || !bh) return { k: 0.6, x: 0, y: 0 };
  const boxAt = (k: number, dx: number, dy: number) => {
    const flat = rects.flatMap(([l, t, pw, ph, up]) =>
      corners(l, t, pw, ph).map(([px, py]) =>
        toView({ ...pose, k, x: dx, y: dy }, w, h, [bw, bh], px, py, up * pose.e),
      ),
    );
    const xs = flat.map((p) => p[0]);
    const ys = flat.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  let k = 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const b = boxAt(k, x, y);
    k *= Math.min((bw * fill) / (b.x1 - b.x0), ((bh - FOOT - HEAD) * fill) / (b.y1 - b.y0));
    k = Math.min(2.5, Math.max(0.2, k));
    const c = boxAt(k, x, y);
    x += bw / 2 - (c.x0 + c.x1) / 2;
    y += HEAD + (bh - FOOT - HEAD) / 2 - (c.y0 + c.y1) / 2;
  }
  return { k, x, y };
}

/** The node path to the floor, for the crumbs. */
const crumbsOf = (nodes: readonly FoldNode[], at: LayerFloor) =>
  at?.kind === "node" ? pathTo(nodes, at.id) : [];

export interface MetroLayersProps {
  zoom: MetroZoom;
  floor: LayerFloor;
  onFloor: (floor: LayerFloor) => void;
  /** Open a part as the main flat view. No button without it. */
  onOpen?: ((part: LayerPart, label: string) => void) | undefined;
  split?: LayerSplit | undefined;
  onSplit?: ((split: LayerSplit) => void) | undefined;
  /** Plates shut on their stop, as `kind:id`. */
  shut?: readonly string[] | undefined;
  /** No Shut or Lift without it. */
  onShut?: ((shut: string[]) => void) | undefined;
  /** The page's key: its skeleton draws this view's last first fit (`ghost.ts`). */
  ghost?: string | undefined;
  className?: string | undefined;
}

const partKey = (p: LayerPart) => `${p.kind}:${p.id}`;

/** A plate in hand rises this far (px): `.mlay-slot.hot { --pull }`. */
const PULL = 40;
/** A plate falls onto its knob, or rises off it (ms). Matches `.mlay-plate`'s transition. */
const SHUT_MS = 280;
/** Out of hand only after this long outside: a pass over a gap or an edge keeps it. */
const LEAVE_MS = 100;

/** The floor and its plates: drawn once per level. Moving the camera never draws them again. */
const Stage = memo(function Stage({
  level,
  root,
  onPlate,
  open,
  shut,
  onShut,
  still,
  release,
}: {
  level: Level;
  root: RefObject<HTMLDivElement | null>;
  /** Drops the plate in hand. */
  release: () => void;
  onPlate: (p: Plate, how: "open" | "stack") => void;
  open: boolean;
  shut: ReadonlySet<string>;
  onShut: ((key: string) => void) | null;
  still: boolean;
}) {
  const slotOf = (key: string) =>
    root.current?.querySelector(`.mlay-slot[data-part="${CSS.escape(key)}"]`) ?? null;
  // Shut: fall onto the knob, then shut.
  const fall = (key: string) => {
    const el = slotOf(key);
    release();
    if (still || !el) return onShut?.(key);
    el.classList.add("closing");
    window.setTimeout(() => onShut?.(key), SHUT_MS);
  };
  // Lift: a slot that leaves `shut` starts on its knob and rises.
  const was = useRef(shut);
  useLayoutEffect(() => {
    const up = [...was.current].filter((k) => !shut.has(k));
    was.current = shut;
    for (const k of shut) slotOf(k)?.classList.remove("closing");
    if (still) return;
    for (const k of up) {
      const el = slotOf(k);
      if (!el) continue;
      el.classList.add("closing");
      el.getBoundingClientRect();
      requestAnimationFrame(() => el.classList.remove("closing"));
    }
  });
  return (
    <>
      <div className="mlay-floor">
        {/* under the floor's stops: each join to its stop (apart, or its plate shut), or into the
            station itself (landed) */}
        {level.joins.map((j) => {
          const sh = j.parts.some((k) => shut.has(k));
          const bare = { ...level.floor, st: [], chips: [], frames: [], folds: [], opened: [] };
          return [
            <div key={`${j.parts}-a`} className={cx("mlay-join", sh ? "on" : "apart")}>
              <MetroSvg scene={{ ...bare, tr: j.apart }} still bare />
            </div>,
            sh ? null : (
              <div key={`${j.parts}-l`} className="mlay-join landed">
                <MetroSvg scene={{ ...bare, tr: j.landed }} still bare />
              </div>
            ),
          ];
        })}
        <MetroSvg scene={level.floor} still bare />
      </div>
      {level.plates.map((p) => {
        const key = partKey(p.part);
        const down = shut.has(key);
        const k = p.knob;
        return (
          <div
            key={key}
            className={cx("mlay-slot", down && "shut")}
            data-part={key}
            style={{ "--zn": p.z } as CSSProperties}
          >
            {/* the floor's stacked stop: lifts or shuts its plate */}
            {onShut ? (
              <button
                type="button"
                className={cx("mlay-knob", k.glyph && "glyph")}
                style={{ left: k.x - k.d / 2, top: k.y - k.d / 2, width: k.d, height: k.d }}
                aria-expanded={!down}
                aria-label={down ? `Lift ${p.label}` : `Fold ${p.label}`}
                title={down ? `Lift ${p.label}` : `Fold ${p.label}`}
                onClick={() => (down ? onShut(key) : fall(key))}
              >
                {k.glyph ? <Icon name="stack" size={16} /> : null}
              </button>
            ) : null}
            {/* One dashed line from its stop up to the plate. */}
            <i className="mlay-drop" style={{ left: p.at[0], top: p.at[1] }} aria-hidden="true" />
            <div
              className="mlay-plate"
              style={
                {
                  ...p.box,
                  "--ox": `${k.x - p.box.left}px`,
                  "--oy": `${k.y - p.box.top}px`,
                } as CSSProperties
              }
              inert={down || undefined}
            >
              {/* No pointer hits here but the acts: hover and click come from the camera math. */}
              <div className="mlay-face">
                <button
                  type="button"
                  className="mlay-open"
                  aria-label={open ? `Open ${p.label}` : `${p.label}: stack it here`}
                  onClick={() => onPlate(p, open ? "open" : "stack")}
                >
                  <MetroSvg scene={p.scene} still bare />
                </button>
                <div className="mlay-acts">
                  {open && p.deep ? (
                    <button
                      type="button"
                      className="mlay-act"
                      aria-label={`${p.label}: stack it here`}
                      title="Stack here"
                      onClick={() => onPlate(p, "stack")}
                    >
                      <Icon name="stack" size={14} />
                    </button>
                  ) : null}
                  {onShut ? (
                    <button
                      type="button"
                      className="mlay-act"
                      aria-label={`Shut ${p.label}`}
                      title="Shut onto its stop"
                      onClick={() => fall(key)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  ) : null}
                </div>
                <div className="mlay-tag">{p.label}</div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
});

/** A pointer that moves less than this is a click. */
const CLICK = 4;

export function MetroLayers({
  zoom,
  floor,
  onFloor,
  onOpen,
  split = "folds",
  onSplit,
  shut: shutList,
  onShut,
  ghost,
  className,
}: MetroLayersProps) {
  const shutKey = (shutList ?? []).join(",");
  const shut = useMemo(() => new Set(shutKey ? shutKey.split(",") : []), [shutKey]);
  const [level, setLevel] = useState<Level | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [box, setBox] = useState<[number, number]>([0, 0]);
  // The view switch: set when a move ends, never per frame.
  const [apart, setApart] = useState(true);
  const still = useReducedMotion() ?? false;
  const viewEl = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const cam = useRef<Cam>({ ...APART, k: 0.6, x: 0, y: 0 });
  const run = useRef<{ stop: () => void } | null>(null);
  // The pose last asked for: a resize mid-flight keeps to it.
  const flat = useRef(false);
  const frame = useRef(0);
  // Set by a drag, so the click after it does not open a plate.
  const dragged = useRef(false);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const grab = useRef<{ x: number; y: number; cam: Cam; pan: boolean; d?: number } | null>(null);
  // The plate in hand: a class on its slot, set straight on the DOM (no render per hover).
  const hand = useRef<{ key: string | null; t: number }>({ key: null, t: 0 });
  const setHand = useCallback((key: string | null) => {
    const h = hand.current;
    window.clearTimeout(h.t);
    h.t = 0;
    if (h.key === key) return;
    const at = (k: string) =>
      stage.current?.querySelector(`.mlay-slot[data-part="${CSS.escape(k)}"]`);
    if (h.key) at(h.key)?.classList.remove("hot");
    if (key) at(key)?.classList.add("hot");
    h.key = key;
  }, []);
  const release = useCallback(() => setHand(null), [setHand]);
  const live = useRef({ onFloor, onOpen, onShut, shut });
  live.current = { onFloor, onOpen, onShut, shut };
  // One handler for the life of the stage, so a shut never draws the floor again.
  const toggle = useCallback((key: string) => {
    const { onShut: on, shut: now } = live.current;
    on?.(now.has(key) ? [...now].filter((k) => k !== key) : [...now, key]);
  }, []);

  const key = `${floor?.kind ?? ""}:${floor?.id ?? ""}:${split}`;
  // read-ok: a local layout (ELK in a worker), no fetch; cached in the zoom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the floor and split.
  useEffect(() => {
    let on = true;
    setFailed(null);
    levelOf(zoom, floor, split).then(
      (l) => on && setLevel(l),
      (e: unknown) => on && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      on = false;
    };
  }, [zoom, key]);

  const f = level?.floor;
  const w = f?.w ?? 960;
  const h = f?.h ?? 400;

  // The camera goes straight to the stage's style, once a frame: no React render while it moves.
  const place = useCallback(() => {
    frame.current = 0;
    const el = stage.current;
    if (!el) return;
    const c = cam.current;
    el.style.transform = `translate(${c.x}px, ${c.y}px) scale3d(${c.k}, ${c.k}, ${c.k}) rotateX(${c.rx}deg) rotateZ(${c.rz}deg)`;
    el.style.setProperty("--e", String(c.e));
    el.style.setProperty("--k", String(c.k));
    el.classList.toggle("landed", c.e < 0.02);
  }, []);
  const soon = useCallback(() => {
    frame.current ||= requestAnimationFrame(place);
  }, [place]);

  /** Every box at full apart: the floor and each plate. */
  const rects = useCallback(
    (): Rect[] => [
      [0, 0, w, h, 0],
      ...(level?.plates ?? []).map(
        ({ box: b, z, part }) =>
          // + the hover pull: a plate in hand still fits
          [b.left, b.top, b.width, b.height, shut.has(partKey(part)) ? 0 : z + PULL] as const,
      ),
    ],
    [w, h, level, shut],
  );

  /** Spring the camera to `to`; `done` runs when it lands. */
  const fly = useCallback(
    (to: Cam, done?: () => void) => {
      run.current?.stop();
      const from = { ...cam.current };
      stage.current?.classList.add("moving");
      const end = () => {
        stage.current?.classList.remove("moving");
        setApart(cam.current.e > 0.5);
        done?.();
      };
      if (still) {
        cam.current = to;
        place();
        end();
        return;
      }
      const lerp = (t: number): Cam => ({
        rx: from.rx + (to.rx - from.rx) * t,
        rz: from.rz + (to.rz - from.rz) * t,
        e: from.e + (to.e - from.e) * t,
        k: from.k * (to.k / from.k) ** t,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
      const a = animate(0, 1, {
        type: "spring",
        bounce: 0,
        visualDuration: 0.55,
        onUpdate: (t) => {
          cam.current = lerp(t);
          soon();
        },
      });
      // A stop (wheel, drag, unmount) ends the move too: else `.moving` stays and kills the hover.
      run.current = {
        stop: () => {
          a.stop();
          stage.current?.classList.remove("moving");
        },
      };
      const me = run.current;
      a.then(() => {
        if (run.current === me) end();
      });
    },
    [place, soon, still],
  );

  /** A pose, framed so every box shows. */
  const poseTo = useCallback(
    (p: Pose, done?: () => void) => {
      flat.current = p.e < 0.5;
      fly({ ...p, ...fitOf(w, h, rects(), p, box) }, done);
    },
    [fly, rects, w, h, box],
  );

  // What the skeleton draws next time: the fit a load lands on, once its flight ends; a hand on
  // the camera first keeps the last one.
  const touched = useRef(false);
  const keepGhost = () => {
    const key = ghost;
    if (!key || !level) return;
    const [bw, bh] = box;
    touched.current = false;
    window.setTimeout(() => {
      const c = cam.current;
      const at = viewEl.current?.getBoundingClientRect();
      if (touched.current || !at) return;
      const shapes = [
        layerShapes(
          level.floor,
          (x, y) => toView(c, w, h, box, x - (level.floor.x0 ?? 0), y - (level.floor.y0 ?? 0), 0),
          c.k,
        ),
        ...level.plates
          .filter((p) => !shut.has(partKey(p.part)))
          .map((p) =>
            layerShapes(
              p.scene,
              (x, y) =>
                toView(
                  c,
                  w,
                  h,
                  box,
                  p.box.left + x - (p.scene.x0 ?? 0),
                  p.box.top + y - (p.scene.y0 ?? 0),
                  p.z * c.e,
                ),
              c.k,
            ),
          ),
      ];
      saveGhost(key, {
        kind: "layers",
        bw,
        bh,
        top: Math.round(at.top),
        left: Math.round(at.left),
        vw: innerWidth,
        faces: shapes.map((s) => s.face),
        tr: shapes.flatMap((s) => s.tr),
        st: shapes.flatMap((s) => s.st),
        names: shapes.flatMap((s) => s.names),
      });
    }, 900);
  };

  // A new level or box: frame it at the pose last asked for (landed stays landed).
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new level mounts a new stage.
  useLayoutEffect(() => {
    if (!level || !box[0]) return;
    // Nothing lifts at this level: it lies flat.
    const p = flat.current || !level.plates.length ? FLAT : APART;
    if (first.current) {
      first.current = false;
      cam.current = { ...p, ...fitOf(w, h, rects(), p, box) };
      place();
      setApart(p.e > 0.5);
    } else poseTo(p);
    keepGhost();
  }, [level, box]);

  useEffect(() => () => run.current?.stop(), []);

  const view = useCallback((el: HTMLDivElement | null) => {
    viewEl.current = el;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Scale by `r` round a point of the view (px from its centre). */
  const zoomAt = useCallback(
    (r: number, px: number, py: number) => {
      const c = cam.current;
      const k = Math.min(4, Math.max(0.15, c.k * r));
      const q = k / c.k;
      cam.current = { ...c, k, x: px - (px - c.x) * q, y: py - (py - c.y) * q };
      soon();
    },
    [soon],
  );

  // Wheel: pinch (ctrl) or a mouse wheel zooms at the pointer; a trackpad scroll moves.
  useEffect(() => {
    const el = viewEl.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      touched.current = true;
      run.current?.stop();
      const r = el.getBoundingClientRect();
      const mouse = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50);
      if (e.ctrlKey || mouse) {
        const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        zoomAt(
          Math.exp(-step * (e.ctrlKey ? 0.01 : 0.0015)),
          e.clientX - r.left - r.width / 2,
          e.clientY - r.top - r.height / 2,
        );
      } else {
        const c = cam.current;
        cam.current = { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY };
        soon();
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt, soon]);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest(".mlay-act, .mlay-knob, .mlay-bar")) return;
    touched.current = true;
    run.current?.stop();
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged.current = false;
    const pan = e.shiftKey || e.button !== 0;
    grab.current = { x: e.clientX, y: e.clientY, cam: { ...cam.current }, pan };
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      if (a && b)
        grab.current = {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          cam: { ...cam.current },
          pan: true,
          d: Math.hypot(a.x - b.x, a.y - b.y),
        };
    }
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || !ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!dragged.current) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < CLICK && ptrs.current.size < 2) return;
      dragged.current = true;
      // Captured only once it drags, so a plain click still reaches the plate.
      e.currentTarget.setPointerCapture(e.pointerId);
      stage.current?.classList.add("moving");
    }
    const c = g.cam;
    if (g.d !== undefined) {
      const [a, b] = [...ptrs.current.values()];
      if (!a || !b) return;
      const r = viewEl.current?.getBoundingClientRect();
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      cam.current = { ...c, x: c.x + mx - g.x, y: c.y + my - g.y };
      if (r)
        zoomAt(
          Math.hypot(a.x - b.x, a.y - b.y) / g.d / (cam.current.k / c.k),
          mx - r.left - r.width / 2,
          my - r.top - r.height / 2,
        );
      return;
    }
    if (g.pan) {
      cam.current = { ...c, x: c.x + e.clientX - g.x, y: c.y + e.clientY - g.y };
    } else {
      // Turn; the plates come apart as it tilts, and land as it flattens.
      const rx = Math.max(0, Math.min(75, c.rx - (e.clientY - g.y) * 0.2));
      cam.current = { ...c, rx, rz: c.rz + (e.clientX - g.x) * 0.25, e: apartAt(rx) };
    }
    soon();
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId);
    const g = grab.current;
    if (ptrs.current.size) return;
    grab.current = null;
    stage.current?.classList.remove("moving");
    if (!g || !dragged.current || g.pan || g.d !== undefined) return;
    // Snap: near flat lands it; else apart, the turn to its rest when near.
    const c = cam.current;
    if (c.rx < SNAP_FLAT) return poseTo(FLAT);
    const rest = APART;
    const rz = Math.abs(c.rz - rest.rz) < 12 ? rest.rz : c.rz;
    flat.current = false;
    fly({ ...c, rz, e: 1, ...(c.e < 1 ? fitOf(w, h, rects(), { ...c, rz, e: 1 }, box) : {}) });
  };

  const pick = useCallback(
    (p: Plate, how: "open" | "stack") => {
      if (dragged.current) return;
      if (how === "stack" || !live.current.onOpen) return live.current.onFloor(p.part);
      // Fly down onto the plate, top-down, till it fills the view; then it opens flat.
      const top: Pose = { rx: 0, rz: 0, e: cam.current.e };
      const rect: Rect = [p.box.left, p.box.top, p.box.width, p.box.height, p.z];
      const el = stage.current;
      el?.classList.add("opening");
      el?.querySelector(`[data-part="${CSS.escape(partKey(p.part))}"]`)?.classList.add("chosen");
      fly({ ...top, ...fitOf(w, h, [rect], top, box, 0.98) }, () =>
        live.current.onOpen?.(p.part, p.label),
      );
    },
    [w, h, box, fly],
  );

  /**
   * Hover by the camera's math, not the DOM: Chrome's 3D hit test drops a still pointer while a
   * face lifts. In hand while the pointer is on its plate at rest, lifted, or between; out 100 ms
   * after it leaves them all. Another plate at rest takes hand at once; the higher one wins.
   */
  const hover = (e: PointerEvent<HTMLDivElement>) => {
    const v = viewEl.current?.getBoundingClientRect();
    const c = cam.current;
    const el = stage.current;
    const busy = dragged.current && grab.current;
    if (!level || !v || !el || busy || c.e < 0.02 || el.classList.contains("opening"))
      return setHand(null);
    const cur = hand.current.key;
    if (cur && (e.target as Element).closest(".mlay-acts")) return setHand(cur);
    const pt = [e.clientX - v.left, e.clientY - v.top] as const;
    const on = (p: Plate, lift: number) =>
      inQuad(
        pt,
        corners(p.box.left, p.box.top, p.box.width, p.box.height).map(([x, y]) =>
          toView(c, w, h, box, x, y, p.z * c.e + lift),
        ),
      );
    const up = level.plates.filter((p) => !shut.has(partKey(p.part)));
    const mine = up.find((p) => partKey(p.part) === cur);
    if (mine && (on(mine, 0) || on(mine, PULL / 2) || on(mine, PULL))) return setHand(cur);
    const next = up.filter((p) => on(p, 0)).sort((a, b) => b.z - a.z || b.at[1] - a.at[1])[0];
    if (next) return setHand(partKey(next.part));
    if (cur && !hand.current.t) hand.current.t = window.setTimeout(release, LEAVE_MS);
  };
  // A click on the view opens the plate in hand (keyboard: its own button).
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest(".mlay-act, .mlay-knob, .mlay-bar, .mlay-open")) return;
    const k = hand.current.key;
    const p = k ? level?.plates.find((q) => partKey(q.part) === k) : undefined;
    if (p) pick(p, onOpen ? "open" : "stack");
  };

  const crumbs = crumbsOf(zoom.nodes, floor);
  const lineName = floor?.kind === "line" ? level?.lines.find((l) => l.id === floor.id)?.n : null;

  return (
    <div className={cx("mlay", className)}>
      <div className="mlay-bar">
        <nav aria-label="Floor" className="mlay-crumbs">
          <Button tone="quiet" size="dense" aria-current={!floor} onClick={() => onFloor(null)}>
            Whole map
          </Button>
          {crumbs.map((n) => (
            <span key={n.id} className="mlay-crumb">
              <span aria-hidden="true">›</span>
              <Button
                tone="quiet"
                size="dense"
                aria-current={floor?.id === n.id}
                onClick={() => onFloor({ kind: "node", id: n.id })}
              >
                {n.label}
              </Button>
            </span>
          ))}
          {lineName ? (
            <span className="mlay-crumb">
              <span aria-hidden="true">›</span>
              <span className="mlay-here">{lineName}</span>
            </span>
          ) : null}
        </nav>
        <div className="mlay-ctl">
          {onSplit && level?.can.folds && level.can.lines ? (
            <Seg
              label="Split by"
              dense
              value={level.split}
              items={[
                { value: "folds", label: "Folds" },
                { value: "lines", label: "Lines" },
              ]}
              onChange={onSplit}
            />
          ) : null}
          <Seg
            label="View"
            dense
            value={apart ? "apart" : "flat"}
            items={[
              { value: "flat", label: "Together" },
              { value: "apart", label: "Apart" },
            ]}
            onChange={(v) => {
              touched.current = true;
              poseTo(v === "flat" ? FLAT : APART);
            }}
          />
          <Button
            tone="quiet"
            size="dense"
            onClick={() => {
              const c = cam.current;
              fly({ ...c, ...fitOf(w, h, rects(), c, box) });
            }}
          >
            Fit all
          </Button>
        </div>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the camera surface; each plate and knob is a button for keys */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keys open a plate by its own button */}
      <div
        ref={view}
        className="mlay-view"
        onPointerDown={(e) => {
          down(e);
          hover(e);
        }}
        onPointerMove={(e) => {
          move(e);
          hover(e);
        }}
        onPointerLeave={() => {
          if (hand.current.key && !hand.current.t)
            hand.current.t = window.setTimeout(release, LEAVE_MS);
        }}
        onClick={click}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {failed ? (
          <p className="mlay-fail">This floor could not be drawn: {failed}</p>
        ) : !f || !level ? (
          <MetroSkeleton label="Lifting the layers" ghost={ghost} />
        ) : (
          <div
            ref={stage}
            className="mlay-stage"
            style={{ width: w, height: f.h, marginLeft: -w / 2, marginTop: -f.h / 2 }}
          >
            <Stage
              level={level}
              root={stage}
              onPlate={pick}
              open={!!onOpen}
              shut={shut}
              onShut={onShut ? toggle : null}
              still={still}
              release={release}
            />
          </div>
        )}
        <p className="mlay-hint">
          {level && !level.plates.length
            ? "Nothing to split at this level."
            : "Drag to turn. Scroll to move, pinch to zoom. Point at a plate to raise it, click to open it."}
        </p>
      </div>
    </div>
  );
}
