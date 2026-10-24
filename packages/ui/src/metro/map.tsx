/**
 * `MetroMap`: a metro map you can fold. It draws a `MetroZoom` (or a scene, or a view) at a depth
 * of its fold tree (tree.ts) and takes the viewer's folds. Props only: it fetches nothing.
 *
 * `depth` and `open` are controlled when the parent passes them (with `onDepth`, `onOpen`) and
 * kept here when it does not. Hover or focus on a line lights it; Enter or Space on a mark picks it
 * or opens its node; a wheel with ctrl or meta, a Safari pinch, a touch pinch and the − + buttons
 * step the depth. A view lays out async: the map keeps the last scene until the next one is ready,
 * and shows the skeleton on the first load.
 *
 * Scale: one scene px is one css px. The host centres a map smaller than itself across its width,
 * at the top, and scrolls a map wider or taller than itself, so a label reads at its real size on any
 * screen.
 */
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../controls.js";
import { cx } from "../format.js";
import { MetroSvg } from "./draw.js";
import { type FocusSpec, focusScene, nameOf, partsOfSpec, specKey } from "./focus.js";
import { autoZoom, type MetroZoom, viewZoom } from "./fold.js";
import { centreOf, fadeIn, glide, glideHeight } from "./glide.js";
import { MARK_GLYPH, MARK_WORD } from "./marks.js";
import { MetroSkeleton } from "./skeleton.js";
import {
  allOpen,
  type Fold,
  type FoldNode,
  fullDepth,
  type OpenMap,
  openKey,
  openSet,
  pathTo,
  stepDepth,
  toggle,
} from "./tree.js";
import type { Mark, MetroPart, MetroScene, Point } from "./types.js";
import type { MetroView } from "./view.js";
import "./metro.css";

/** What the viewer picked: a station or a folded mark, a track, or a node they closed. */
export interface MetroPick {
  kind: "station" | "track" | "group";
  id: string;
  /** For a station or folded mark: its fold node, when it has one. */
  group?: string | undefined;
}

export interface MetroMapProps {
  /** What to draw. One of: zoom (a fold tree), scene (placed), view (laid out by ELK). */
  zoom?: MetroZoom | undefined;
  scene?: MetroScene | undefined;
  view?: MetroView | undefined;

  /** The depth cut: nodes above it show open. Controlled with `onDepth`; `defaultDepth` when not. */
  depth?: number | undefined;
  defaultDepth?: number | undefined;
  onDepth?: ((depth: number) => void) | undefined;
  /** Nodes opened (true) or closed (false) by hand, over the cut. Controlled with `onOpen`. */
  open?: OpenMap | undefined;
  onOpen?: ((open: OpenMap) => void) | undefined;

  /** Enter, Space or a click on a mark or track. */
  onPick?: ((pick: MetroPick) => void) | undefined;
  /** The picked id. Controlled when passed. */
  selected?: string | null | undefined;
  /** A line to light from outside (a task list). Hover on the map lights lines when it is not passed. */
  lit?: string | null | undefined;

  /** The depth buttons, the path and the count line. Default: on. */
  controls?: boolean | undefined;
  /**
   * Draw one part only (a line, group, station or flow), or a set of parts, and a faded stub for
   * each track that crosses the edge. Shows every station inside, whatever the depth.
   */
  focus?: FocusSpec | null | undefined;
  /** A click, Enter or Space on a stub: the part on its far side. */
  onStub?: ((part: MetroPart) => void) | undefined;
  /** No dots move. */
  still?: boolean | undefined;
  /** No dot grid under the map. */
  bare?: boolean | undefined;
  /** The first-load draw-in. Default: on. Off for stories and tests. Never on a fold. */
  intro?: boolean | undefined;
  className?: string | undefined;
  /** More controls beside the depth buttons. */
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

/**
 * A zoom's scenes, one per open set. A sync scene comes back at once; an async one comes back
 * `undefined` the first time and calls `ready` when it lands.
 */
function useScenes(zoom: MetroZoom) {
  const [, bump] = useState(0);
  // A new zoom starts a new cache.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the zoom keys the cache
  const cache = useMemo(
    () => ({ done: new Map<string, MetroScene>(), out: new Set<string>() }),
    [zoom],
  );
  return (open: ReadonlySet<string>): MetroScene | undefined => {
    const k = openKey(open);
    const hit = cache.done.get(k);
    if (hit || cache.out.has(k)) return hit;
    const r = zoom.scene(open);
    if (!(r instanceof Promise)) {
      cache.done.set(k, r);
      return r;
    }
    cache.out.add(k);
    r.then(
      (s) => {
        cache.done.set(k, s);
        cache.out.delete(k);
        bump((n) => n + 1);
      },
      (e: unknown) => {
        cache.out.delete(k);
        console.error("metro layout", e);
      },
    );
    return undefined;
  };
}

export function MetroMap(props: MetroMapProps) {
  const { onPick, controls = true, still, bare, className } = props;
  const zoom = useMemo<MetroZoom>(
    () =>
      props.zoom ??
      (props.scene ? autoZoom(props.scene) : props.view ? viewZoom(props.view) : autoZoom(EMPTY)),
    [props.zoom, props.scene, props.view],
  );
  const [depth, setDepth] = useControlled(props.depth, props.defaultDepth ?? 0);
  const [open, setOpen] = useControlled<OpenMap>(props.open, NONE);
  const [pickedOwn, setPicked] = useState<string | null>(null);
  const picked = props.selected !== undefined ? props.selected : pickedOwn;
  const [hover, setHover] = useState<string | null>(null);
  const lit = props.lit !== undefined ? props.lit : hover;

  const focus = props.focus ?? null;
  // A focused part shows all its stations: every node open.
  const shown = useMemo(
    () => (focus ? allOpen(zoom.nodes) : openSet(zoom.nodes, { depth, open })),
    [zoom, depth, open, focus],
  );
  const sceneOf = useScenes(zoom);
  const now = sceneOf(shown);
  // While the next fold lays out, the last one stays.
  const held = useRef<MetroScene | null>(null);
  if (now) held.current = now;
  const base = now ?? held.current;
  const scene = useMemo(
    () => (base && focus ? focusScene(base, focus) : (base ?? EMPTY)),
    [base, focus],
  );
  const full = useMemo(() => fullDepth(zoom.nodes), [zoom]);
  const mixed = Object.keys(open).length > 0;

  // The first load happens once, on mount. A fold or a refresh never brings it back.
  const [intro, setIntro] = useState(props.intro !== false);
  // A new shape inside the window (a focus, a view, a fold) ends it before the marks are drawn.
  const first = useRef<string | null>(null);
  const shape = shapeOf(scene);
  if (first.current === null && base) first.current = shape;
  if (intro && first.current !== null && shape !== first.current) setIntro(false);
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(t);
  }, [intro]);

  // Callbacks and state the native listeners read; they never go stale.
  const live = useRef({ depth, open, zoom, onPick, onStub: props.onStub, focused: !!focus });
  live.current = { depth, open, zoom, onPick, onStub: props.onStub, focused: !!focus };
  const anchor = useRef<Point | null>(null);
  const anchorKey = useRef<string | null>(null);
  /** Where the map stood on the screen when a fold began: the old frame lies there while it glides. */
  const was = useRef<DOMRect | null>(null);
  const set = (next: Fold, from?: Element | null, at?: Point | null, into?: string) => {
    anchor.current = at ?? centreOf(from ?? null);
    was.current = svg.current?.getBoundingClientRect() ?? null;
    anchorKey.current = into ?? null;
    setIntro(false);
    setDepth(next.depth);
    setOpen(next.open);
    if (next.depth !== depth) props.onDepth?.(next.depth);
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
      const { zoom: z, depth: d, open: op } = live.current;
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
        // The stations go back into the circle the group folds into.
        const id = z.foldId?.[k] ?? k;
        setRef.current(toggle(z.nodes, { depth: d, open: op }, k, false), fold, null, `i:${id}`);
        pickRef.current({ kind: "group", id, group: k });
        return;
      }
      const node = target.closest<SVGElement>("[data-id],[data-tr]");
      if (!node) return;
      const grp = node.dataset.grp;
      if (grp && node.dataset.id) {
        setRef.current(toggle(z.nodes, { depth: d, open: op }, grp, true), node);
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
    const step = (by: number, at?: Point | null) => {
      const { zoom: z, depth: d, open: op } = live.current;
      if (live.current.focused) return;
      const next = stepDepth(z.nodes, d, by);
      if (next.depth !== d || Object.keys(op).length) setRef.current(next, null, at);
    };
    let acc = 0;
    let lock = 0;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (Date.now() < lock) return;
      acc += e.deltaY;
      if (Math.abs(acc) < 30) return;
      step(acc < 0 ? 1 : -1, [e.clientX, e.clientY]);
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
        step(1, [g.clientX, g.clientY]);
      } else if (gs / g.scale > 1.25) {
        gs = g.scale;
        step(-1, [g.clientX, g.clientY]);
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
        step(r > 1 ? 1 : -1, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
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
  const last = useRef<{ shape: string; frame: SVGSVGElement; h: number; at: DOMRect } | null>(
    null,
  );
  useLayoutEffect(() => {
    const s = svg.current;
    const h = host.current;
    if (!s || !h) return;
    const shape = shapeOf(scene);
    const prev = last.current;
    last.current = {
      shape,
      frame: s.cloneNode(true) as SVGSVGElement,
      h: h.offsetHeight,
      at: s.getBoundingClientRect(),
    };
    const at = was.current ?? prev?.at;
    was.current = null;
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
    // It lies where the map stood, whatever the new map's size and place: no jump on the swap.
    if (at) {
      const box = layer.getBoundingClientRect();
      Object.assign(prev.frame.style, {
        position: "absolute",
        left: `${at.left - box.left}px`,
        top: `${at.top - box.top}px`,
        width: `${at.width}px`,
        height: `${at.height}px`,
        maxWidth: "none",
        maxHeight: "none",
        minWidth: "0",
      });
    }
    const stay = glide({
      old: prev.frame,
      next: s,
      anchor: anchor.current,
      anchorKey: anchorKey.current,
    });
    if (prev.h !== h.offsetHeight) glideHeight(h, prev.h, h.offsetHeight);
    anchor.current = null;
    anchorKey.current = null;
    const t = setTimeout(() => layer.replaceChildren(), stay + 20);
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

  // The legend shows while the map has a mark. Marks show at every depth (a fold carries them).
  const drawsMarks = hasMarks(scene);
  const marks = scene.st.length;
  const stubs = scene.tr.filter((r) => r.stub).length;
  const caps = scene.st.filter((s) => "cap" in s || "ring" in s || "badge" in s).length;
  return (
    <div
      className={cx("metro", className)}
      data-depth={depth}
      {...(focus ? { "data-focus": specKey(focus) } : {})}
    >
      {controls ? (
        <div className="metro-bar">
          {focus || !full ? null : (
            <MetroDepth nodes={zoom.nodes} fold={{ depth, open }} onFold={(f) => set(f)} />
          )}
          <p className="metro-count" aria-live="polite">
            {focus ? (
              <>
                Focus on{" "}
                {partsOfSpec(focus)
                  .map((p) => nameOf(scene, p))
                  .join(" + ")}
                : <b>{marks}</b> marks, <b>{stubs}</b> stubs.
              </>
            ) : (
              <>
                {mixed ? "Mixed" : `Depth ${Math.min(depth, full)} of ${full}`}: <b>{marks}</b>{" "}
                marks
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
        // The map pans both ways on purpose (look.ts).
        data-look-scroll
        {...(pans ? { tabIndex: 0, role: "group", "aria-label": "Scrollable map" } : {})}
      >
        {drawsMarks && !controls ? <MetroLegend over /> : null}
        {base ? (
          <div ref={stage} className="metro-stage">
            <MetroSvg
              ref={svg}
              scene={scene}
              still={still}
              bare={bare}
              intro={intro}
              selected={picked}
              lit={lit}
            />
            <div ref={old} className="metro-old" aria-hidden="true" />
          </div>
        ) : (
          <MetroSkeleton />
        )}
      </div>
    </div>
  );
}

/** True when the scene draws a diff mark on any station or track. */
const hasMarks = (s: MetroScene) =>
  s.st.some((x) => ("mark" in x ? x.mark : false)) || s.tr.some((r) => r.mark);

const NONE: OpenMap = Object.freeze({});
const EMPTY: MetroScene = { h: 80, st: [], tr: [] };

const MARKS: Mark[] = ["added", "changed", "removed"];

/** The node opened by hand last, while it shows: the path shows its way down. */
function trailOf(nodes: readonly FoldNode[], fold: Fold, shown: ReadonlySet<string>) {
  const ids = new Set(nodes.map((n) => n.id));
  const hand = Object.entries(fold.open).filter(([k, on]) => on && ids.has(k) && shown.has(k));
  return hand.at(-1)?.[0] ?? null;
}

export interface MetroDepthProps {
  nodes: readonly FoldNode[];
  fold: Fold;
  onFold: (fold: Fold) => void;
}

/**
 * The fold controls: − and + step the depth cut, and the path names the node opened last. A crumb
 * closes what sits under it; Map closes all. `MetroMap` draws it in its bar; a page that hides the
 * bar draws it where it wants.
 */
export function MetroDepth({ nodes, fold, onFold }: MetroDepthProps) {
  const full = fullDepth(nodes);
  const mixed = Object.keys(fold.open).length > 0;
  const shown = openSet(nodes, fold);
  const trail = trailOf(nodes, fold, shown);
  const crumbs = trail ? pathTo(nodes, trail) : [];
  const upTo = (id: string) => {
    let next = fold;
    for (const n of nodes)
      if (n.parent === id && shown.has(n.id)) next = toggle(nodes, next, n.id, false);
    // The crumb stays the end of the path.
    const { [id]: _, ...rest } = next.open;
    onFold({ depth: next.depth, open: { ...rest, [id]: true } });
  };
  if (!full) return null;
  return (
    <fieldset className="metro-depth" aria-label="Fold depth">
      <Button
        size="dense"
        aria-label="Fold one level"
        disabled={fold.depth <= 0 && !mixed}
        onClick={() => onFold(stepDepth(nodes, fold.depth, -1))}
      >
        −
      </Button>
      <Button
        size="dense"
        aria-label="Open one level"
        disabled={fold.depth >= full && !mixed}
        onClick={() => onFold(stepDepth(nodes, fold.depth, 1))}
      >
        +
      </Button>
      <fieldset className="metro-path" aria-label="Fold path">
        <button type="button" onClick={() => onFold({ depth: 0, open: {} })}>
          Map
        </button>
        {crumbs.map((n) => (
          <button
            type="button"
            key={n.id}
            onClick={() => upTo(n.id)}
            aria-current={n.id === trail ? "location" : undefined}
          >
            {n.label}
          </button>
        ))}
      </fieldset>
    </fieldset>
  );
}

/**
 * The three diff marks and their words. `MetroMap` draws it when its scene has a mark: in the
 * controls bar, or over the map's top corner when the bar is off. It takes no room from the map.
 */
export function MetroLegend({ over }: { over?: boolean | undefined }) {
  return (
    <ul
      className={cx("metro-legend", over && "over")}
      aria-label="Diff marks"
      // Over the map's corner by design: the map pans out from under it (look.ts).
      {...(over ? { "data-look-over": "" } : {})}
    >
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
