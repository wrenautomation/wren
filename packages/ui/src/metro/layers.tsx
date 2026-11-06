/**
 * Layers (experiment, 2026-11-06; designs/2026-11-06-orrery-business-look.md): the map in 2.5D.
 * The floor is one level: the whole map, a fold node or one line. Each closed fold on the floor
 * lifts onto a plate over its circle, with what it holds. A plate click makes it the floor.
 * CSS 3D over `MetroSvg`: no new dependency, text stays vector.
 */
import { type FoldNode, pathTo } from "@wrenautomation/orrery";
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
import { Button } from "../controls.js";
import { cx } from "../format.js";
import { MetroSvg } from "./draw.js";
import { type FocusSpec, focusScene } from "./focus.js";
import type { MetroZoom } from "./fold.js";
import { MetroSkeleton } from "./skeleton.js";
import type { MetroScene, SceneStation } from "./types.js";

/** What the floor shows: the whole map, one fold node and what it holds, or one line. */
export type LayerFloor = { kind: "node" | "line"; id: string } | null;

interface Plate {
  id: string;
  label: string;
  /** Cut from the level's scene: its `x0`, `y0` place it over the floor. */
  scene: MetroScene;
  /** How high it floats (px). */
  z: number;
}

interface Level {
  floor: MetroScene;
  plates: Plate[];
  /** The lines on the floor, for the picker. */
  lines: { id: string; n: string }[];
}

/** Room round a plate's stations, so names and stubs show. */
const PAD = { x: 24, top: 62, bottom: 48 };
/** How high a plate floats: the front one lowest, each one further back a step higher, so none hides the one behind. */
const LIFT = { base: 90, step: 45 } as const;
/** The turn at rest; a tall box turns the map more, so its length runs down the screen. */
const poseFor = ([bw, bh]: readonly [number, number]) =>
  bw && bh && bw < bh ? { rx: 50, rz: -62 } : { rx: 52, rz: -28 };

const grpOf = (s: SceneStation): string | undefined =>
  "grp" in s && typeof s.grp === "string" ? s.grp : undefined;

/** A focused scene cropped to its stations' band, top and bottom too. */
function band(scene: MetroScene): MetroScene {
  const ys = scene.st.map((s) => s.y);
  if (!ys.length) return scene;
  const y0 = Math.max(0, Math.min(...ys) - PAD.top);
  return { ...scene, y0, h: Math.max(...ys) + PAD.bottom - y0, still: true, click: false };
}

const only = (ids: Iterable<string>): FocusSpec =>
  [...ids].map((id) => ({ kind: "station" as const, id }));

/**
 * One level as an exploded view. `all` is the floor's level with each of its folds open: the map
 * as it stands. Each fold's stations go on a plate, cut from `all` where they stand; the floor
 * keeps the rest, in the same frame. So a plate floats straight over its own place, and folded
 * back it lands in it: the flat map again.
 */
async function levelOf(zoom: MetroZoom, at: LayerFloor): Promise<Level> {
  let open = new Set<string>();
  // Stations outside a node floor: what shows with the node shut.
  let outside: Set<string> | null = null;
  const lineNode = (ln: string) => zoom.nodes.find((n) => n.id.startsWith(`${ln}@`))?.id;
  if (at?.kind === "node") {
    const shut = new Set(pathTo(zoom.nodes, at.id).map((n) => n.id));
    shut.delete(at.id);
    open = new Set([...shut, at.id]);
    outside = new Set((await zoom.scene(shut)).st.map((s) => s.id));
  } else if (at?.kind === "line") {
    const n = lineNode(at.id);
    if (n) open = new Set(pathTo(zoom.nodes, n).map((p) => p.id));
  }
  const mine = (s: SceneStation) =>
    outside ? !outside.has(s.id) : at?.kind === "line" ? "ln" in s && s.ln === at.id : true;
  const flat = await zoom.scene(open);
  const kids = [...new Set(flat.st.filter(mine).map(grpOf))].filter((k): k is string => !!k);
  // One layout opens every fold at once, not one per plate: each plate is a cut of it.
  const all = kids.length ? await zoom.scene(new Set([...open, ...kids])) : flat;
  const parent = new Map(zoom.nodes.map((n) => [n.id, n.parent]));
  const isKid = new Set(kids);
  const kidOf = (id: string | undefined) => {
    for (let k = id; k; k = parent.get(k)) if (isKid.has(k)) return k;
    return undefined;
  };
  const was = new Set(flat.st.map((s) => s.id));
  const held = new Map(kids.map((k) => [k, [] as string[]]));
  const lifted = new Set<string>();
  for (const s of all.st) {
    if (was.has(s.id) || !mine(s)) continue;
    const ln = "ln" in s ? s.ln : undefined;
    const k =
      kidOf(grpOf(s)) ??
      kidOf("g" in s ? s.g : undefined) ??
      (ln ? kidOf(lineNode(ln)) : undefined);
    if (!k) continue;
    held.get(k)?.push(s.id);
    lifted.add(s.id);
  }
  const ours = all.st.filter(mine).map((s) => s.id);
  const frame = band(focusScene(all, only(ours)));
  const rest = ours.filter((id) => !lifted.has(id));
  const floor: MetroScene = {
    ...(rest.length ? focusScene(all, only(rest)) : { ...all, st: [], tr: [] }),
    ...(frame.x0 === undefined ? {} : { x0: frame.x0 }),
    ...(frame.w === undefined ? {} : { w: frame.w }),
    ...(frame.y0 === undefined ? {} : { y0: frame.y0 }),
    h: frame.h,
    still: true,
    click: false,
  };
  const label = (k: string) => zoom.nodes.find((n) => n.id === k)?.label ?? k;
  const cut = kids.flatMap((k) => {
    const ids = held.get(k);
    return ids?.length ? [{ id: k, label: label(k), scene: band(focusScene(all, only(ids))) }] : [];
  });
  const front = [...cut].sort((a, b) => (b.scene.y0 ?? 0) - (a.scene.y0 ?? 0));
  const plates = cut.map((p) => ({ ...p, z: LIFT.base + front.indexOf(p) * LIFT.step }));
  const lines = Object.entries(all.lines ?? {})
    .filter(([id]) => all.st.some((s) => "ln" in s && s.ln === id))
    .map(([id, l]) => ({ id, n: l.n }));
  return { floor, plates, lines };
}

/** Perspective on `.mlay-view` (px) and its origin's height (share of the box). */
const PERSPECTIVE = 2200;
const EYE_Y = 0.3;

/**
 * Scale and shift so the turned floor fills the box: its corners projected as the browser does
 * (rotateZ, rotateX, scale, then the parent's perspective). Twice: perspective is not linear.
 */
function fitOf(
  w: number,
  h: number,
  /** Each floating plate: left, top, width, height on the floor (px), and how high. */
  raised: readonly (readonly [number, number, number, number, number])[],
  pose: { rx: number; rz: number },
  [bw, bh]: readonly [number, number],
) {
  if (!bw || !bh) return { k: 0.6, dx: 0, dy: 0 };
  const [cz, sz] = [Math.cos((pose.rz * Math.PI) / 180), Math.sin((pose.rz * Math.PI) / 180)];
  const [cx, sx] = [Math.cos((pose.rx * Math.PI) / 180), Math.sin((pose.rx * Math.PI) / 180)];
  const eye = [bw / 2, bh * EYE_Y];
  const boxAt = (k: number, dx: number, dy: number) => {
    // The floor's corners, and each plate's where it floats.
    const pts = [[0, 0, w, h, 0] as const, ...raised].flatMap(([l, t, pw, ph, up]) =>
      [
        [l, t],
        [l + pw, t],
        [l + pw, t + ph],
        [l, t + ph],
      ].map(([x = 0, y = 0]) => [x - w / 2, y - h / 2, up] as const),
    );
    const flat = pts.map(([x, y, up]) => {
      const [x1, y1] = [x * cz - y * sz, x * sz + y * cz];
      const [X, Y, Z] = [k * x1, k * (y1 * cx - up * sx), k * (y1 * sx + up * cx)];
      const at = PERSPECTIVE / (PERSPECTIVE - Z);
      const [ex = 0, ey = 0] = eye;
      return [ex + (bw / 2 + dx + X - ex) * at, ey + (bh / 2 + dy + Y - ey) * at] as const;
    });
    const xs = flat.map((p) => p[0]);
    const ys = flat.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  let k = 1;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < 3; i++) {
    const b = boxAt(k, dx, dy);
    k *= Math.min((bw * 0.96) / (b.x1 - b.x0), (bh * 0.94) / (b.y1 - b.y0));
    k = Math.min(1.4, Math.max(0.25, k));
    const c = boxAt(k, dx, dy);
    dx += bw / 2 - (c.x0 + c.x1) / 2;
    dy += bh / 2 - (c.y0 + c.y1) / 2;
  }
  return { k, dx, dy };
}

/** The node path to the floor, for the crumbs. */
const crumbsOf = (nodes: readonly FoldNode[], at: LayerFloor) =>
  at?.kind === "node" ? pathTo(nodes, at.id) : [];

export interface MetroLayersProps {
  zoom: MetroZoom;
  floor: LayerFloor;
  onFloor: (floor: LayerFloor) => void;
  className?: string | undefined;
}

/** The floor and its plates: drawn once per level. Turning and lifting never draw them again. */
const Stage = memo(function Stage({
  level,
  onFloor,
}: {
  level: Level;
  onFloor: (floor: LayerFloor) => void;
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
        const box = { left, top, width: p.scene.w ?? 0, height: p.scene.h };
        const z = { "--z": `${p.z}px` } as CSSProperties;
        return (
          <div key={p.id}>
            {/* Its place on the floor, seen while it floats. */}
            <div className="mlay-foot" style={box} aria-hidden="true" />
            <button
              type="button"
              className="mlay-plate"
              aria-label={`${p.label}: make it the floor`}
              style={{ ...box, ...z }}
              onClick={() => onFloor({ kind: "node", id: p.id })}
            >
              <span className="mlay-tag">{p.label}</span>
              <MetroSvg scene={p.scene} still bare />
            </button>
          </div>
        );
      })}
    </>
  );
});

export function MetroLayers({ zoom, floor, onFloor, className }: MetroLayersProps) {
  const [level, setLevel] = useState<Level | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [lifted, setLifted] = useState(true);
  const [box, setBox] = useState<[number, number]>([0, 0]);
  const stage = useRef<HTMLDivElement>(null);
  const pose = useRef<{ rx: number; rz: number }>(poseFor([0, 0]));
  // Turned by hand: the pose stays until a reset.
  const turned = useRef(false);
  const drag = useRef<{ x: number; y: number; rx: number; rz: number } | null>(null);
  const frame = useRef(0);
  // A stable pick, so the memoized stage keeps across the host's renders.
  const onFloorRef = useRef(onFloor);
  onFloorRef.current = onFloor;
  const pick = useCallback((at: LayerFloor) => onFloorRef.current(at), []);

  const key = `${floor?.kind ?? ""}:${floor?.id ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the floor.
  useEffect(() => {
    let live = true;
    setFailed(null);
    levelOf(zoom, floor).then(
      (l) => live && setLevel(l),
      (e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [zoom, key]);

  const f = level?.floor;
  const w = f?.w ?? 960;
  const h = f?.h ?? 400;
  // Fit for the level, the box and the pose at rest; a drag keeps it, a reset fits again.
  const fit = useRef({ k: 1, dx: 0, dy: 0 });
  // The pose goes straight to the stage's style, once a frame: no React render while turning.
  const place = useCallback(() => {
    frame.current = 0;
    const el = stage.current;
    const { k, dx, dy } = fit.current;
    if (el)
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${k}) rotateX(${pose.current.rx}deg) rotateZ(${pose.current.rz}deg)`;
  }, []);
  const refit = useCallback(() => {
    const x0 = f?.x0 ?? 0;
    const y0 = f?.y0 ?? 0;
    const raised = lifted
      ? (level?.plates ?? []).map(
          (p) =>
            [
              (p.scene.x0 ?? 0) - x0,
              (p.scene.y0 ?? 0) - y0,
              p.scene.w ?? 0,
              p.scene.h,
              p.z,
            ] as const,
        )
      : [];
    if (!turned.current) pose.current = poseFor(box);
    fit.current = fitOf(w, h, raised, pose.current, box);
    place();
  }, [w, h, f, level, lifted, box, place]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new level mounts a new stage.
  useLayoutEffect(refit, [refit, level]);
  const view = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setBox([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, ...pose.current };
    turned.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    stage.current?.classList.add("drag");
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    pose.current = {
      rz: d.rz + (e.clientX - d.x) * 0.25,
      rx: Math.max(0, Math.min(72, d.rx - (e.clientY - d.y) * 0.2)),
    };
    frame.current ||= requestAnimationFrame(place);
  };
  const up = () => {
    drag.current = null;
    stage.current?.classList.remove("drag");
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
          {/* Stays when nothing floats, so the bar does not shift. */}
          <Button
            tone="quiet"
            size="dense"
            disabled={!level?.plates.length}
            onClick={() => setLifted((v) => !v)}
          >
            {lifted ? "Fold back" : "Lift folds"}
          </Button>
          <Button
            tone="quiet"
            size="dense"
            onClick={() => {
              turned.current = false;
              refit();
              setLifted(true);
            }}
          >
            Reset view
          </Button>
        </div>
        {level?.lines.length ? (
          <label className="mlay-line">
            <span>Line</span>
            <select
              value={floor?.kind === "line" ? floor.id : ""}
              onChange={(e) =>
                onFloor(e.target.value ? { kind: "line", id: e.target.value } : null)
              }
            >
              <option value="">All lines</option>
              {level.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
            className={cx("mlay-stage", lifted && "up")}
            style={{ width: w, height: f.h, marginLeft: -w / 2, marginTop: -f.h / 2 }}
          >
            <Stage level={level} onFloor={pick} />
          </div>
        )}
        <p className="mlay-hint">Drag to turn. Click a plate to make it the floor.</p>
      </div>
    </div>
  );
}
