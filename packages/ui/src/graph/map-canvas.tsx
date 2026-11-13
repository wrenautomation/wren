/**
 * The Map (designs/2026-11-12-explorer.md, Map): boxes nest as the folders nest; a line bundles
 * the links between two shown boxes. One elk call lays it out (map-layout.ts); GraphFrame pans
 * and zooms. A fold change glides (orrery): what stays slides, what opens grows out of the box
 * clicked, what closes shrinks into it; under 300 ms (MV-9).
 */
import { fadeIn, glide, type Marks } from "@wrenautomation/orrery";
import {
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Position,
} from "@xyflow/react";
import { cn } from "cn";
import {
  createContext,
  type KeyboardEvent,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { iconOf } from "../explorer-rows.js";
import { Icon } from "../icons.js";
import { GraphFrame } from "./frame.js";
import {
  countText,
  layoutMap,
  type MapBoxIn,
  type MapIn,
  type MapLaid,
  type MapLineIn,
  type MapRect,
  metaOf,
  titleOf,
} from "./map-layout.js";
import type { Point } from "./model.js";

/** What the viewer picked: a box (open or closed) or a line. */
export type MapPick = { kind: "box"; path: string } | { kind: "line"; id: string };

export interface MapCanvasProps {
  map: MapIn;
  label: string;
  /** Open or close a box: the page asks for the next map. */
  onOpen: (path: string, open: boolean) => void;
  picked?: MapPick | null | undefined;
  onPick?: ((p: MapPick | null) => void) | undefined;
  /** The frame's height (px). */
  height?: number | undefined;
  /** The layout's time (ms), for the page's own measure. */
  onLaid?: ((ms: number) => void) | undefined;
  /** In a frame that has its own border (Explorer's) */
  flush?: boolean | undefined;
}

/** MV-9: the Map's motion holds under 300 ms. */
const MS = { move: 280, fade: 150, shrink: 240 } as const;
const PAD = 20;
const TOOLS_ROOM = 40;
/** The least it zooms at rest, so a 13 px name stays readable; past that it pans. */
const LEAST = { wide: 0.55, narrow: 0.75 } as const;
/** Under this frame width the layout runs top to bottom (the Explorer's own narrow cut). */
const NARROW = 720;
/** A line's stroke (px): its own log scale; RIBBON's 48 px is for a funnel. */
const STROKE = { min: 2, max: 8 } as const;

const under = (path: string, top: string) => path === top || path.startsWith(`${top}/`);

/** Glide marks: each box's inner div; React Flow's own transform stays on the node. */
const MAP_MARKS: Marks = {
  select: "[data-map]",
  key: (n) => (n as HTMLElement).dataset.map ?? null,
  fresh: ".react-flow__edge,.map-count",
  // the viewport's scale: a mark's transform is in map units
  units: (frame) => {
    const z = /scale\(([\d.]+)\)/.exec((frame as HTMLElement).style?.transform ?? "")?.[1];
    return z ? 1 / Number(z) : 1;
  },
};

interface Shared {
  picked: MapPick | null;
  /** Ends of the picked line, or of the picked box's lines. */
  ends: ReadonlySet<string>;
  lit: ReadonlySet<string> | null;
  box: (b: MapBoxIn) => void;
  close: (b: MapBoxIn) => void;
  line: (id: string) => void;
}
const SharedCtx = createContext<Shared | null>(null);
const useShared = () => {
  const s = useContext(SharedCtx);
  if (!s) throw new Error("MapCanvas parts render inside MapCanvas");
  return s;
};

type BoxData = { box: MapBoxIn; meta: string; top: number };
type LineData = {
  line: MapLineIn;
  points: Point[];
  label?: Point | undefined;
  width: number;
};

/** React Flow draws an edge only between handles; a line's route is elk's, so these never show. */
const END = "pointer-events-none! invisible! size-px! min-h-0! min-w-0! border-0!";
function MapBox(props: NodeProps<Node<BoxData>>) {
  return (
    <>
      <BoxBody {...props} />
      <Handle type="target" position={Position.Left} isConnectable={false} className={END} />
      <Handle type="source" position={Position.Right} isConnectable={false} className={END} />
    </>
  );
}

function BoxBody({ data }: NodeProps<Node<BoxData>>) {
  const g = useShared();
  const b = data.box;
  const picked = g.picked?.kind === "box" && g.picked.path === b.path;
  const end = !picked && g.ends.has(b.path);
  // always drawn, clear until lit: the color eases in
  const ring = cn(
    "transition-[outline-color,background-color] duration-150",
    picked
      ? "outline-2 outline-offset-2 outline-(--ui-active)"
      : // an end: its own border darkens, no second ring
        end
        ? "outline-1 -outline-offset-1 outline-(--ui-ink-2)"
        : "outline-2 outline-offset-2 outline-transparent",
  );
  const count = b.count != null && !b.leaf ? b.count.toLocaleString("en-US") : "";
  const esc = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    g.close(b);
  };
  if (b.open)
    return (
      <div
        data-map={`b:${b.path}`}
        data-open=""
        data-picked={picked ? "" : undefined}
        className={cn(
          "h-full w-full border border-(--ui-hair) bg-[color-mix(in_oklch,var(--ui-tile)_60%,transparent)]",
          ring,
        )}
      >
        <div className="flex items-start gap-2 px-3 pt-2" style={{ minHeight: data.top - 6 }}>
          <Icon name={iconOf(b.kind)} size={15} className="mt-[3px] shrink-0 text-(--ui-ink-3)" />
          <button
            type="button"
            onClick={() => g.box(b)}
            onKeyDown={esc}
            className="min-w-0 flex-1 cursor-pointer pt-px text-left text-[13px] leading-[18px] font-medium wrap-anywhere text-(--ui-ink) outline-none focus-visible:underline"
          >
            {b.name}
            {count ? (
              <span className="ml-2 font-normal text-(--ui-ink-3) tabular-nums">{count}</span>
            ) : null}
          </button>
          <button
            type="button"
            aria-label={`Close ${b.name}`}
            title="Close"
            onClick={() => g.close(b)}
            onKeyDown={esc}
            // a finger gets 44 px without moving the title
            className="relative grid size-7 shrink-0 cursor-pointer place-items-center text-(--ui-ink-3) transition-colors duration-150 hover:bg-(--ui-fill) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-(--ui-focus) pointer-coarse:after:absolute pointer-coarse:after:-inset-2"
          >
            <Icon name="shrink" size={14} />
          </button>
        </div>
      </div>
    );
  return (
    <button
      type="button"
      data-map={`b:${b.path}`}
      data-full={b.full ? "" : undefined}
      data-picked={picked ? "" : undefined}
      aria-expanded={b.leaf || b.full ? undefined : false}
      onClick={() => g.box(b)}
      className={cn(
        "flex h-full w-full cursor-pointer flex-col items-stretch border border-(--ui-hair) px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-(--ui-focus)",
        b.full ? "bg-(--ui-warn-tint)" : "bg-(--ui-paper) hover:bg-(--ui-fill)",
        ring,
      )}
    >
      <span className="flex items-start gap-2">
        <Icon name={iconOf(b.kind)} size={15} className="mt-[2px] shrink-0 text-(--ui-ink-3)" />
        <span className="min-w-0 text-[13px] leading-[18px] font-medium wrap-anywhere text-(--ui-ink)">
          {b.name}
        </span>
      </span>
      {data.meta ? (
        <span
          className={cn(
            "text-[12px] leading-4 wrap-anywhere tabular-nums",
            b.full ? "flex gap-1 text-(--ui-warn-ink)" : "text-(--ui-ink-3)",
          )}
        >
          {b.full ? <Icon name="warn" size={12} className="mt-0.5 shrink-0" /> : null}
          {data.meta}
        </span>
      ) : null}
    </button>
  );
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const toward = (p: Point, q: Point, r: number) => {
  const l = dist(p, q) || 1;
  return { x: p.x + ((q.x - p.x) * r) / l, y: p.y + ((q.y - p.y) * r) / l };
};

/** Elk's orthogonal route with round bends, cut short for the arrowhead. */
export function routeOf(pts: readonly Point[], cut: number): { d: string; head: string } {
  const b = pts.at(-1);
  const a = pts.at(-2);
  if (!a || !b) return { d: "", head: "" };
  const len = dist(a, b) || 1;
  const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
  const end = { x: b.x - ux * cut, y: b.y - uy * cut };
  const all = [...pts.slice(0, -1), end];
  let d = `M${all[0]?.x},${all[0]?.y}`;
  for (let i = 1; i < all.length - 1; i++) {
    const [prev, p, next] = [all[i - 1], all[i], all[i + 1]] as [Point, Point, Point];
    const r = Math.min(6, dist(prev, p) / 2, dist(p, next) / 2);
    const [p1, p2] = [toward(p, prev, r), toward(p, next, r)];
    d += ` L${p1.x},${p1.y} Q${p.x},${p.y} ${p2.x},${p2.y}`;
  }
  d += ` L${end.x},${end.y}`;
  const w = cut * 0.55;
  const head = `M${b.x},${b.y} L${end.x - uy * w},${end.y + ux * w} L${end.x + uy * w},${end.y - ux * w} Z`;
  return { d, head };
}

const relsText = (rels: Record<string, number>) =>
  Object.entries(rels)
    .sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `${k} ${n.toLocaleString("en-US")}`)
    .join(" · ");

function MapLine({ id, data }: EdgeProps<Edge<LineData>>) {
  const g = useShared();
  const route = useMemo(() => (data ? routeOf(data.points, 6 + data.width) : null), [data]);
  if (!data || !route) return null;
  const picked = g.picked?.kind === "line" && g.picked.id === id;
  const dim = g.lit !== null && !g.lit.has(id);
  const n = countText(data.line.count);
  const say = `${data.line.count.toLocaleString("en-US")} ${data.line.count === 1 ? "link" : "links"}: ${relsText(data.line.rels)}`;
  return (
    <>
      <g
        data-line={id}
        className="transition-[opacity,color] duration-200 ease-(--ui-ease) motion-reduce:transition-none"
        style={{
          opacity: dim ? 0.25 : picked || g.lit ? 0.95 : 0.6,
          color: picked ? "var(--ui-active)" : g.lit && !dim ? "var(--ui-ink)" : "var(--ui-ink-3)",
        }}
      >
        <title>{say}</title>
        <path
          d={route.d}
          className="fill-none stroke-current transition-[stroke-width] duration-200 ease-(--ui-ease) [stroke-linecap:round] motion-reduce:transition-none"
          // picked: thick enough to find at a glance, even a 1-link line
          style={{ strokeWidth: picked ? Math.max(2.5, data.width + 1) : data.width }}
        />
        <path d={route.head} className="fill-current" />
      </g>
      {/* a wide clear stroke: easy to hover and click; keys reach links through the Explorer's relation folders */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer only, see above */}
      <path
        d={route.d}
        className="cursor-pointer fill-none stroke-transparent [pointer-events:stroke]"
        style={{ strokeWidth: Math.max(14, data.width + 8) }}
        onClick={(e) => {
          e.stopPropagation();
          g.line(id);
        }}
      />
      {n && data.label ? (
        <EdgeLabelRenderer>
          <span
            className={cn(
              // above the lines (z 1000): a crossing line never covers the count
              "map-count pointer-events-none absolute top-0 left-0 z-[1001] h-[18px] rounded-full bg-(--ui-paper) px-1.5 text-[11px] leading-[18px] text-(--ui-ink-2) tabular-nums shadow-[inset_0_0_0_1px_var(--ui-hair)] transition-opacity duration-200",
              picked && "text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-active)]",
              dim && "opacity-25",
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${data.label.x}px, ${data.label.y}px)`,
            }}
          >
            {n}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const NODE_TYPES = { box: MapBox };
const EDGE_TYPES = { line: MapLine };

/** One note's row (px): 16 px text, 2 px pad each side, 4 px gap. */
const NOTE_ROW = 24;
const outsideOf = (map: MapIn) => Object.entries(map.outside).filter(([, n]) => n > 0);

const reduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Boxes parent first (React Flow's order), with their depth for the z order. */
function nodesOf(map: MapIn, at: MapLaid): Node<BoxData>[] {
  const kids = new Map<string, MapBoxIn[]>();
  for (const b of map.boxes) kids.set(b.parent, [...(kids.get(b.parent) ?? []), b]);
  const out: Node<BoxData>[] = [];
  const walk = (parent: string, depth: number) => {
    for (const b of kids.get(parent) ?? []) {
      const r = at.boxes[b.path];
      if (!r) continue;
      const open = b.open && !!kids.get(b.path)?.length;
      out.push({
        id: b.path,
        type: "box",
        position: { x: r.x, y: r.y },
        width: r.width,
        height: r.height,
        zIndex: depth,
        // React Flow drops pointer events on a node that is not selectable
        style: { pointerEvents: "all" },
        ...(parent !== map.root ? { parentId: parent } : {}),
        data: {
          box: open ? b : { ...b, open: false },
          meta: metaOf(b, map.inside[b.path] ?? 0),
          top: r.top ?? titleOf(b).top,
        },
      });
      if (open) walk(b.path, depth + 1);
    }
  };
  walk(map.root, 0);
  return out;
}

function edgesOf(map: MapIn, at: MapLaid): Edge<LineData>[] {
  const drawn = map.lines.filter((l) => at.lines[l.id]);
  const most = Math.max(1, ...drawn.map((l) => l.count));
  return drawn.flatMap((l) => {
    const r = at.lines[l.id];
    if (!r) return [];
    const width =
      most > 1
        ? STROKE.min + ((STROKE.max - STROKE.min) * Math.log(l.count)) / Math.log(most)
        : STROKE.min;
    // over every box: elk routes around them, and a line inside a frame must show
    return [
      {
        id: l.id,
        type: "line",
        source: l.from,
        target: l.to,
        zIndex: 1000,
        data: { line: l, points: r.points, label: r.label, width },
      },
    ];
  });
}

/** A box's place in map units: its own offset plus every open box it sits in. */
function placeOf(laid: { map: MapIn; at: MapLaid }, path: string): MapRect | null {
  const own = laid.at.boxes[path];
  if (!own) return null;
  const parent = laid.map.boxes.find((b) => b.path === path)?.parent;
  const up = parent && parent !== laid.map.root ? placeOf(laid, parent) : null;
  return up ? { ...own, x: own.x + up.x, y: own.y + up.y } : own;
}

export default function MapCanvas({
  map,
  label,
  onOpen,
  picked = null,
  onPick,
  height = 560,
  onLaid,
  flush,
}: MapCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [laid, setLaid] = useState<{ map: MapIn; at: MapLaid } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // a layout past 150 ms: the last frame dims and a ring shows
  const [slow, setSlow] = useState(false);
  const [width, setWidth] = useState(0);
  // the box clicked: what opens grows out of it, what closes shrinks into it
  const anchor = useRef<string | null>(null);
  // the last frame, frozen over the map until the new one is in
  const frozen = useRef<HTMLElement | null>(null);
  // a phone: the map runs top to bottom, so it zooms less
  const narrow = width > 0 && width < NARROW;
  const laidAt = useRef(onLaid);
  laidAt.current = onLaid;

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const measured = width > 0;
  useEffect(() => {
    // read-ok: elk lays out the map it was handed, in the browser; no server read
    // the width picks the direction: lay out once it is known
    if (!measured) return;
    let live = true;
    const t0 = performance.now();
    const late = setTimeout(() => setSlow(true), 150);
    layoutMap(map, narrow ? "DOWN" : "RIGHT").then(
      (at) => {
        if (!live) return;
        clearTimeout(late);
        setSlow(false);
        laidAt.current?.(Math.round(performance.now() - t0));
        const view = host.current?.querySelector<HTMLElement>(".react-flow__viewport");
        if (view && ghost.current && !reduced()) {
          const copy = view.cloneNode(true) as HTMLElement;
          ghost.current.replaceChildren(copy);
          view.style.visibility = "hidden";
          frozen.current = copy;
        }
        setFailed(null);
        setLaid({ map, at });
      },
      (e: unknown) => {
        if (!live) return;
        clearTimeout(late);
        setSlow(false);
        setFailed(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
      clearTimeout(late);
    };
  }, [map, narrow, measured]);

  // React Flow takes the new nodes a frame later: glide once they are in
  useEffect(() => {
    if (!laid) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    let f = requestAnimationFrame(() => {
      f = requestAnimationFrame(() => {
        const next = host.current?.querySelector<HTMLElement>(".react-flow__viewport");
        const old = frozen.current;
        frozen.current = null;
        if (!next) return;
        next.style.visibility = "";
        // first frame, or reduced motion: a fade, no glide
        if (!old) {
          fadeIn(next);
          return;
        }
        const stay = glide({ old, next, marks: MAP_MARKS, anchorKey: anchor.current, ms: MS });
        anchor.current = null;
        t = setTimeout(() => ghost.current?.replaceChildren(), stay + 20);
      });
    });
    return () => {
      cancelAnimationFrame(f);
      if (t) clearTimeout(t);
    };
  }, [laid]);

  const nodes = useMemo(() => (laid ? nodesOf(laid.map, laid.at) : []), [laid]);
  const edges = useMemo(() => (laid ? edgesOf(laid.map, laid.at) : []), [laid]);

  const shared = useMemo<Shared>(() => {
    const lines = laid?.map.lines ?? [];
    let lit: Set<string> | null = null;
    const ends = new Set<string>();
    if (picked?.kind === "line") {
      lit = new Set([picked.id]);
      const l = lines.find((x) => x.id === picked.id);
      if (l) for (const p of [l.from, l.to]) ends.add(p);
    } else if (picked?.kind === "box") {
      const mine = lines.filter((l) => under(l.from, picked.path) || under(l.to, picked.path));
      lit = new Set(mine.map((l) => l.id));
      for (const l of mine) for (const p of [l.from, l.to]) ends.add(p);
    }
    return {
      picked,
      ends,
      lit,
      box: (b) => {
        anchor.current = `b:${b.path}`;
        onPick?.({ kind: "box", path: b.path });
        if (!b.open && !b.leaf && !b.full) onOpen(b.path, true);
      },
      close: (b) => {
        anchor.current = `b:${b.path}`;
        onOpen(b.path, false);
      },
      line: (id) => onPick?.({ kind: "line", id }),
    };
  }, [laid, picked, onPick, onOpen]);

  // the box to rest on when the map overflows: the pick as the layout lands, not each later pick
  const pickedNow = useRef(picked);
  pickedNow.current = picked;
  const view = useMemo(() => {
    if (!laid || !width) return null;
    const { width: w, height: h } = laid.at;
    const room = Math.max(1, width - 2 * PAD);
    // the notes at the top (no links, links out) keep the map below them
    const notes = Math.max(laid.map.lines.length ? 0 : 1, outsideOf(laid.map).length);
    const top = PAD + (notes ? notes * NOTE_ROW + 4 : 0);
    const tall = Math.max(1, height - top - PAD - TOOLS_ROOM);
    const zoom = Math.max(
      narrow ? LEAST.narrow : LEAST.wide,
      Math.min(1, room / Math.max(1, w), tall / Math.max(1, h)),
    );
    const fits = w * zoom <= room + 1 && h * zoom <= tall + 1;
    const p = pickedNow.current;
    const at = !fits && p?.kind === "box" ? placeOf(laid, p.path) : null;
    // the axis that overflows centers the pick, kept inside the map's own edges
    const onPick = (start: number, free: number, size: number, mid: number) =>
      free >= 0
        ? start + free / 2
        : Math.min(start, Math.max(start + free, start + free / 2 + (size / 2 - mid) * zoom));
    return {
      // centered when it all fits; past the frame it rests on the pick, else top left
      rest: fits
        ? { x: PAD + (room - w * zoom) / 2, y: top + Math.max(0, (tall - h * zoom) / 2), zoom }
        : at
          ? {
              x: onPick(PAD, room - w * zoom, w, at.x + at.width / 2),
              y: onPick(top, Math.min(0, tall - h * zoom), h, at.y + at.height / 2),
              zoom,
            }
          : { x: PAD + Math.max(0, (room - w * zoom) / 2), y: top, zoom },
      fits,
    };
  }, [laid, width, height, narrow]);

  const outside = outsideOf(map);
  return (
    <div ref={host} className="w-full min-w-0" data-map-root={map.root}>
      {failed ? (
        <p role="alert" className="text-[14px] text-(--ui-bad)">
          The Map could not be drawn: {failed}
        </p>
      ) : !map.boxes.length ? (
        <p className="text-[14px] text-(--ui-ink-2)">Nothing here to draw.</p>
      ) : !view ? (
        <div
          className={cn("w-full bg-(--ui-tile)", !flush && "border border-(--ui-hair)")}
          style={{ height }}
          role="status"
          aria-busy="true"
          aria-label="Drawing the Map"
        />
      ) : (
        <SharedCtx.Provider value={shared}>
          <GraphFrame
            label={label}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            height={height}
            rest={view.rest}
            fits={view.fits}
            flush={flush}
            minimap={!view.fits}
            flow={{ onPaneClick: () => onPick?.(null) }}
            className={cn("transition-opacity duration-150 ease-(--ui-ease)", slow && "opacity-60")}
          >
            {slow ? (
              <span
                role="status"
                aria-label="Laying out the Map"
                className="absolute top-2 left-2 size-4 animate-spin rounded-full border-2 border-(--ui-hair) border-t-(--ui-ink-2) motion-reduce:animate-none"
              />
            ) : !map.lines.length ? (
              <p className="pointer-events-none absolute top-2 left-2 bg-(--ui-paper) px-2 py-0.5 text-[12px] leading-4 text-(--ui-ink-2) shadow-[inset_0_0_0_1px_var(--ui-hair)]">
                No links between these
              </p>
            ) : null}
            <div
              ref={ghost}
              aria-hidden="true"
              className="react-flow pointer-events-none absolute inset-0 overflow-hidden"
            />
            {outside.length ? (
              <ul className="pointer-events-none absolute top-2 right-2 flex flex-col items-end gap-1">
                {outside.map(([root, n]) => (
                  <li
                    key={root}
                    className="bg-(--ui-paper) px-2 py-0.5 text-[12px] leading-4 text-(--ui-ink-2) tabular-nums shadow-[inset_0_0_0_1px_var(--ui-hair)]"
                  >
                    {n.toLocaleString("en-US")} {n === 1 ? "link" : "links"} to {root}
                  </li>
                ))}
              </ul>
            ) : null}
          </GraphFrame>
        </SharedCtx.Provider>
      )}
    </div>
  );
}
