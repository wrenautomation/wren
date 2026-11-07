/**
 * Layers (experiment, 2026-11-06; designs/2026-11-06-orrery-business-look.md): the map in 2.5D,
 * as the artifact's "Layers (3D)". The floor is one level with its folds shut: each fold a stacked
 * stop. Each fold's inside floats on a plate over its stop, on one dashed drop line. "Together"
 * lands the plates onto their stops: the fold, as a move. By line, each line is a plate over its
 * own place. A plate opens as the main flat view, or becomes the floor.
 * CSS 3D over `MetroSvg`: no new renderer, text stays vector. Camera springs: `motion`.
 */
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
import type { MetroZoom } from "./fold.js";
import { layerShapes, saveGhost } from "./ghost.js";
import {
  APART,
  apartAt,
  type Cam,
  corners,
  crumbsOf,
  FLAT,
  fitOf,
  inQuad,
  type LayerFloor,
  type LayerPart,
  type LayerSplit,
  type Level,
  levelOf,
  type Plate,
  type Pose,
  type Rect,
  SNAP_FLAT,
  toView,
} from "./plates.js";
import { MetroSkeleton } from "./skeleton.js";

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
