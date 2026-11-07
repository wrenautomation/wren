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
  memo,
  type PointerEvent,
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
import { MetroSkeleton } from "./skeleton.js";
import { isCapsule, isMark, type MetroScene, type SceneStation } from "./types.js";

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
}

interface Level {
  floor: MetroScene;
  plates: Plate[];
  split: LayerSplit;
  /** The splits that give plates here. */
  can: Record<LayerSplit, boolean>;
  lines: { id: string; n: string }[];
}

/** Room round a plate's stations, so names show. */
const PAD = { top: 62, bottom: 48, side: 64 };
/** The artifact's lift; a plate whose footprint overlaps one in front of it rises a step more. */
const LIFT = { base: 120, step: 60 } as const;

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
/** The boxes share some x: one in front hides the other when both lie flat. */
const sameColumn = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width;

/**
 * A plate: a focused scene cut to its stations, no stubs (the floor's rail shows where it joins),
 * no outline of its own fold.
 */
function band(scene: MetroScene): MetroScene {
  const pts = scene.st.map(centreOf);
  if (!pts.length) return scene;
  const ys = pts.map((p) => p[1]);
  const half = (s: SceneStation) => (isCapsule(s) ? (s.cap[1] - s.cap[0]) / 2 : 0);
  const x0 = Math.max(0, Math.min(...scene.st.map((s) => centreOf(s)[0] - half(s))) - PAD.side);
  const x1 = Math.max(...scene.st.map((s) => centreOf(s)[0] + half(s))) + PAD.side;
  const y0 = Math.max(0, Math.min(...ys) - PAD.top);
  return {
    ...scene,
    x0,
    w: x1 - x0,
    y0,
    h: Math.max(...ys) + PAD.bottom - y0,
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
): MetroScene {
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
    return [r];
  });
  const inBox = (x: number, y: number, k: string) => {
    const o = all.opened?.find((p) => p.grp === k);
    if (!o) return false;
    const [l, t, rr, b] = o.box ?? [o.cap[0], o.y - 30, o.cap[1], o.y + 30];
    return x >= l && x <= rr && y >= t && y <= b;
  };
  const folded = (x: number, y: number) => [...byFold.keys()].some((k) => inBox(x, y, k));
  return {
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
  if (split === "folds" && can.folds) {
    const mids = new Map<string, readonly [number, number]>();
    cut = [...byFold].flatMap(([id, ids]) => {
      const scene = band(focusScene(all, only(ids)));
      const mid = midOf(scene);
      mids.set(id, mid);
      return [
        {
          part: { kind: "node" as const, id },
          label: zoom.nodes.find((n) => n.id === id)?.label ?? id,
          scene,
          box: place(scene),
          at: [mid[0] - fx, mid[1] - fy] as const,
          deep: zoom.nodes.some((n) => n.parent === id),
        },
      ];
    });
    floor = { ...shutFloor(all, frame, byFold, stops, mids), still: true, click: false };
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
  // Front to back. A raised plate hides what stands behind it in its column, so a plate rises one
  // step over the highest plate in front that shares its x range: back plates step up like a stair.
  const front = [...cut].sort((a, b) => b.at[1] - a.at[1]);
  const zs: number[] = [];
  const plates = front.map((p, i) => {
    const under = front
      .slice(0, i)
      .map((q, j) => (sameColumn(q.box, p.box) ? (zs[j] ?? LIFT.base) : 0));
    const z = Math.max(LIFT.base, ...under.map((u) => (u ? u + LIFT.step : 0)));
    zs.push(z);
    return { ...p, z };
  });
  const lines = Object.entries(all.lines ?? {})
    .filter(([id]) => all.st.some((s) => lineOf(s) === id))
    .map(([id, l]) => ({ id, n: l.n }));
  return { floor, plates, split, can, lines };
}

/** Perspective on `.mlay-view` (px) and its origin's height (share of the box). */
const PERSPECTIVE = 2200;
const EYE_Y = 0.3;
/** Room kept clear at the foot of the view for the hint and the plates' names (px). */
const FOOT = 36;

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
function fitOf(
  w: number,
  h: number,
  rects: readonly Rect[],
  pose: Pose,
  [bw, bh]: readonly [number, number],
  fill = 0.94,
): Pick<Cam, "k" | "x" | "y"> {
  if (!bw || !bh) return { k: 0.6, x: 0, y: 0 };
  const [cz, sz] = [Math.cos((pose.rz * Math.PI) / 180), Math.sin((pose.rz * Math.PI) / 180)];
  const [cx, sx] = [Math.cos((pose.rx * Math.PI) / 180), Math.sin((pose.rx * Math.PI) / 180)];
  const eye = [bw / 2, bh * EYE_Y] as const;
  const boxAt = (k: number, dx: number, dy: number) => {
    const pts = rects.flatMap(([l, t, pw, ph, up]) =>
      [
        [l, t],
        [l + pw, t],
        [l + pw, t + ph],
        [l, t + ph],
      ].map(([px = 0, py = 0]) => [px - w / 2, py - h / 2, up * pose.e] as const),
    );
    const flat = pts.map(([px, py, up]) => {
      const [x1, y1] = [px * cz - py * sz, px * sz + py * cz];
      const [X, Y, Z] = [k * x1, k * (y1 * cx - up * sx), k * (y1 * sx + up * cx)];
      const at = PERSPECTIVE / (PERSPECTIVE - Z);
      return [
        eye[0] + (bw / 2 + dx + X - eye[0]) * at,
        eye[1] + (bh / 2 + dy + Y - eye[1]) * at,
      ] as const;
    });
    const xs = flat.map((p) => p[0]);
    const ys = flat.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  let k = 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const b = boxAt(k, x, y);
    k *= Math.min((bw * fill) / (b.x1 - b.x0), ((bh - FOOT) * fill) / (b.y1 - b.y0));
    k = Math.min(2.5, Math.max(0.2, k));
    const c = boxAt(k, x, y);
    x += bw / 2 - (c.x0 + c.x1) / 2;
    y += (bh - FOOT) / 2 - (c.y0 + c.y1) / 2;
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
  className?: string | undefined;
}

const partKey = (p: LayerPart) => `${p.kind}:${p.id}`;

/** The floor and its plates: drawn once per level. Moving the camera never draws them again. */
const Stage = memo(function Stage({
  level,
  onPlate,
  open,
  shut,
  onShut,
}: {
  level: Level;
  onPlate: (p: Plate, how: "open" | "stack") => void;
  open: boolean;
  shut: ReadonlySet<string>;
  onShut: ((key: string) => void) | null;
}) {
  return (
    <>
      <div className="mlay-floor">
        <MetroSvg scene={level.floor} still bare />
      </div>
      {level.plates.map((p) => {
        const key = partKey(p.part);
        const down = shut.has(key);
        return (
          <div
            key={key}
            className={cx("mlay-slot", down && "shut")}
            data-part={key}
            style={{ "--zn": p.z } as CSSProperties}
          >
            {/* One dashed line from its stop up to the plate. */}
            <i className="mlay-drop" style={{ left: p.at[0], top: p.at[1] }} aria-hidden="true" />
            {/* shut: an anchor on its stop; its Lift pin sits in the flat overlay */}
            {down ? (
              <i
                className="mlay-at"
                data-at={key}
                style={{ left: p.at[0], top: p.at[1] }}
                aria-hidden="true"
              />
            ) : null}
            <div className="mlay-plate" style={p.box} inert={down || undefined}>
              {/* still hit box: the face lifts on hover, the pointer stays on this */}
              <i className="mlay-pad" aria-hidden="true" />
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
                      onClick={() => onShut(key)}
                    >
                      <Icon name="arrowDown" size={14} />
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
  const pins = useRef<HTMLDivElement>(null);
  const cam = useRef<Cam>({ ...APART, k: 0.6, x: 0, y: 0 });
  const run = useRef<{ stop: () => void } | null>(null);
  // The pose last asked for: a resize mid-flight keeps to it.
  const flat = useRef(false);
  const frame = useRef(0);
  // Set by a drag, so the click after it does not open a plate.
  const dragged = useRef(false);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const grab = useRef<{ x: number; y: number; cam: Cam; pan: boolean; d?: number } | null>(null);
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

  // Each Lift pin onto its stop's place on screen: flat, upright, over every plate.
  const pinAll = useCallback(() => {
    const host = pins.current;
    const el = stage.current;
    const v = viewEl.current?.getBoundingClientRect();
    if (!host || !el || !v) return;
    for (const b of host.children) {
      if (!(b instanceof HTMLElement)) continue;
      const r = el
        .querySelector(`[data-at="${CSS.escape(b.dataset.at ?? "")}"]`)
        ?.getBoundingClientRect();
      b.hidden = !r;
      if (r) b.style.transform = `translate(${r.left - v.left}px, ${r.top - v.top}px)`;
    }
  }, []);

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
    pinAll();
  }, [pinAll]);
  const soon = useCallback(() => {
    frame.current ||= requestAnimationFrame(place);
  }, [place]);

  /** Every box at full apart: the floor and each plate. */
  const rects = useCallback(
    (): Rect[] => [
      [0, 0, w, h, 0],
      ...(level?.plates ?? []).map(
        ({ box: b, z, part }) =>
          [b.left, b.top, b.width, b.height, shut.has(partKey(part)) ? 0 : z] as const,
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
      run.current = a;
      a.then(() => {
        if (run.current === a) end();
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
  }, [level, box]);

  // A shut or a lift adds or drops a pin: place them before paint.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shutKey` and `level` change the pins.
  useLayoutEffect(pinAll, [pinAll, shutKey, level]);

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
    if ((e.target as Element).closest(".mlay-act, .mlay-lift, .mlay-bar")) return;
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
            onChange={(v) => poseTo(v === "flat" ? FLAT : APART)}
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
      <div
        ref={view}
        className="mlay-view"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {failed ? (
          <p className="mlay-fail">This floor could not be drawn: {failed}</p>
        ) : !f || !level ? (
          <MetroSkeleton label="Lifting the layers" />
        ) : (
          <div
            ref={stage}
            className="mlay-stage"
            style={{ width: w, height: f.h, marginLeft: -w / 2, marginTop: -f.h / 2 }}
          >
            <Stage
              level={level}
              onPlate={pick}
              open={!!onOpen}
              shut={shut}
              onShut={onShut ? toggle : null}
            />
          </div>
        )}
        {onShut && level ? (
          <div ref={pins} className="mlay-pins">
            {level.plates
              .filter((p) => shut.has(partKey(p.part)))
              .map((p) => (
                <button
                  key={partKey(p.part)}
                  type="button"
                  className="mlay-lift"
                  data-at={partKey(p.part)}
                  aria-label={`Lift ${p.label}`}
                  title={`Lift ${p.label}`}
                  onClick={() => toggle(partKey(p.part))}
                >
                  <Icon name="stack" size={14} />
                  <span>{p.label}</span>
                </button>
              ))}
          </div>
        ) : null}
        <p className="mlay-hint">
          {level && !level.plates.length
            ? "Nothing to split at this level."
            : "Drag to turn. Scroll to move, pinch to zoom. Point at a plate to raise it, click to open it."}
        </p>
      </div>
    </div>
  );
}
