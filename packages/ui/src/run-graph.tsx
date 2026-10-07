/**
 * A run's steps drawn on React Flow, read-only, in the graph kit's frame (pan, zoom, fit, keys):
 * `flow.ts` places them, since each step measures its own height and the replay's timing rides
 * on those places. React Flow draws the nodes, the lines between them and the sparks riding in.
 * Its own chunk, loaded when a run shows.
 */
import {
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type NodeChange,
  type NodeProps,
  Position,
  type Node as RFNode,
} from "@xyflow/react";
import { createContext, use, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  edgePath,
  type FlowAxis,
  type FlowGraph,
  type FlowNode,
  INPUT,
  layoutOf,
  OUTPUT,
} from "./flow.js";
import { cx, num } from "./format.js";
import { GraphFrame } from "./graph/frame.js";
import { Icon } from "./icons.js";
import {
  mixOf,
  type RunEnd,
  type RunLine,
  type RunLineKind,
  type RunMix,
  type RunStep,
  type RunStepState,
  type RunStepView,
} from "./run.js";

/** Narrower than this per column, the graph runs top to bottom. */
const MIN_COLUMN = 150;
/** Room around the graph for the name hung under a step and the lift of a working one. */
const PAD = 12;
/** At rest: laid out to the width at full size; zoom and pan from there. */
const REST = { x: PAD, y: PAD, zoom: 1 };
const IDLE: RunStepView = { state: "idle", handled: 0, found: 0, failed: 0, waiting: 0 };

export interface RunGraphProps {
  graph: FlowGraph;
  steps: ReadonlyMap<string, RunStep>;
  views: Record<string, RunStepView>;
  expected: Record<string, number>;
  input?: RunEnd | undefined;
  output?: RunEnd | undefined;
  over: boolean;
  /** Each node's state, the ends' too. */
  stateOf: (id: string) => RunStepState;
  /** Following: the nodes lit; the rest dim. */
  lit: ReadonlySet<string> | null;
  /** Whether the line from one node to another is on what's followed. */
  trace: (from: string, to: string) => boolean;
  picked: string | null;
  onPick: (id: string) => void;
  /** The last few lines about one subject: a spark rides into each one's step. */
  recent: readonly RunLine[];
  /** The newest line about one subject: its name hangs under its step. */
  chip: RunLine | null;
}

interface Drawn extends RunGraphProps {
  axis: FlowAxis;
  /** Each step's height as laid out, the tallest in its row; none while steps find their own. */
  stretch: ReadonlyMap<string, number> | null;
  at: ReadonlyMap<string, FlowNode>;
  ordinal: ReadonlyMap<string, number>;
  /** Each line's SVG path, by edge id. */
  paths: ReadonlyMap<string, string>;
  /** The line into each step that its sparks ride. */
  into: ReadonlyMap<string, string>;
}

const Graph = createContext<Drawn | null>(null);
const useGraph = () => {
  const g = use(Graph);
  if (!g) throw new Error("a run node outside RunGraph");
  return g;
};

const edgeId = (from: string, to: string) => `${from}>${to}`;

const DIM = "opacity-35";
/** A step's shadow: working beats picked, picked beats hover. */
const LIFT = {
  active: "-translate-y-0.5 shadow-[inset_0_0_0_1.5px_var(--ui-accent)]",
  picked:
    "shadow-[inset_0_0_0_1px_var(--ui-hair)] outline-2 outline-offset-2 outline-(--ui-accent)",
  rest: "shadow-[inset_0_0_0_1px_var(--ui-hair)] hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_var(--ui-ink-3),0_6px_16px_-6px_rgb(0_0_0/0.25)]",
};
const INDEX: Record<RunStepState, string> = {
  idle: "text-(--ui-ink-2) shadow-[inset_0_0_0_1.5px_var(--ui-hair)]",
  active: "bg-(--ui-accent) text-(--ui-on-accent)",
  done: "bg-(--ui-good) text-(--ui-paper)",
  waiting: "text-(--ui-ink-2) shadow-[inset_0_0_0_1.5px_var(--ui-ink-2)]",
};
const SOURCE = "row-2 text-[12px] leading-[1.3] text-(--ui-ink-2)";
const MIX: Record<keyof RunMix, string> = {
  found: "bg-(--ui-accent)",
  did: "bg-(--ui-ink-3)",
  failed: "bg-(--ui-bad)",
  waiting: "bg-[repeating-linear-gradient(135deg,var(--ui-ink-3)_0_2px,transparent_2px_4px)]",
};
const CHIP: Partial<Record<RunLineKind, string>> = {
  found: "bg-(--ui-accent) text-(--ui-on-accent)",
  failed: "bg-(--ui-bad) text-(--ui-paper)",
};
const RING = "shadow-[0_0_0_3px_var(--ui-tile)]";
const SPARK: Partial<Record<RunLineKind, string>> = {
  found: `bg-(--ui-accent) ${RING}`,
  failed: `bg-(--ui-bad) ${RING}`,
  waiting: "bg-(--ui-tile) shadow-[inset_0_0_0_1.5px_var(--ui-ink-2)]",
};

/** A step's ports, as the kit draws them: a ring each side; the path between is our own. */
const PORT = "size-[9px]! rounded-full! border-[1.5px]! border-(--ui-ink-3)! bg-(--ui-paper)!";
function Handles({ axis }: { axis: FlowAxis }) {
  const across = axis === "across";
  return (
    <>
      <Handle
        type="target"
        className={PORT}
        position={across ? Position.Left : Position.Top}
        isConnectable={false}
      />
      <Handle
        type="source"
        className={PORT}
        position={across ? Position.Right : Position.Bottom}
        isConnectable={false}
      />
    </>
  );
}

function StepNode({ id }: NodeProps) {
  const g = useGraph();
  const s = g.steps.get(id);
  const n = g.at.get(id);
  if (!s || !n) return null;
  const v = g.views[id] ?? IDLE;
  const mix = mixOf(v, g.expected[id] ?? 0);
  const split = g.axis === "down" && n.of > 1;
  // Down, a step alone on its row: one line, the count at the end.
  const alone = g.axis === "down" && !split;
  // Sharing a row on a phone: short names, no sources.
  const narrow = split ? "@max-[560px]/run:text-[11px]" : "";
  return (
    <div
      className={cx(
        "relative grid min-w-0 transition-opacity duration-350 ease-(--ui-ease) motion-reduce:transition-none",
        g.lit && !g.lit.has(id) && DIM,
      )}
      data-state={v.state}
      data-dim={g.lit && !g.lit.has(id) ? true : undefined}
      data-split={split || undefined}
      style={{ minHeight: g.stretch?.get(id) }}
    >
      <Handles axis={g.axis} />
      <button
        type="button"
        className={cx(
          // Name, source, then the spare room, so the counts and bars in a row line up.
          "grid min-w-0 cursor-pointer grid-rows-[auto_auto_1fr_auto] gap-x-2 gap-y-0.5 rounded-(--ui-radius) border-0 bg-(--ui-paper) px-3 pt-3 pb-3.5 text-left font-[inherit] text-[length:inherit] leading-[inherit] text-(--ui-ink) transition-[box-shadow,translate] duration-350 ease-(--ui-ease) motion-reduce:transition-none",
          alone ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)]",
          v.state === "active" ? LIFT.active : g.picked === id ? LIFT.picked : LIFT.rest,
          split && "@max-[560px]/run:p-2.5",
        )}
        aria-pressed={g.picked === id}
        onClick={() => g.onPick(id)}
      >
        <span
          className={cx(
            "grid size-5 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
            INDEX[v.state],
          )}
          aria-hidden="true"
        >
          {v.state === "done" ? <Icon name="check" size={11} /> : g.ordinal.get(id)}
        </span>
        <span className="self-center text-[14px] leading-[1.25] font-semibold">
          <span className={cx(split && "@max-[560px]/run:hidden")}>{s.label}</span>
          <span className={cx("hidden", split && "@max-[560px]/run:inline")} aria-hidden="true">
            {s.short ?? s.label}
          </span>
        </span>
        {s.source ? (
          <span
            className={cx(
              SOURCE,
              alone ? "col-2" : "col-span-full",
              split && "@max-[560px]/run:hidden",
            )}
          >
            {s.source}
          </span>
        ) : null}
        <span
          className={cx(
            "flex flex-wrap gap-x-2",
            alone
              ? "col-3 row-[1/span_2] flex-col items-end self-center text-right"
              : "col-span-full row-3 mt-1.5 items-baseline self-end",
          )}
        >
          <span
            className={cx(
              "font-(family-name:--ui-font-display) text-[24px] leading-[1.1] font-(--ui-display-weight) tracking-[calc(-0.03em*var(--ui-display-squeeze))] lining-nums tabular-nums",
              v.state === "idle" && "text-(--ui-ink-3)",
              split && "@max-[560px]/run:text-[20px]",
            )}
          >
            {num(v.handled)}
          </span>
          {s.found && v.found ? (
            <span className={cx("text-[12px] font-semibold text-(--ui-accent)", narrow)}>
              {num(v.found)} {s.found}
            </span>
          ) : null}
          {v.waiting ? (
            <span className={cx("text-[12px] text-(--ui-ink-2)", narrow)}>
              {num(v.waiting)} waiting
            </span>
          ) : null}
        </span>
        <span
          className="col-span-full row-4 mt-2 flex h-1 overflow-hidden rounded-(--ui-radius) bg-(--ui-fill)"
          aria-hidden="true"
        >
          {(["found", "did", "failed", "waiting"] as const).map((k) =>
            mix[k] ? (
              <i
                key={k}
                className={cx(
                  "block h-full flex-none transition-[width] duration-350 ease-(--ui-ease) motion-reduce:transition-none",
                  MIX[k],
                )}
                data-kind={k}
                style={{ width: `${mix[k] * 100}%` }}
              />
            ) : null,
          )}
        </span>
      </button>
      {g.chip?.step === id ? (
        // The name being worked on, hung on the bottom edge of the step working on it.
        <span
          key={g.chip.id}
          className={cx(
            "absolute bottom-0 left-2.5 z-1 w-fit max-w-[calc(100%-20px)] translate-y-1/2 animate-in overflow-hidden rounded-(--ui-radius) px-[9px] py-0.5 text-[12px] font-medium text-ellipsis whitespace-nowrap duration-350 ease-(--ui-ease) fade-in slide-in-from-left-[14px] motion-reduce:animate-none",
            CHIP[g.chip.kind] ?? "bg-(--ui-ink) text-(--ui-on-ink)",
          )}
          data-kind={g.chip.kind}
        >
          {g.chip.subject}
        </span>
      ) : null}
    </div>
  );
}

function EndNode({ id }: NodeProps) {
  const g = useGraph();
  const end = id === INPUT ? g.input : g.output;
  if (!end) return null;
  const state = g.stateOf(id);
  const down = g.axis === "down";
  return (
    // Where the run starts and where it hands off.
    <div
      className={cx(
        "relative grid min-w-0 content-center gap-0.5 rounded-(--ui-radius) px-3 py-2.5 transition-[opacity,box-shadow] duration-350 ease-(--ui-ease) motion-reduce:transition-none",
        state !== "done"
          ? "shadow-[inset_0_0_0_1.5px_var(--ui-hair)]"
          : id === OUTPUT
            ? "bg-(--ui-paper) shadow-[inset_0_0_0_1.5px_var(--ui-good)]"
            : "bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair)]",
        down && "text-center",
        g.lit && !g.lit.has(id) && DIM,
      )}
      data-node={id}
      data-state={state}
      data-dim={g.lit && !g.lit.has(id) ? true : undefined}
    >
      <Handles axis={g.axis} />
      <span
        className={cx(
          "inline-flex items-center gap-1.5 text-[13px] font-semibold",
          down && "justify-center",
        )}
      >
        {id === OUTPUT && g.over ? (
          <Icon name="check" size={12} className="text-(--ui-good-ink)" />
        ) : null}
        {end.label}
      </span>
      {end.note ? <span className={cx(SOURCE, "col-span-full")}>{end.note}</span> : null}
    </div>
  );
}

/** A line: done, flowing into a working step, or idle; a spark rides it for each new line. */
function RunEdge({ id, source, target }: EdgeProps) {
  const g = useGraph();
  const d = g.paths.get(id);
  if (!d) return null;
  const to = g.stateOf(target);
  const state = to === "active" ? "flowing" : g.stateOf(source) === "done" ? "done" : "idle";
  const sparks = g.recent.filter((l) => g.into.get(l.step) === id);
  const traced = g.trace(source, target);
  return (
    <>
      <path
        d={d}
        className={cx(
          "fill-none [stroke-linecap:round] transition-[stroke,opacity] duration-350 ease-(--ui-ease) motion-reduce:transition-none",
          traced
            ? "stroke-(--ui-accent) stroke-[2.5]"
            : state === "flowing"
              ? "animate-ui-run-flow stroke-(--ui-accent) stroke-[1.5] [stroke-dasharray:6_5] motion-reduce:animate-none"
              : state === "done"
                ? "stroke-(--ui-ink-3) stroke-[1.5]"
                : "stroke-(--ui-hair) stroke-[1.5] [stroke-dasharray:3_4]",
          g.lit && !traced && "opacity-25",
        )}
        data-state={state}
        data-trace={traced || undefined}
      />
      {sparks.length ? (
        <EdgeLabelRenderer>
          {sparks.map((l) => (
            <span
              key={l.id}
              className={cx(
                "pointer-events-none absolute top-0 left-0 size-[9px] animate-ui-run-spark rounded-full [offset-rotate:0deg] motion-reduce:hidden",
                SPARK[l.kind] ?? `bg-(--ui-ink-2) ${RING}`,
              )}
              data-kind={l.kind}
              style={{ offsetPath: `path("${d}")` }}
              aria-hidden="true"
            />
          ))}
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const NODE_TYPES = { step: StepNode, end: EndNode };
const EDGE_TYPES = { run: RunEdge };

export default function RunGraph(props: RunGraphProps) {
  const { graph, steps } = props;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  // A stretched step measures its stretch, so a new width lets steps take their own height
  // first. ponytail: in between, heights only grow (a replay restarting keeps the tallest).
  const [loose, setLoose] = useState(true);

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

  // React Flow measures each node; its height places the rest.
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (!changes.some((c) => c.type === "dimensions")) return;
    setLoose(false);
    setHeights((was) => {
      let next = was;
      for (const c of changes)
        if (c.type === "dimensions" && c.dimensions && next[c.id] !== c.dimensions.height)
          next = { ...next, [c.id]: c.dimensions.height };
      return next;
    });
  }, []);

  const axis: FlowAxis = width / Math.max(graph.cols, 1) >= MIN_COLUMN ? "across" : "down";
  const { boxes, height } = useMemo(
    () => layoutOf(graph, axis, width, heights),
    [graph, axis, width, heights],
  );
  const ready = graph.nodes.every((n) => heights[n.id] !== undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new width or axis is the cue.
  useLayoutEffect(() => setLoose(true), [width, axis]);

  const nodes = useMemo(
    () =>
      graph.nodes.map((n): RFNode => {
        const b = boxes[n.id] ?? { x: 0, y: 0, w: 0, h: 0 };
        const h = heights[n.id];
        return {
          id: n.id,
          type: n.id === INPUT || n.id === OUTPUT ? "end" : "step",
          position: { x: b.x, y: b.y },
          width: b.w,
          // Nothing selects or drags, so React Flow would let clicks through to the pane.
          style: { pointerEvents: "all" },
          data: {},
          ...(h === undefined ? {} : { measured: { width: b.w, height: h } }),
        };
      }),
    [graph, boxes, heights],
  );
  const edges = useMemo(
    () =>
      graph.edges.map(
        (e): Edge => ({ id: edgeId(e.from, e.to), source: e.from, target: e.to, type: "run" }),
      ),
    [graph],
  );

  const drawn = useMemo(() => {
    const paths = new Map<string, string>();
    const into = new Map<string, string>();
    for (const e of graph.edges) {
      const a = boxes[e.from];
      const b = boxes[e.to];
      if (a && b) paths.set(edgeId(e.from, e.to), edgePath(a, b, e.span, axis));
      if (!into.has(e.to)) into.set(e.to, edgeId(e.from, e.to));
    }
    const ordinal = new Map(
      graph.nodes.filter((n) => steps.has(n.id)).map((n, i) => [n.id, i + 1] as const),
    );
    const stretch =
      loose || !ready
        ? null
        : new Map(
            graph.nodes.filter((n) => steps.has(n.id)).map((n) => [n.id, boxes[n.id]?.h ?? 0]),
          );
    return { paths, into, ordinal, stretch, at: new Map(graph.nodes.map((n) => [n.id, n])) };
  }, [graph, boxes, axis, steps, loose, ready]);

  return (
    <div ref={box} data-axis={axis} data-following={props.lit ? true : undefined}>
      <div
        style={{ height: height + 2 * PAD, margin: -PAD, visibility: ready ? undefined : "hidden" }}
      >
        <Graph value={{ ...props, ...drawn, axis }}>
          <GraphFrame
            label="Steps"
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            height={height + 2 * PAD}
            rest={REST}
            fits
            bare
            flow={{ onNodesChange }}
          />
        </Graph>
      </div>
    </div>
  );
}
