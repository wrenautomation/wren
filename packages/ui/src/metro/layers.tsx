/**
 * Layers (experiment, 2026-11-06; designs/2026-11-06-orrery-business-look.md): the map in 2.5D.
 * The floor is one level: the whole map, a fold node or one line. The level splits into plates,
 * by fold or by line; each plate floats over its own place. Tilt it and it comes apart, flatten it
 * and it lands: the flat map again. A plate opens as the main flat view, or becomes the floor.
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
  useRef,
  useState,
} from "react";
import { Button, Seg } from "../controls.js";
import { cx } from "../format.js";
import { MetroSvg } from "./draw.js";
import { type FocusSpec, focusScene } from "./focus.js";
import type { MetroZoom } from "./fold.js";
import { MetroSkeleton } from "./skeleton.js";
import { isMark, type MetroScene, type SceneStation } from "./types.js";

/** A part of the map: a fold node, or one line. */
export type LayerPart = { kind: "node" | "line"; id: string };
/** What the floor shows: the whole map, or one part and what it holds. */
export type LayerFloor = LayerPart | null;
/** How a level comes apart: one plate per fold, or one per line. */
export type LayerSplit = "folds" | "lines";

interface Plate {
  part: LayerPart;
  label: string;
  /** Cut from the level's scene: its `x0`, `y0` place it over the floor. */
  scene: MetroScene;
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

/** Room round a plate's stations, so names and stubs show. */
const PAD = { top: 62, bottom: 48 };
/** Front plate lowest, each one further back a step higher: none hides the one behind. */
const LIFT = { base: 90, step: 45 } as const;

const grpOf = (s: SceneStation): string | undefined =>
  "grp" in s && typeof s.grp === "string" ? s.grp : undefined;
const lineOf = (s: SceneStation): string | undefined =>
  isMark(s) ? s.ln : "l" in s && typeof s.l === "string" ? s.l : undefined;

/** A focused scene cropped to its stations' band, top and bottom too. */
function band(scene: MetroScene): MetroScene {
  const ys = scene.st.map((s) => s.y);
  if (!ys.length) return scene;
  const y0 = Math.max(0, Math.min(...ys) - PAD.top);
  return { ...scene, y0, h: Math.max(...ys) + PAD.bottom - y0, still: true, click: false };
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
 * One level, apart. `all` is the level with each of its folds open: the map as it stands. Each
 * plate is a cut of `all` where its stations stand; the floor keeps the rest, in the same frame. So
 * a plate floats straight over its own place, and landed it is the flat map again.
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
  const kids = [...new Set(flat.st.filter(mine).map(grpOf))].filter((k): k is string => !!k);
  // One layout opens every fold at once: each plate is a cut of it.
  const all = kids.length ? await zoom.scene(new Set([...open, ...kids])) : flat;
  const ours = all.st.filter(mine);

  // By fold: what each shut fold held.
  const was = new Set(flat.st.map((s) => s.id));
  const under = underOf(zoom, new Set(kids));
  const byFold = new Map<string, string[]>();
  for (const s of ours) {
    const k = was.has(s.id) ? undefined : under(s);
    if (k) byFold.set(k, [...(byFold.get(k) ?? []), s.id]);
  }
  // By line: each line's own stops; the hub stays on the floor.
  const byLine = new Map<string, string[]>();
  for (const s of ours) {
    const ln = isMark(s) && s.t === "hub" ? undefined : lineOf(s);
    if (ln) byLine.set(ln, [...(byLine.get(ln) ?? []), s.id]);
  }
  for (const [ln, ids] of byLine) if (ids.length < 2) byLine.delete(ln);
  const can = { folds: byFold.size > 0, lines: at?.kind !== "line" && byLine.size > 1 };
  const split: LayerSplit = can[want] ? want : can.folds ? "folds" : "lines";
  const groups = can[split] ? (split === "folds" ? byFold : byLine) : new Map<string, string[]>();

  const name = (id: string) =>
    split === "folds"
      ? (zoom.nodes.find((n) => n.id === id)?.label ?? id)
      : (all.lines?.[id]?.n ?? id);
  const cut = [...groups].map(([id, ids]) => ({
    part: { kind: split === "folds" ? "node" : "line", id } as LayerPart,
    label: name(id),
    scene: band(focusScene(all, only(ids))),
    deep: zoom.nodes.some(
      (n) =>
        n.parent ===
        (split === "folds" ? id : zoom.nodes.find((n) => n.id.startsWith(`${id}@`))?.id),
    ),
  }));
  const lifted = new Set([...groups.values()].flat());
  const frame = band(focusScene(all, only(ours.map((s) => s.id))));
  const rest = ours.filter((s) => !lifted.has(s.id)).map((s) => s.id);
  const floor: MetroScene = {
    ...(rest.length ? focusScene(all, only(rest)) : { ...all, st: [], tr: [] }),
    ...(frame.x0 === undefined ? {} : { x0: frame.x0 }),
    ...(frame.w === undefined ? {} : { w: frame.w }),
    ...(frame.y0 === undefined ? {} : { y0: frame.y0 }),
    h: frame.h,
    still: true,
    click: false,
  };
  const front = [...cut].sort((a, b) => (b.scene.y0 ?? 0) - (a.scene.y0 ?? 0));
  const plates = cut.map((p) => ({ ...p, z: LIFT.base + front.indexOf(p) * LIFT.step }));
  const lines = Object.entries(all.lines ?? {})
    .filter(([id]) => all.st.some((s) => lineOf(s) === id))
    .map(([id, l]) => ({ id, n: l.n }));
  return { floor, plates, split, can, lines };
}

/** Perspective on `.mlay-view` (px) and its origin's height (share of the box). */
const PERSPECTIVE = 2200;
const EYE_Y = 0.3;

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
/** Apart: tilted, a small turn so the stack reads. Same on a phone: a bigger turn put names on their side. */
const APART: Pose = { rx: 54, rz: -10, e: 1 };
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
    k *= Math.min((bw * fill) / (b.x1 - b.x0), (bh * fill) / (b.y1 - b.y0));
    k = Math.min(2.5, Math.max(0.2, k));
    const c = boxAt(k, x, y);
    x += bw / 2 - (c.x0 + c.x1) / 2;
    y += bh / 2 - (c.y0 + c.y1) / 2;
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
  className?: string | undefined;
}

/** The floor and its plates: drawn once per level. Moving the camera never draws them again. */
const Stage = memo(function Stage({
  level,
  onPlate,
  open,
}: {
  level: Level;
  onPlate: (p: Plate, how: "open" | "stack") => void;
  open: boolean;
}) {
  const f = level.floor;
  const x0 = f.x0 ?? 0;
  const y0 = f.y0 ?? 0;
  return (
    <>
      <div className="mlay-floor">
        <MetroSvg scene={f} still bare />
      </div>
      {level.plates.map((p) => {
        const left = (p.scene.x0 ?? 0) - x0;
        const top = (p.scene.y0 ?? 0) - y0;
        const width = p.scene.w ?? 0;
        const height = p.scene.h;
        const box = { left, top, width, height };
        const key = `${p.part.kind}:${p.part.id}`;
        return (
          <div
            key={key}
            className="mlay-slot"
            data-part={key}
            style={{ "--zn": p.z } as CSSProperties}
          >
            {/* Its place on the floor, and a post at each corner up to it. */}
            <div className="mlay-foot" style={box} aria-hidden="true" />
            {[
              [left, top],
              [left + width, top],
              [left, top + height],
              [left + width, top + height],
            ].map(([l, t]) => (
              <i
                key={`${l}:${t}`}
                className="mlay-post"
                style={{ left: l, top: t }}
                aria-hidden="true"
              />
            ))}
            <div className="mlay-plate" style={box}>
              <button
                type="button"
                className="mlay-open"
                aria-label={open ? `Open ${p.label}` : `${p.label}: stack it here`}
                onClick={() => onPlate(p, open ? "open" : "stack")}
              >
                <MetroSvg scene={p.scene} still bare />
              </button>
              <div className="mlay-tag">
                <span>{p.label}</span>
                {open && p.deep ? (
                  <button
                    type="button"
                    className="mlay-stack"
                    aria-label={`${p.label}: stack it here`}
                    onClick={() => onPlate(p, "stack")}
                  >
                    Stack here
                  </button>
                ) : null}
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
  className,
}: MetroLayersProps) {
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
  const live = useRef({ onFloor, onOpen });
  live.current = { onFloor, onOpen };

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
    el.classList.toggle("landed", c.e < 0.02);
  }, []);
  const soon = useCallback(() => {
    frame.current ||= requestAnimationFrame(place);
  }, [place]);

  /** Every box at full apart: the floor and each plate. */
  const rects = useCallback((): Rect[] => {
    const x0 = f?.x0 ?? 0;
    const y0 = f?.y0 ?? 0;
    return [
      [0, 0, w, h, 0],
      ...(level?.plates ?? []).map(
        (p) =>
          [(p.scene.x0 ?? 0) - x0, (p.scene.y0 ?? 0) - y0, p.scene.w ?? 0, p.scene.h, p.z] as const,
      ),
    ];
  }, [f, w, h, level]);

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
    if ((e.target as Element).closest(".mlay-stack, .mlay-bar")) return;
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
      const x0 = f?.x0 ?? 0;
      const y0 = f?.y0 ?? 0;
      const top: Pose = { rx: 0, rz: 0, e: cam.current.e };
      const rect: Rect = [
        (p.scene.x0 ?? 0) - x0,
        (p.scene.y0 ?? 0) - y0,
        p.scene.w ?? 0,
        p.scene.h,
        p.z,
      ];
      const el = stage.current;
      el?.classList.add("opening");
      el?.querySelector(
        `[data-part="${CSS.escape(`${p.part.kind}:${p.part.id}`)}"]`,
      )?.classList.add("chosen");
      fly({ ...top, ...fitOf(w, h, [rect], top, box, 0.98) }, () =>
        live.current.onOpen?.(p.part, p.label),
      );
    },
    [f, w, h, box, fly],
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
            <Stage level={level} onPlate={pick} open={!!onOpen} />
          </div>
        )}
        <p className="mlay-hint">
          {level && !level.plates.length
            ? "Nothing to split at this level."
            : "Drag to turn. Shift-drag or scroll to move. Pinch to zoom. Click a plate to open it."}
        </p>
      </div>
    </div>
  );
}
