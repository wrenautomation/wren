/**
 * `MetroMap`: a metro map you can zoom. It draws a `MetroZoom` (or a scene, or a view) at a level
 * and takes the viewer's folds. Props only: it fetches nothing.
 *
 * `level` and `open` are controlled when the parent passes them (with `onLevel`, `onOpen`) and
 * kept here when it does not. The map keeps no state a remount would lose when the parent passes
 * both. Hover or focus on a line lights it; Enter or Space on a mark picks it or opens its fold;
 * a wheel with ctrl or meta, a Safari pinch and a touch pinch step the level.
 *
 * Scale: one scene px is one css px. The host centres a map smaller than itself and scrolls a map
 * wider or taller than itself, so a label reads at its real size on any screen.
 */
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "../format.js";
import { MetroSvg } from "./draw.js";
import { type FocusSpec, focusScene, nameOf } from "./focus.js";
import { autoZoom, type MetroZoom, type OpenMap, stepLevel, toggleGroup } from "./fold.js";
import { centreOf, fadeIn, GLIDE_MS, glide, glideHeight } from "./glide.js";
import { layoutMetro } from "./layout.js";
import { MARK_GLYPH, MARK_WORD } from "./marks.js";
import type { Mark, MetroPart, MetroScene, Point } from "./types.js";
import type { MetroView } from "./view.js";
import "./metro.css";

/** What the viewer picked: a station or a folded mark, a track, or a group they closed. */
export interface MetroPick {
  kind: "station" | "track" | "group";
  id: string;
  /** For a station or folded mark: its fold group, when it has one. */
  group?: string | undefined;
}

export interface MetroMapProps {
  /** What to draw. One of: zoom (levels and folds), scene (placed), view (placed by `layoutMetro`). */
  zoom?: MetroZoom | undefined;
  scene?: MetroScene | undefined;
  view?: MetroView | undefined;

  /** The zoom level. Controlled with `onLevel`; `defaultLevel` when not. */
  level?: number | undefined;
  defaultLevel?: number | undefined;
  onLevel?: ((level: number) => void) | undefined;
  /** Groups opened (true) or folded (false) by hand. Controlled with `onOpen`. */
  open?: OpenMap | undefined;
  onOpen?: ((open: OpenMap) => void) | undefined;

  /** Enter, Space or a click on a mark or track. */
  onPick?: ((pick: MetroPick) => void) | undefined;
  /** The picked id. Controlled when passed. */
  selected?: string | null | undefined;
  /** A line to light from outside (a task list). Hover on the map lights lines when it is not passed. */
  lit?: string | null | undefined;

  /** The level buttons and the count line. Default: on. */
  controls?: boolean | undefined;
  /**
   * Draw one part only (a line, group, station or flow) and a faded stub for each track that
   * crosses its edge. Shows every station of that part, whatever the level.
   */
  focus?: FocusSpec | null | undefined;
  /** A click, Enter or Space on a stub: the part on its far side. */
  onStub?: ((part: MetroPart) => void) | undefined;
  /** No dots move. */
  still?: boolean | undefined;
  /** The first-load draw-in. Default: on. Off for stories and tests. Never on a level change. */
  intro?: boolean | undefined;
  className?: string | undefined;
  /** More controls beside the levels. */
  children?: ReactNode;
}

/** A value the parent may own. */
function useControlled<T>(value: T | undefined, initial: T): [T, (v: T) => void] {
  const [own, setOwn] = useState(initial);
  return [value !== undefined ? value : own, setOwn];
}

const sameOpen = (a: OpenMap, b: OpenMap) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

const reduced = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Names of the marks and tracks: when this changes, the map has a new shape. */
const shapeOf = (s: MetroScene) =>
  `${s.st.map((x) => x.id).join()}|${s.tr.map((r) => r.id ?? `${r.a}${r.b}`).join()}`;

/** The first-load draw-in lasts about this long, then the map stops carrying its classes. */
const INTRO_MS = 4200;

export function MetroMap(props: MetroMapProps) {
  const { onPick, controls = true, still, className } = props;
  const zoom = useMemo<MetroZoom>(
    () => props.zoom ?? autoZoom(props.scene ?? (props.view ? layoutMetro(props.view) : EMPTY)),
    [props.zoom, props.scene, props.view],
  );
  const [level, setLevel] = useControlled(props.level, props.defaultLevel ?? 0);
  const [open, setOpen] = useControlled<OpenMap>(props.open, NONE);
  const [pickedOwn, setPicked] = useState<string | null>(null);
  const picked = props.selected !== undefined ? props.selected : pickedOwn;
  const [hover, setHover] = useState<string | null>(null);
  const lit = props.lit !== undefined ? props.lit : hover;

  const focus = props.focus ?? null;
  const base = useMemo(
    // A focused part shows all its stations: the deepest level, nothing folded.
    () => (focus ? zoom.scene(zoom.names.length - 1, {}) : zoom.scene(level, open)),
    [zoom, level, open, focus],
  );
  const scene = useMemo(() => (focus ? focusScene(base, focus) : base), [base, focus]);
  const mixed = Object.keys(open).length > 0;

  // The first load happens once, on mount. A level change or a refresh never brings it back.
  const [intro, setIntro] = useState(props.intro !== false);
  // A new shape inside the window (a focus, a view, a level) ends it before the marks are drawn.
  const first = useRef<string | null>(null);
  const shape = shapeOf(scene);
  if (first.current === null) first.current = shape;
  if (intro && shape !== first.current) setIntro(false);
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(t);
  }, [intro]);

  // Callbacks and state the native listeners read; they never go stale.
  const live = useRef({ level, open, zoom, onPick, onStub: props.onStub, focused: !!focus });
  live.current = { level, open, zoom, onPick, onStub: props.onStub, focused: !!focus };
  const anchor = useRef<Point | null>(null);
  const set = (
    next: { level: number; open: OpenMap },
    from?: Element | null,
    at?: Point | null,
  ) => {
    anchor.current = at ?? centreOf(from ?? null);
    setIntro(false);
    setLevel(next.level);
    setOpen(next.open);
    if (next.level !== level) props.onLevel?.(next.level);
    if (!sameOpen(next.open, open)) props.onOpen?.(next.open);
  };
  const setRef = useRef(set);
  setRef.current = set;
  const pick = (p: MetroPick) => {
    setPicked(p.id);
    live.current.onPick?.(p);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const old = useRef<HTMLDivElement>(null);

  // Events on the map. Delegated: the marks are the buttons.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const act = (target: Element) => {
      const { zoom: z, level: lv, open: op } = live.current;
      const stub = target.closest<SVGElement>("[data-stub]");
      if (stub?.dataset.stub) {
        const kind = stub.dataset.stubKind as MetroPart["kind"];
        live.current.onStub?.({ kind, id: stub.dataset.stub });
        return;
      }
      if (live.current.focused) {
        const node = target.closest<SVGElement>("[data-id],[data-tr]");
        if (node?.dataset.id) pickRef.current({ kind: "station", id: node.dataset.id });
        else if (node?.dataset.tr) pickRef.current({ kind: "track", id: node.dataset.tr });
        return;
      }
      const fold = target.closest<SVGElement>("[data-fold]");
      if (fold?.dataset.fold) {
        const k = fold.dataset.fold;
        setRef.current(toggleGroup(z, { level: lv, open: op }, k, false), fold);
        pickRef.current({ kind: "group", id: z.foldId?.[k] ?? k, group: k });
        return;
      }
      const node = target.closest<SVGElement>("[data-id],[data-tr]");
      if (!node) return;
      const grp = node.dataset.grp;
      if (grp && node.dataset.id) {
        setRef.current(toggleGroup(z, { level: lv, open: op }, grp, true), node);
        pickRef.current({ kind: "group", id: node.dataset.id, group: grp });
      } else if (node.dataset.id) {
        pickRef.current({ kind: "station", id: node.dataset.id });
      } else if (node.dataset.tr) {
        pickRef.current({ kind: "track", id: node.dataset.tr });
      }
    };
    const click = (e: MouseEvent) => e.target instanceof Element && act(e.target);
    const key = (e: KeyboardEvent) => {
      if ((e.key !== "Enter" && e.key !== " ") || !(e.target instanceof Element)) return;
      if (!e.target.closest("[data-id],[data-tr],[data-fold],[data-stub]")) return;
      e.preventDefault();
      act(e.target);
    };
    // Hover or focus a line: light it, dim the rest.
    const lightOf = (t: EventTarget | null) =>
      t instanceof Element ? (t.closest<SVGElement>("[data-l]")?.dataset.l ?? null) : null;
    const over = (e: Event) => setHover(lightOf(e.target));
    const out = () => setHover(null);

    // Steps. Trackpad pinch arrives as ctrl + wheel; a plain wheel still scrolls the page.
    const step = (d: number, at?: Point | null) => {
      const { zoom: z, level: lv, open: op } = live.current;
      if (live.current.focused) return;
      const n = stepLevel(z, lv, d);
      if (n !== lv || Object.keys(op).length) setRef.current({ level: n, open: NONE }, null, at);
    };
    const svgPoint = (cx: number, cy: number): Point | null => {
      const s = svg.current;
      if (!s) return null;
      const r = s.getBoundingClientRect();
      const w = s.viewBox.baseVal.width;
      return r.width ? [((cx - r.left) * w) / r.width, ((cy - r.top) * w) / r.width] : null;
    };
    let acc = 0;
    let lock = 0;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (Date.now() < lock) return;
      acc += e.deltaY;
      if (Math.abs(acc) < 30) return;
      step(acc < 0 ? 1 : -1, svgPoint(e.clientX, e.clientY));
      acc = 0;
      lock = Date.now() + 450;
    };
    // Safari trackpad pinch.
    let gs = 1;
    const gStart = (e: Event) => {
      e.preventDefault();
      gs = 1;
    };
    const gChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      if (g.scale / gs > 1.25) {
        gs = g.scale;
        step(1, svgPoint(g.clientX, g.clientY));
      } else if (gs / g.scale > 1.25) {
        gs = g.scale;
        step(-1, svgPoint(g.clientX, g.clientY));
      }
    };
    // Touch pinch: two pointers.
    const tp = new Map<number, Point>();
    let d0 = 0;
    const dist = () => {
      const [a, b] = [...tp.values()];
      return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      tp.set(e.pointerId, [e.clientX, e.clientY]);
      if (tp.size === 2) d0 = dist();
    };
    const move = (e: PointerEvent) => {
      if (!tp.has(e.pointerId)) return;
      tp.set(e.pointerId, [e.clientX, e.clientY]);
      if (tp.size !== 2 || !d0) return;
      const r = dist() / d0;
      if (r > 1.3 || r < 0.77) {
        const [a, b] = [...tp.values()] as [Point, Point];
        step(r > 1 ? 1 : -1, svgPoint((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
        d0 = dist();
      }
    };
    const up = (e: PointerEvent) => {
      tp.delete(e.pointerId);
      d0 = 0;
    };
    const on = (t: string, f: EventListener, o?: AddEventListenerOptions) => {
      el.addEventListener(t, f, o);
      return () => el.removeEventListener(t, f, o);
    };
    const offs = [
      on("click", click as EventListener),
      on("keydown", key as EventListener),
      on("pointerover", over),
      on("focusin", over),
      on("pointerleave", out),
      on("focusout", out),
      on("wheel", wheel as EventListener, { passive: false }),
      on("gesturestart", gStart, { passive: false }),
      on("gesturechange", gChange, { passive: false }),
      on("pointerdown", down as EventListener),
      on("pointermove", move as EventListener),
      on("pointerup", up as EventListener),
      on("pointercancel", up as EventListener),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  // The glide: when the shape changes, slide what stays and grow what appears.
  const last = useRef<{ shape: string; frame: SVGSVGElement; h: number } | null>(null);
  useLayoutEffect(() => {
    const s = svg.current;
    const h = host.current;
    if (!s || !h) return;
    const shape = shapeOf(scene);
    const prev = last.current;
    last.current = { shape, frame: s.cloneNode(true) as SVGSVGElement, h: h.offsetHeight };
    if (!prev || prev.shape === shape) return;
    const layer = old.current;
    if (reduced() || !layer || typeof s.getBBox !== "function") {
      fadeIn(s);
      return;
    }
    // The old frame lies over the new one while the marks move.
    prev.frame.classList.add("old");
    // The copy shows the map as it stood: its first-load classes would draw it in again.
    prev.frame.classList.remove("ld");
    for (const n of prev.frame.querySelectorAll<SVGElement>(".num")) n.style.animation = "none";
    layer.replaceChildren(prev.frame);
    glide({ old: prev.frame, next: s, anchor: anchor.current });
    if (prev.h !== h.offsetHeight) glideHeight(h, prev.h, h.offsetHeight);
    anchor.current = null;
    const t = setTimeout(() => layer.replaceChildren(), GLIDE_MS.fade + 20);
    return () => clearTimeout(t);
  }, [scene]);

  // A map bigger than its frame pans inside it: the frame takes focus so the arrow keys scroll it.
  const stage = useRef<HTMLDivElement>(null);
  const [pans, setPans] = useState(false);
  useLayoutEffect(() => {
    const h = host.current;
    if (!h) return;
    const read = () =>
      setPans(h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(read);
    watch.observe(h);
    if (stage.current) watch.observe(stage.current);
    return () => watch.disconnect();
  }, []);

  // The legend shows while the map has a mark. Marks show at every level (a fold carries them).
  const drawsMarks = hasMarks(scene);
  const marks = scene.st.length;
  const stubs = scene.tr.filter((r) => r.stub).length;
  const caps = scene.st.filter((s) => "cap" in s || "ring" in s || "badge" in s).length;
  return (
    <div
      className={cx("metro", className)}
      data-level={level}
      {...(focus ? { "data-focus": `${focus.kind}:${focus.id}` } : {})}
    >
      {controls ? (
        <div className="metro-bar">
          {focus ? null : (
            <MetroLevels
              names={zoom.names}
              level={mixed ? null : level}
              onLevel={(n) => set({ level: n, open: NONE })}
            />
          )}
          <p className="metro-count" aria-live="polite">
            {focus ? (
              <>
                Focus on {nameOf(scene, focus)}: <b>{marks}</b> marks, <b>{stubs}</b> stubs.
              </>
            ) : (
              <>
                {mixed ? "Mixed" : zoom.names[level]}: <b>{marks}</b> marks
                {caps ? (
                  <>
                    , <b>{caps}</b> folded
                  </>
                ) : null}
                {zoom.total > marks ? (
                  <>
                    {" "}
                    of <b>{zoom.total}</b>
                  </>
                ) : null}
                .
              </>
            )}
          </p>
          {props.children}
          {drawsMarks ? <MetroLegend /> : null}
        </div>
      ) : null}
      <div
        ref={host}
        className={cx("metro-host", intro && "ld")}
        {...(pans ? { tabIndex: 0, role: "group", "aria-label": "Scrollable map" } : {})}
      >
        {drawsMarks && !controls ? <MetroLegend over /> : null}
        <div ref={stage} className="metro-stage">
          <MetroSvg
            ref={svg}
            scene={scene}
            still={still}
            intro={intro}
            selected={picked}
            lit={lit}
          />
          <div ref={old} className="metro-old" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

/** True when the scene draws a diff mark on any station or track. */
const hasMarks = (s: MetroScene) =>
  s.st.some((x) => ("mark" in x ? x.mark : false)) || s.tr.some((r) => r.mark);

const NONE: OpenMap = Object.freeze({});
const EMPTY: MetroScene = { h: 80, st: [], tr: [] };

/** The level buttons: one per level, the level shown pressed. `null`: a mix, none pressed. */
export function MetroLevels({
  names,
  level,
  onLevel,
  label = "Zoom level",
}: {
  names: readonly string[];
  level: number | null;
  onLevel: (level: number) => void;
  label?: string;
}) {
  return (
    <fieldset className="metro-levels" aria-label={label}>
      {names.map((n, i) => (
        <button key={n} type="button" aria-pressed={level === i} onClick={() => onLevel(i)}>
          {n}
        </button>
      ))}
    </fieldset>
  );
}

const MARKS: Mark[] = ["added", "changed", "removed"];

/**
 * The three diff marks and their words. `MetroMap` draws it when its scene has a mark: in the
 * controls bar, or over the map's top corner when the bar is off. It takes no room from the map.
 */
export function MetroLegend({ over }: { over?: boolean | undefined }) {
  return (
    <ul className={cx("metro-legend", over && "over")} aria-label="Diff marks">
      {MARKS.map((m) => (
        <li key={m}>
          <span className="metro-tag" data-mark={m} aria-hidden="true">
            {MARK_GLYPH[m]}
          </span>
          {MARK_WORD[m][0]?.toUpperCase()}
          {MARK_WORD[m].slice(1)}
        </li>
      ))}
    </ul>
  );
}
