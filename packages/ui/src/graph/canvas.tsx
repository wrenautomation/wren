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
  ArrowUpRight,
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
import { lanes } from "./lanes.js";
import { type Direction, layout } from "./layout.js";
import {
  arrowAt,
  hueOf,
  LOOK,
  pillText,
  pillWidth,
  portRows,
  portY,
  ROLE_HUE,
  wireCurve,
} from "./look.js";
import {
  edgeId,
  facetsOf,
  GRAPH_DROP,
  type GraphEdge,
  type GraphKind,
  type GraphNode,
  type GraphTone,
  type Ink,
  type Laid,
  litOf,
  nodeSize,
  pillSize,
  roleOf,
  svgOf,
  wireEnds,
  wireHue,
  wireLines,
} from "./model.js";

/** The ports a drag joined, when the nodes name theirs: an output and an input. */
export interface GraphEnds {
  from?: string | undefined;
  to?: string | undefined;
}

/** Wiring by hand: a line dragged from one node onto another, and a line clicked. */
export interface GraphEdit {
  /** Which handles a node shows: a line starts at `from`, ends at `to`. */
  ends(id: string): { from: boolean; to: boolean };
  /** Whether a line from `from` may end at `to`, port to port when both name theirs. */
  fits(from: string, to: string, ports?: GraphEnds): boolean;
  connect(from: string, to: string, ports?: GraphEnds): void;
  pick(from: string, to: string): void;
}

/** A port's id from its handle's ("out:replied"). */
const portOf = (handle: string | null | undefined) =>
  handle?.split(":").slice(1).join(":") || undefined;

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
  /** The tallest it draws (px) before it pans inside; the window's height, less the page's top, by default. */
  maxHeight?: number | undefined;
  /** Lights these nodes and fades the rest, as a search does: Play's step. */
  focus?: readonly string[] | undefined;
  /** "layered": elk works out columns from the wires. "lanes": the nodes' order is time, a row per lane. */
  layout?: "layered" | "lanes" | undefined;
  /** The node ringed as picked, held by the page; the graph keeps its own when left out. */
  selected?: string | null | undefined;
  /** A palette item dropped on the graph (`GRAPH_DROP`): its id. */
  onDrop?: ((id: string) => void) | undefined;
  /** A click on the empty ground: the page drops its pick. */
  onPane?: (() => void) | undefined;
  /** The least it draws (px): an editor's room for its panels. */
  minHeight?: number | undefined;
  /** Takes the tallest it may draw, however short the drawing: an editor's pane. */
  fill?: boolean | undefined;
  /** Px each side that panels cover: the drawing fits between them. */
  inset?: { left?: number; right?: number } | undefined;
  /** Nodes it pans to at rest when the drawing is wider than the frame: a diff's changes. Play's
   * `focus` when left out. */
  show?: readonly string[] | undefined;
  /** Shows the whole drawing at rest, smaller than readable if it must: a preview, not a workspace. */
  fit?: boolean | undefined;
}

const PAD = 20;
/** Narrower than this, "auto" runs top to bottom. */
const NARROW = 640;
/**
 * The least it zooms at rest: a node's 13px name reads at 12px. A bigger drawing shows its start
 * and pans, the minimap under it; "Fit all" shows the whole on demand. A phone fits the width
 * down to `FIT_LEAST` and shows the top.
 */
const READ = 12 / 13;
/** The least a `fit` drawing zooms at rest: past that it pans, as any other. */
const FIT_LEAST = 0.4;
/** The window's height less the page's header and a margin: the tallest a graph draws by default. */
const CHROME = 96;
/** Room under the drawing for the zoom buttons. */
const TOOLS_ROOM = 40;
/** Room under the drawing for the minimap, shown only when the drawing doesn't fit. */
const MAP_ROOM = 120;

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
const HANDLE = "size-[9px]! rounded-full! border-[1.5px]! bg-(--ui-paper)!";
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
  /** The node last clicked: its ring. */
  selected: string | null;
  /** A wire being dragged: the kind it carries and the side it'll land on; the rest dim. */
  drag: { kind: string | undefined; lands: "in" | "out" } | null;
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
  const hue = ROLE_HUE[roleOf(n)];
  const end = n.kind === "account" || n.dashed;
  const tone = n.state?.tone;
  const rows = portRows(n);
  const mark = n.mark;
  return (
    <>
      <Handles n={n} side="in" across={across} live={!!ends?.to} />
      {n.stacked ? (
        // A workflow inside: one card stacked behind, as a deck.
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 translate-x-1 -translate-y-1 rounded-[8px] bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair)]"
        />
      ) : null}
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
        data-role={roleOf(n)}
        className={cn(
          "relative flex h-full flex-col rounded-[8px] px-2.5 pt-2.5 pb-2.5 text-left text-(--ui-ink) no-underline transition-[opacity,box-shadow,translate] duration-200 ease-(--ui-ease) motion-reduce:transition-none",
          (n.href || opens) && "cursor-pointer hover:-translate-y-0.5",
          end
            ? "border border-dashed border-(--ui-ink-3) bg-(--ui-tile)"
            : "bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair),0_1px_2px_rgb(0_0_0/0.06)] hover:shadow-[inset_0_0_0_1px_var(--ui-ink-3),0_6px_16px_-6px_rgb(0_0_0/0.25)]",
          tone === "bad" && "shadow-[inset_0_0_0_1.5px_var(--ui-bad)]",
          tone === "warn" && "shadow-[inset_0_0_0_1.5px_var(--warn)]",
          g.hover === id && "shadow-[inset_0_0_0_1.5px_var(--ui-ink)]",
          n.dim && "opacity-55",
          faded && "opacity-20",
          g.lit?.has(id) && "shadow-[inset_0_0_0_2px_var(--ui-accent)]",
          g.selected === id && "outline-2 outline-offset-2 outline-(--ui-accent)",
          mark === "added" && "shadow-[inset_0_0_0_2px_var(--ui-good)]",
          mark === "changed" && "shadow-[inset_0_0_0_2px_var(--warn)]",
          mark === "removed" &&
            "opacity-60 shadow-[inset_0_0_0_2px_var(--ui-bad)] [&_.kit-name]:line-through",
          flash && "animate-ui-changed",
          flash && FLASH[flash.tone],
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5" style={{ height: LOOK.head }}>
          <span
            className="grid shrink-0 place-items-center rounded-[7px]"
            style={{
              width: LOOK.tile,
              height: LOOK.tile,
              color: hue,
              background: `color-mix(in oklch, ${hue} 16%, var(--ui-paper))`,
            }}
          >
            <Mark className="size-4" aria-hidden="true" />
          </span>
          <span className="grid min-w-0 flex-1">
            <span className="kit-name truncate text-[13px] leading-4 font-semibold" title={n.label}>
              {n.label}
            </span>
            {n.note ? (
              <span className="truncate text-[11.5px] leading-4 text-(--ui-ink-2)" title={n.note}>
                {n.note}
              </span>
            ) : null}
          </span>
          {n.stacked ? (
            <ArrowUpRight className="size-3.5 shrink-0 text-(--ui-ink-3)" aria-label="Opens" />
          ) : null}
          {mark ? (
            <span
              className={cn(
                "shrink-0 self-start rounded-full px-1.5 text-[10.5px] leading-4 font-semibold",
                mark === "added" && "bg-(--ui-good) text-(--ui-paper)",
                mark === "removed" && "bg-(--ui-bad) text-(--ui-paper)",
                mark === "changed" && "bg-(--warn) text-(--ui-paper)",
              )}
            >
              {mark === "added" ? "New" : mark === "removed" ? "Gone" : "Changed"}
            </span>
          ) : null}
          {n.state ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 self-start pt-0.5 text-[11px] leading-4 font-medium whitespace-nowrap before:size-2 before:rounded-full before:content-['']",
                TONE[n.state.tone],
              )}
              title={n.state.label}
            >
              {/* The dot says it; words only when it needs someone. */}
              {n.state.tone === "bad" || n.state.tone === "warn" ? (
                n.state.label
              ) : (
                <span className="sr-only">{n.state.label}</span>
              )}
            </span>
          ) : null}
        </span>
        {n.number ? <Num n={n.number} big inLink={!!n.href} /> : null}
        {n.more ? <Num n={n.more} inLink={!!n.href} /> : null}
        {n.lines?.length ? (
          <ul className="m-0 grid min-w-0 list-none p-0 text-[11.5px] leading-[18px]">
            {n.lines.slice(0, LOOK.lines).map((l) => (
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
        {rows ? (
          // A row per port when a side has several: inputs named left, outputs right.
          <span
            className="mt-auto grid text-[11px] leading-[18px] text-(--ui-ink-2)"
            style={{ gridTemplateRows: `repeat(${rows}, ${LOOK.port}px)` }}
          >
            {Array.from({ length: rows }, (_, i) => {
              const a = (n.ins?.length ?? 0) > 1 ? n.ins?.[i] : undefined;
              const b = (n.outs?.length ?? 0) > 1 ? n.outs?.[i] : undefined;
              return (
                <span key={`${a?.id ?? ""}:${b?.id ?? ""}`} className="flex justify-between gap-2">
                  <span className="truncate">{a?.label ?? ""}</span>
                  <span className="truncate text-right">{b?.label ?? ""}</span>
                </span>
              );
            })}
          </span>
        ) : null}
      </Tag>
      <Handles n={n} side="out" across={across} live={!!ends?.from} />
    </>
  );
}

/** A node's handles on one side: one per port, colored by its kind, at its row. */
function Handles({
  n,
  side,
  across,
  live,
}: {
  n: GraphNode;
  side: "in" | "out";
  across: boolean;
  live: boolean;
}) {
  const { drag } = useShared();
  const list = (side === "in" ? n.ins : n.outs) ?? [];
  // While a wire drags, the ends it can land on stand out and the wrong kinds dim.
  const lands = (kind: string | undefined) =>
    !drag || drag.lands !== side ? null : !drag.kind || !kind || drag.kind === kind;
  const type = side === "in" ? "target" : "source";
  const position = across
    ? side === "in"
      ? Position.Left
      : Position.Right
    : side === "in"
      ? Position.Top
      : Position.Bottom;
  const ports = across && list.length ? list : [undefined];
  return (
    <>
      {ports.map((p) => (
        <Handle
          key={p?.id ?? side}
          {...(p ? { id: `${side}:${p.id}` } : {})}
          type={type}
          position={position}
          isConnectable={live}
          title={p ? `${p.label}${p.kind ? ` (${p.kind})` : ""}` : undefined}
          data-lands={String(lands(p?.kind ?? list[0]?.kind))}
          className={cn(
            HANDLE,
            live && "hover:bg-(--ui-accent)!",
            lands(p?.kind ?? list[0]?.kind) === true && "scale-150 bg-(--ui-accent)!",
            lands(p?.kind ?? list[0]?.kind) === false && "opacity-20",
          )}
          style={{
            ...(across ? { top: portY(n, side, p?.id) } : {}),
            borderColor: hueOf(p?.kind ?? (across ? undefined : list[0]?.kind)),
          }}
        />
      ))}
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
          big ? "text-[17px] leading-[22px] tracking-[-0.02em]" : "text-[11.5px]",
        )}
      >
        {num(n.value)}
      </span>{" "}
      {n.label}
      {n.today ? <span className="text-(--ui-ink-3)"> · {num(n.today)} today</span> : null}
    </>
  );
  const cls = cn(
    "truncate text-[11.5px] text-(--ui-ink-2)",
    big ? "mt-1 leading-[22px]" : "leading-4",
  );
  return n.href && !inLink ? (
    <a
      href={n.href}
      className={cn(cls, "w-fit max-w-full no-underline hover:text-(--ui-ink) hover:underline")}
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </a>
  ) : (
    <span className={cls}>{body}</span>
  );
}

type WireData = {
  mark: GraphEdge["mark"];
  lines: string[];
  d: string;
  arrow: string;
  hue: string;
  pill: string;
  mid: { x: number; y: number };
};

function KitEdge({ id, source, target, data }: EdgeProps<Edge<WireData>>) {
  const g = useShared();
  if (!data) return null;
  const dots = g.dots.filter((d) => d.edge === id);
  // A wire with a dot riding it stays lit: Play's step arriving.
  const faded = g.lit && !dots.length && !(g.lit.has(source) && g.lit.has(target));
  const on = g.hover === id || g.hover === source || g.hover === target || dots.length > 0;
  const w = pillWidth(data.pill);
  return (
    <>
      <g
        className={cn(
          "transition-opacity duration-200 ease-(--ui-ease) motion-reduce:transition-none",
          faded && "opacity-20",
        )}
        style={{
          color: dots.length
            ? "var(--ui-accent)"
            : data.mark === "added"
              ? "var(--ui-good)"
              : data.mark === "removed"
                ? "var(--ui-bad)"
                : on
                  ? "var(--ui-ink)"
                  : data.hue,
        }}
      >
        <path
          d={data.d}
          className={cn(
            "fill-none stroke-current [stroke-linecap:round]",
            on || data.mark ? "stroke-[2]" : "stroke-[1.5]",
            data.mark === "removed" && "[stroke-dasharray:5_4]",
          )}
        />
        <path d={data.arrow} className="fill-current" />
      </g>
      {/* A wide clear stroke, so the line is easy to hover and click. */}
      <path d={data.d} className="cursor-pointer fill-none stroke-transparent stroke-[14]" />
      <EdgeLabelRenderer>
        {data.pill ? (
          <span
            className={cn(
              "pointer-events-none absolute top-0 left-0 h-5 truncate rounded-full bg-(--ui-paper) px-2 text-center text-[11px] leading-5 text-(--ui-ink-2) tabular-nums shadow-[inset_0_0_0_1px_var(--ui-hair)]",
              on && "text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-ink-3)]",
              faded && "opacity-20",
            )}
            style={{
              maxWidth: w,
              transform: `translate(-50%, -50%) translate(${data.mid.x}px, ${data.mid.y}px)`,
            }}
            title={data.lines.join(", ")}
          >
            {data.pill}
          </span>
        ) : null}
        {dots.map((d) => (
          <span
            key={d.id}
            className={cn(
              "pointer-events-none absolute top-0 left-0 z-10 size-3 animate-ui-run-spark rounded-full shadow-[0_0_0_3px_var(--ui-paper),0_0_10px_2px_var(--ui-accent)] [animation-duration:1.4s] [offset-rotate:0deg] motion-reduce:hidden",
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

/** The graph's lavender ground as a plain color, read off a probe. */
function groundOf(el: HTMLElement): string | undefined {
  const probe = document.createElement("span");
  probe.style.background = "var(--ui-graph)";
  el.append(probe);
  const c = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return /^(#|rgb|color\()/.test(c) && c !== "rgba(0, 0, 0, 0)" ? c : undefined;
}

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
    ground: groundOf(el),
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
  layout: arrange = "layered",
  focus,
  selected: held,
  onDrop,
  onPane,
  minHeight,
  fill,
  show,
  fit,
  inset,
}: GraphProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [screen, setScreen] = useState(() => globalThis.innerHeight || 900);
  useEffect(() => {
    const measure = () => setScreen(globalThis.innerHeight || 900);
    globalThis.addEventListener?.("resize", measure);
    return () => globalThis.removeEventListener?.("resize", measure);
  }, []);
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

  const sized = useMemo(
    () => nodes.map((n) => ({ id: n.id, lane: n.lane, ...nodeSize(n) })),
    [nodes],
  );
  const wires = useMemo(
    () =>
      edges.map((e) => {
        const lines = wireLines(e);
        return { e, id: edgeId(e), lines, size: pillSize(e) };
      }),
    [edges],
  );
  const shape = JSON.stringify([sized, wires.map((w) => [w.id, w.size]), dir, arrange]);
  const [laid, setLaid] = useState<{ shape: string; laid: Laid } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shape` names everything laid out.
  useEffect(() => {
    if (!width) return;
    let live = true;
    const labeled = wires.some((w) => w.size.width);
    const lines = wires.map((w) => ({ id: w.id, from: w.e.from, to: w.e.to, label: w.size }));
    (arrange === "lanes"
      ? Promise.resolve(lanes(sized, lines, dir))
      : layout(sized, lines, dir, labeled ? 48 : 64)
    ).then((l) => live && setLaid({ shape, laid: l }));
    return () => {
      live = false;
    };
  }, [shape, width > 0]);

  const [q, setQ] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const lit = useMemo(
    () => (focus?.length ? new Set(focus) : litOf(nodes, q, picks)),
    [nodes, q, picks, focus],
  );
  const facets = useMemo(() => facetsOf(nodes), [nodes]);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const live = useMemo(() => dots.filter((d) => !gone.has(d.id)), [dots, gone]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [own, setSelected] = useState<string | null>(null);
  const selected = held === undefined ? own : held;
  const [drag, setDrag] = useState<Shared["drag"]>(null);

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
        ? wires.flatMap(({ e, id, lines }) => {
            const a = l.nodes[e.from];
            const b = l.nodes[e.to];
            if (!l.edges[id] || !a || !b) return [];
            const across = dir === "RIGHT";
            const from = byId.get(e.from);
            const to = byId.get(e.to);
            const ends = wireEnds(e, a, b, from, to, across);
            const c = wireCurve(ends.from, ends.to, across);
            const out = across && from?.outs?.some((p) => p.id === e.fromPort);
            const into = across && to?.ins?.some((p) => p.id === e.toPort);
            return [
              {
                id,
                source: e.from,
                target: e.to,
                ...(out ? { sourceHandle: `out:${e.fromPort}` } : {}),
                ...(into ? { targetHandle: `in:${e.toPort}` } : {}),
                type: "kit",
                data: {
                  mark: e.mark,
                  lines,
                  d: c.d,
                  arrow: arrowAt(c.end, across),
                  hue: wireHue(e, from),
                  pill: pillText(e),
                  mid: c.mid,
                },
              },
            ];
          })
        : [],
    [l, wires, byId, dir],
  );

  const least = minHeight ?? 0;
  const most = Math.max(least, maxHeight ?? Math.max(360, screen - CHROME));
  const left = inset?.left ?? 0;
  const right = inset?.right ?? 0;
  const view = useMemo(() => {
    if (!l) return null;
    const narrow = width < NARROW;
    const room = Math.max(1, width - 2 * PAD - left - right);
    const tall = Math.max(1, most - 2 * PAD - TOOLS_ROOM);
    const whole = Math.min(
      1,
      room / Math.max(1, l.width),
      narrow ? 1 : tall / Math.max(1, l.height),
    );
    // Never under readable: past that, it shows the start and pans. A phone fits the width (it
    // pans down, never sideways), so no node sits off its right edge.
    const zoom = Math.max(fit || narrow ? FIT_LEAST : READ, whole);
    const fits = l.width * zoom <= room + 1 && (narrow || l.height * zoom <= tall + 1);
    // The minimap sits in its own room under the drawing, so it never covers a node at rest.
    const map = !fits && !narrow;
    const height = Math.max(
      least,
      fill
        ? most
        : Math.min(most, Math.ceil(l.height * zoom + 2 * PAD + TOOLS_ROOM + (map ? MAP_ROOM : 0))),
    );
    const centered =
      left + (dir === "DOWN" ? Math.max(PAD, (width - left - right - l.width * zoom) / 2) : PAD);
    // Too wide for the frame: it pans to what it's asked to show, never past either end.
    const boxes = (show ?? focus ?? []).flatMap((id) => (l.nodes[id] ? [l.nodes[id]] : []));
    const over = l.width * zoom - room;
    const x =
      boxes.length && over > 0
        ? left +
          PAD -
          Math.min(
            over,
            Math.max(
              0,
              ((Math.min(...boxes.map((b) => b.x)) + Math.max(...boxes.map((b) => b.x + b.width))) /
                2) *
                zoom -
                room / 2,
            ),
          )
        : centered;
    // An editor's room taller than the drawing: it sits in the middle, not at the top.
    const spare = height - l.height * zoom - 2 * PAD - TOOLS_ROOM - (map ? MAP_ROOM : 0);
    return {
      rest: { x, y: PAD + Math.max(0, spare / 2), zoom },
      height,
      fits: fits && l.height * zoom + 2 * PAD + TOOLS_ROOM <= height + 1,
      map,
    };
  }, [l, width, most, least, fill, left, right, dir, show, focus, fit]);

  const download = async (kind: "svg" | "png") => {
    if (!l || !box.current) return;
    const svg = svgOf(l, nodes, edges, inkOf(box.current), 24, dir === "RIGHT");
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
        selected,
        drag,
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the palette adds by click and key too. */}
      <div
        ref={box}
        className="relative w-full max-w-full"
        onDragOver={(e) => {
          if (onDrop && e.dataTransfer.types.includes(GRAPH_DROP)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const id = onDrop ? e.dataTransfer.getData(GRAPH_DROP) : "";
          if (!id) return;
          e.preventDefault();
          onDrop?.(id);
        }}
      >
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
              minimap={view.map}
              flow={{
                nodesConnectable: !!edit,
                autoPanOnConnect: false,
                onConnect: (c) =>
                  edit?.connect(c.source, c.target, {
                    from: portOf(c.sourceHandle),
                    to: portOf(c.targetHandle),
                  }),
                isValidConnection: (c) =>
                  !!edit?.fits(c.source, c.target, {
                    from: portOf(c.sourceHandle),
                    to: portOf(c.targetHandle),
                  }),
                onConnectStart: (_, { nodeId, handleId, handleType }) => {
                  const n = nodeId ? byId.get(nodeId) : undefined;
                  const from = handleType !== "target";
                  const list = (from ? n?.outs : n?.ins) ?? [];
                  const p = list.find((x) => x.id === portOf(handleId)) ?? list[0];
                  setDrag({ kind: p?.kind, lands: from ? "in" : "out" });
                },
                onConnectEnd: () => setDrag(null),
                onPaneClick: () => {
                  setSelected(null);
                  onPane?.();
                },
                connectionLineStyle: { stroke: "var(--ui-ink-3)", strokeWidth: 1.5 },
                onNodeClick: (_, n) => {
                  setSelected(n.id);
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
