/**
 * A graph from the kit: elk lays out the nodes and wires, the frame pans and zooms it. Each node
 * shows its name, state and number; each wire what moves on it, how many, and the rate from the
 * node before. Hover shows a card; a click opens the node where the page says. Search lights up
 * matches and filters fade the rest. A real event sends one dot along its wire. Exports to PNG
 * and SVG. Its own chunk, loaded when a graph shows; elk is a chunk of its own after that.
 */
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
  Boxes,
  CircleDot,
  Download,
  FileText,
  KeyRound,
  type LucideIcon,
  Server,
  Workflow,
} from "lucide-react";
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input } from "../components/ui/input.js";
import { GraphFrame } from "./frame.js";
import { type Direction, layout } from "./layout.js";
import {
  edgeId,
  facetsOf,
  type GraphEdge,
  type GraphKind,
  type GraphNode,
  type GraphTone,
  type Ink,
  type Laid,
  labelSize,
  litOf,
  nodeSize,
  roundedPath,
  svgOf,
  wireLines,
} from "./model.js";

/** Wiring by hand: a line dragged from one node onto another, and a line clicked. */
export interface GraphEdit {
  /** Which handles a node shows: a line starts at `from`, ends at `to`. */
  ends(id: string): { from: boolean; to: boolean };
  /** Whether a line from `from` may end at `to`. */
  fits(from: string, to: string): boolean;
  connect(from: string, to: string): void;
  pick(from: string, to: string): void;
}

/** One real event: a dot rides its wire once, or its node washes once when no wire shows it. */
export interface GraphDot {
  id: string;
  /** The wire's id: `edgeId`. */
  edge?: string | undefined;
  node?: string | undefined;
  tone: GraphTone;
}

export interface GraphProps {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  label: string;
  /** Left to right; "auto" turns top to bottom on a phone. */
  direction?: "auto" | "right" | "down" | undefined;
  edit?: GraphEdit | undefined;
  /** A node without an `href` was clicked: open it beside the graph. */
  onOpen?: ((id: string) => void) | undefined;
  dots?: readonly GraphDot[] | undefined;
  /** Search, filters and export above it. */
  tools?: boolean | undefined;
  /** The exported file's name. */
  name?: string | undefined;
  /** The tallest it draws (px) before it scrolls inside; about 3/4 of the window by default. */
  maxHeight?: number | undefined;
}

const PAD = 20;
/** Narrower than this, "auto" runs top to bottom. */
const NARROW = 640;
/** Zoomed out past this, words get too small: it pans instead. A phone keeps them bigger. */
const LEAST = { wide: 0.75, narrow: 0.8 };
/** Room under the drawing for the zoom buttons. */
const TOOLS_ROOM = 40;

const ICON: Record<GraphKind, LucideIcon> = {
  part: Boxes,
  workflow: Workflow,
  account: KeyRound,
  step: CircleDot,
  record: FileText,
  host: Server,
};
const TONE: Record<GraphTone, string> = {
  good: "text-(--ui-good-ink) before:bg-(--ui-good)",
  warn: "text-(--warn) before:bg-(--warn)",
  bad: "text-(--ui-bad) before:bg-(--ui-bad)",
  accent: "text-(--ui-accent) before:bg-(--ui-accent)",
  neutral: "text-(--ui-ink-2) before:bg-(--ui-ink-3)",
};
const DOT: Record<GraphTone, string> = {
  good: "bg-(--ui-accent)",
  accent: "bg-(--ui-accent)",
  neutral: "bg-(--ui-ink-2)",
  warn: "bg-(--warn)",
  bad: "bg-(--ui-bad)",
};
const FLASH: Record<GraphTone, string> = {
  good: "",
  accent: "",
  neutral: "",
  warn: "shadow-[inset_0_0_0_2px_var(--warn)]",
  bad: "shadow-[inset_0_0_0_2px_var(--ui-bad)]",
};
const HANDLE =
  "size-3! rounded-full! border! border-(--ui-ink-3)! bg-(--ui-paper)! hover:bg-(--ui-accent)!";
const num = (n: number) => n.toLocaleString("en-US");

interface Shared {
  dir: Direction;
  lit: ReadonlySet<string> | null;
  hover: string | null;
  edit: GraphEdit | undefined;
  open: ((id: string) => void) | undefined;
  laid: Laid;
  dots: readonly GraphDot[];
  done: (id: string) => void;
  byId: ReadonlyMap<string, GraphNode>;
}
const Ctx = createContext<Shared | null>(null);
const useShared = () => {
  const s = use(Ctx);
  if (!s) throw new Error("a graph node outside GraphCanvas");
  return s;
};

function KitNode({ id }: NodeProps) {
  const g = useShared();
  const n = g.byId.get(id);
  if (!n) return null;
  const Mark = ICON[n.kind];
  const across = g.dir === "RIGHT";
  const ends = g.edit?.ends(id);
  const faded = g.lit && !g.lit.has(id);
  const Tag = n.href ? "a" : "div";
  const opens = !n.href && !!g.open;
  const flash = g.dots.find((d) => d.node === id);
  return (
    <>
      <Handle
        type="target"
        position={across ? Position.Left : Position.Top}
        className={ends?.to ? HANDLE : "invisible"}
        isConnectable={!!ends?.to}
      />
      <Tag
        key={flash?.id}
        {...(n.href ? { href: n.href } : {})}
        {...(flash ? { onAnimationEnd: () => g.done(flash.id) } : {})}
        {...(opens
          ? {
              role: "button",
              tabIndex: 0,
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter") g.open?.(id);
              },
            }
          : {})}
        data-kind={n.kind}
        className={cn(
          "grid h-full content-start gap-0.5 rounded-(--ui-radius) px-3 py-2.5 text-left text-(--ui-ink) no-underline transition-[opacity,box-shadow] duration-200 ease-(--ui-ease) motion-reduce:transition-none",
          (n.href || opens) && "cursor-pointer",
          n.kind === "account" || n.dashed
            ? "border border-dashed border-(--ui-ink-3) bg-(--ui-tile)"
            : n.stacked
              ? "bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair),4px_4px_0_-1px_var(--ui-paper),4px_4px_0_0_var(--ui-hair)] hover:shadow-[inset_0_0_0_1px_var(--ui-ink-3),4px_4px_0_-1px_var(--ui-paper),4px_4px_0_0_var(--ui-ink-3)]"
              : "bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair)] hover:shadow-[inset_0_0_0_1px_var(--ui-ink-3)]",
          g.hover === id && "shadow-[inset_0_0_0_1.5px_var(--ui-ink)]",
          n.dim && "opacity-55",
          faded && "opacity-20",
          g.lit?.has(id) && "shadow-[inset_0_0_0_2px_var(--ui-accent)]",
          flash && "animate-ui-changed",
          flash && FLASH[flash.tone],
        )}
      >
        <span className="flex min-w-0 items-start gap-1.5">
          <Mark className="mt-px size-3.5 shrink-0 text-(--ui-ink-3)" aria-hidden="true" />
          <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-[1.3] font-semibold">
            {n.label}
          </span>
          {n.state ? (
            <span
              className={cn(
                "mt-px inline-flex shrink-0 items-center gap-1 text-[11px] leading-4 font-medium whitespace-nowrap before:size-1.5 before:rounded-full before:content-['']",
                TONE[n.state.tone],
              )}
            >
              {n.state.label}
            </span>
          ) : null}
        </span>
        {n.note ? (
          <span className="line-clamp-2 pl-5 text-[12px] leading-[1.33] text-(--ui-ink-2)">
            {n.note}
          </span>
        ) : null}
        {n.number ? <Num n={n.number} big inLink={!!n.href} /> : null}
        {n.more ? <Num n={n.more} inLink={!!n.href} /> : null}
        {n.lines?.length ? (
          <ul className="m-0 grid min-w-0 list-none p-0 pl-5 text-[12px] leading-[19px]">
            {n.lines.slice(0, 7).map((l) => (
              <li key={`${l.sign}${l.text}`} className="truncate" title={l.text}>
                {l.sign ? (
                  <span className={l.sign === "+" ? "text-(--ui-good)" : "text-(--ui-ink-3)"}>
                    {l.sign}{" "}
                  </span>
                ) : null}
                <span className={l.sign ? "" : "text-(--ui-ink-2)"}>{l.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Tag>
      <Handle
        type="source"
        position={across ? Position.Right : Position.Bottom}
        className={ends?.from ? HANDLE : "invisible"}
        isConnectable={!!ends?.from}
      />
    </>
  );
}

/** A node's number; a link to its rows unless the node is a link itself. */
function Num({
  n,
  big,
  inLink,
}: {
  n: NonNullable<GraphNode["number"]>;
  big?: boolean;
  inLink: boolean;
}) {
  const body = (
    <>
      <span
        className={cn(
          "font-semibold text-(--ui-ink) tabular-nums",
          big ? "text-[20px] leading-[26px] tracking-[-0.02em]" : "text-[12px]",
        )}
      >
        {num(n.value)}
      </span>{" "}
      {n.label}
      {n.today ? <span className="text-(--ui-ink-3)"> · {num(n.today)} today</span> : null}
    </>
  );
  const cls = cn("pl-5 text-[12px] leading-[1.33] text-(--ui-ink-2)", big && "mt-1");
  return n.href && !inLink ? (
    <a
      href={n.href}
      className={cn(cls, "w-fit no-underline hover:text-(--ui-ink) hover:underline")}
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </a>
  ) : (
    <span className={cls}>{body}</span>
  );
}

type WireData = { lines: string[]; d: string; label?: { x: number; y: number; w: number } };

function KitEdge({ id, source, target, data }: EdgeProps<Edge<WireData>>) {
  const g = useShared();
  if (!data) return null;
  const faded = g.lit && !(g.lit.has(source) && g.lit.has(target));
  const on = g.hover === id || g.hover === source || g.hover === target;
  const dots = g.dots.filter((d) => d.edge === id);
  return (
    <>
      <path
        d={data.d}
        className={cn(
          "fill-none [stroke-linecap:round] transition-[stroke,opacity] duration-200 ease-(--ui-ease) motion-reduce:transition-none",
          on ? "stroke-(--ui-ink) stroke-[2]" : "stroke-(--ui-ink-3) stroke-[1.5]",
          faded && "opacity-20",
        )}
      />
      {/* A wide clear stroke, so the line is easy to hover and click. */}
      <path d={data.d} className="cursor-pointer fill-none stroke-transparent stroke-[14]" />
      <EdgeLabelRenderer>
        {data.label && data.lines.length ? (
          <div
            className={cn(
              "pointer-events-none absolute top-0 left-0 grid bg-(--ui-tile)/90 px-1 text-[11px] leading-[15px] text-(--ui-ink-2) tabular-nums",
              faded && "opacity-20",
            )}
            style={{
              width: data.label.w,
              transform: `translate(${data.label.x}px, ${data.label.y}px)`,
            }}
          >
            {data.lines.map((l, i) => (
              <span key={l} className={cn("truncate", i === 0 && "text-(--ui-ink)")} title={l}>
                {l}
              </span>
            ))}
          </div>
        ) : null}
        {dots.map((d) => (
          <span
            key={d.id}
            className={cn(
              "pointer-events-none absolute top-0 left-0 size-[9px] animate-ui-run-spark rounded-full shadow-[0_0_0_3px_var(--ui-tile)] [animation-duration:1.4s] [offset-rotate:0deg] motion-reduce:hidden",
              DOT[d.tone],
            )}
            data-tone={d.tone}
            style={{ offsetPath: `path("${data.d}")` }}
            onAnimationEnd={() => g.done(d.id)}
            aria-hidden="true"
          />
        ))}
      </EdgeLabelRenderer>
    </>
  );
}

const NODE_TYPES = { kit: KitNode };
const EDGE_TYPES = { kit: KitEdge };

/** The page's colors, for an exported file. */
function inkOf(el: HTMLElement): Ink {
  const s = getComputedStyle(el);
  const v = (name: string, or: string) => s.getPropertyValue(name).trim() || or;
  // A color-mix() token doesn't survive outside the page; a plain one does.
  const plain = (c: string, or: string) => (/^(#|rgb|hsl)/.test(c) ? c : or);
  return {
    paper: plain(v("--ui-paper", "#ffffff"), "#ffffff"),
    ink: plain(v("--ui-ink", "#1a1a1a"), "#1a1a1a"),
    ink2: plain(v("--ui-ink-2", "#5c5c5c"), "#5c5c5c"),
    ink3: plain(v("--ui-ink-3", "#9a9a9a"), "#9a9a9a"),
    hair: plain(v("--ui-hair", "#e4e4e4"), "#e4e4e4"),
    tile: plain(v("--ui-canvas", "#f4f4f2"), "#f4f4f2"),
    font: s.fontFamily || "sans-serif",
  };
}

function save(blob: Blob, file: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function pngOf(svg: string, w: number, h: number): Promise<Blob> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const scale = 2;
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("No canvas here.");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((ok, no) =>
    c.toBlob((b) => (b ? ok(b) : no(new Error("The PNG didn't draw."))), "image/png"),
  );
}

const SELECT =
  "h-8 border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink) rounded-(--ui-radius)";
const TOOL =
  "inline-flex h-8 items-center gap-1.5 border-0 bg-transparent px-2 text-[13px] font-medium text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) cursor-pointer";

export default function GraphCanvas({
  nodes,
  edges,
  label,
  direction = "auto",
  edit,
  onOpen,
  dots = [],
  tools = true,
  name,
  maxHeight,
}: GraphProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const dir: Direction =
    direction === "down" || (direction === "auto" && width > 0 && width < NARROW)
      ? "DOWN"
      : "RIGHT";

  const sized = useMemo(() => nodes.map((n) => ({ id: n.id, ...nodeSize(n) })), [nodes]);
  const wires = useMemo(
    () =>
      edges.map((e) => {
        const lines = wireLines(e);
        return { e, id: edgeId(e), lines, size: labelSize(lines) };
      }),
    [edges],
  );
  const shape = JSON.stringify([sized, wires.map((w) => [w.id, w.size]), dir]);
  const [laid, setLaid] = useState<{ shape: string; laid: Laid } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shape` names everything laid out.
  useEffect(() => {
    if (!width) return;
    let live = true;
    const labeled = wires.some((w) => w.size.width);
    layout(
      sized,
      wires.map((w) => ({ id: w.id, from: w.e.from, to: w.e.to, label: w.size })),
      dir,
      labeled ? 40 : 64,
    ).then((l) => live && setLaid({ shape, laid: l }));
    return () => {
      live = false;
    };
  }, [shape, width > 0]);

  const [q, setQ] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const lit = useMemo(() => litOf(nodes, q, picks), [nodes, q, picks]);
  const facets = useMemo(() => facetsOf(nodes), [nodes]);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const live = useMemo(() => dots.filter((d) => !gone.has(d.id)), [dots, gone]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const l = laid?.laid ?? null;
  const rfNodes = useMemo(
    (): Node[] =>
      l
        ? nodes.flatMap((n) => {
            const b = l.nodes[n.id];
            return b
              ? [
                  {
                    id: n.id,
                    type: "kit",
                    position: { x: b.x, y: b.y },
                    width: b.width,
                    height: b.height,
                    // Nothing selects or drags, so React Flow would let clicks through to the pane.
                    style: { pointerEvents: "all" },
                    data: {},
                  },
                ]
              : [];
          })
        : [],
    [l, nodes],
  );
  const rfEdges = useMemo(
    (): Edge<WireData>[] =>
      l
        ? wires.flatMap(({ e, id, lines, size }) => {
            const at = l.edges[id];
            return at
              ? [
                  {
                    id,
                    source: e.from,
                    target: e.to,
                    type: "kit",
                    data: {
                      lines,
                      d: roundedPath(at.points),
                      ...(at.label ? { label: { ...at.label, w: size.width } } : {}),
                    },
                  },
                ]
              : [];
          })
        : [],
    [l, wires],
  );

  const most = maxHeight ?? Math.max(360, Math.round((globalThis.innerHeight || 900) * 0.72));
  const view = useMemo(() => {
    if (!l) return null;
    const room = Math.max(1, width - 2 * PAD);
    const least = width < NARROW ? LEAST.narrow : LEAST.wide;
    const zoom = Math.max(least, Math.min(1, room / Math.max(1, l.width)));
    const height = Math.min(most, Math.ceil(l.height * zoom + 2 * PAD + TOOLS_ROOM));
    const fits = l.width * zoom <= room + 1 && l.height * zoom + 2 * PAD + TOOLS_ROOM <= height + 1;
    const x = dir === "DOWN" ? Math.max(PAD, (width - l.width * zoom) / 2) : PAD;
    return { rest: { x, y: PAD, zoom }, height, fits };
  }, [l, width, most, dir]);

  const download = async (kind: "svg" | "png") => {
    if (!l || !box.current) return;
    const svg = svgOf(l, nodes, edges, inkOf(box.current));
    const file = `${name ?? label}.${kind}`.replace(/[^\w.-]+/g, "-").toLowerCase();
    if (kind === "svg") return save(new Blob([svg], { type: "image/svg+xml" }), file);
    save(await pngOf(svg, Math.ceil(l.width + 48), Math.ceil(l.height + 48)), file);
  };

  const at = (e: MouseEvent, id: string) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setHover({ id, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const shared: Shared | null = l
    ? {
        dir,
        lit,
        hover: hover?.id ?? null,
        edit,
        open: onOpen,
        laid: l,
        dots: live,
        done: (id) => setGone((s) => new Set(s).add(id)),
        byId,
      }
    : null;

  return (
    <div className="grid w-full max-w-full gap-2">
      {tools ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Find in the graph"
            aria-label="Find in the graph"
            className="h-8 w-full max-w-[220px] text-[13px] max-sm:max-w-none"
          />
          {facets.map(([k, vs]) => (
            <select
              key={k}
              className={SELECT}
              aria-label={k}
              value={picks[k] ?? ""}
              onChange={(e) => setPicks((p) => ({ ...p, [k]: e.target.value }))}
            >
              <option value="">Any {k.toLowerCase()}</option>
              {vs.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          ))}
          {lit ? (
            <span className="text-[13px] text-(--ui-ink-2)" aria-live="polite">
              {lit.size} of {nodes.length}
            </span>
          ) : null}
          <span className="ml-auto flex gap-1">
            <button type="button" className={TOOL} onClick={() => void download("png")}>
              <Download className="size-3.5" aria-hidden="true" />
              PNG
            </button>
            <button type="button" className={TOOL} onClick={() => void download("svg")}>
              <Download className="size-3.5" aria-hidden="true" />
              SVG
            </button>
          </span>
        </div>
      ) : null}
      <div ref={box} className="relative w-full max-w-full">
        {shared && view ? (
          <Ctx value={shared}>
            <GraphFrame
              label={label}
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              height={view.height}
              rest={view.rest}
              fits={view.fits}
              minimap={!view.fits || nodes.length > 8}
              flow={{
                nodesConnectable: !!edit,
                autoPanOnConnect: false,
                onConnect: (c) => edit?.connect(c.source, c.target),
                isValidConnection: (c) => !!edit?.fits(c.source, c.target),
                connectionLineStyle: { stroke: "var(--ui-ink-3)", strokeWidth: 1.5 },
                onNodeClick: (_, n) => {
                  if (!byId.get(n.id)?.href) onOpen?.(n.id);
                },
                onEdgeClick: (_, e) => edit?.pick(e.source, e.target),
                onNodeMouseEnter: (e, n) => at(e, n.id),
                onNodeMouseMove: (e, n) => at(e, n.id),
                onNodeMouseLeave: () => setHover(null),
                onEdgeMouseEnter: (e, x) => at(e, x.id),
                onEdgeMouseMove: (e, x) => at(e, x.id),
                onEdgeMouseLeave: () => setHover(null),
                onMoveStart: () => setHover(null),
              }}
            >
              {hover ? (
                <HoverCard
                  at={hover}
                  node={byId.get(hover.id)}
                  wire={wires.find((w) => w.id === hover.id)}
                  byId={byId}
                  room={width}
                />
              ) : null}
            </GraphFrame>
          </Ctx>
        ) : (
          <div
            className="h-40 w-full animate-pulse border border-(--ui-hair) bg-(--ui-tile)"
            aria-busy="true"
          />
        )}
      </div>
    </div>
  );
}

/** What's under the pointer, in full: a node's every number, or a wire's every line. */
function HoverCard({
  at,
  node,
  wire,
  byId,
  room,
}: {
  at: { x: number; y: number };
  node: GraphNode | undefined;
  wire: { e: GraphEdge; lines: string[] } | undefined;
  byId: ReadonlyMap<string, GraphNode>;
  room: number;
}) {
  if (!node && !wire) return null;
  const left = at.x + 260 > room ? Math.max(4, at.x - 268) : at.x + 14;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 grid w-[252px] gap-1 border border-(--ui-hair) bg-(--ui-paper) p-3 text-[12.5px] leading-[1.4] text-(--ui-ink) shadow-(--ui-shadow)"
      style={{ left, top: at.y + 14 }}
    >
      {node ? (
        <>
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{node.label}</span>
            {node.state ? (
              <span className="text-[11.5px] text-(--ui-ink-2)">{node.state.label}</span>
            ) : null}
          </span>
          {node.note ? <span className="text-(--ui-ink-2)">{node.note}</span> : null}
          {[node.number, node.more].map((n) =>
            n ? (
              <span key={n.label} className="tabular-nums">
                <b className="font-semibold">{num(n.value)}</b> {n.label}
                {n.today !== undefined ? `, ${num(n.today)} today` : ""}
              </span>
            ) : null,
          )}
          {Object.entries(node.facets ?? {}).length ? (
            <span className="text-[11.5px] text-(--ui-ink-2)">
              {Object.values(node.facets ?? {}).join(" · ")}
            </span>
          ) : null}
        </>
      ) : wire ? (
        <>
          <span className="text-[11.5px] text-(--ui-ink-2)">
            {byId.get(wire.e.from)?.label ?? wire.e.from} →{" "}
            {byId.get(wire.e.to)?.label ?? wire.e.to}
          </span>
          {wire.lines.length ? (
            wire.lines.map((l, i) => (
              <span key={l} className={cn("tabular-nums", i === 0 && "font-semibold")}>
                {l}
              </span>
            ))
          ) : (
            <span className="text-(--ui-ink-2)">Nothing counted on this wire.</span>
          )}
        </>
      ) : null}
    </div>
  );
}
