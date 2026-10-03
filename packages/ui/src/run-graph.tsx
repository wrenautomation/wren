/**
 * A run's steps drawn on React Flow, read-only: `flow.ts` places them, React Flow draws the
 * nodes, the lines between them and the sparks riding in. Its own chunk, loaded when a run shows.
 * Editing a flow later turns on dragging and connecting here.
 */
import {
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  type Node as RFNode,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
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
import { num } from "./format.js";
import { Icon } from "./icons.js";
import {
  mixOf,
  type RunEnd,
  type RunLine,
  type RunStep,
  type RunStepState,
  type RunStepView,
} from "./run.js";

/** Narrower than this per column, the graph runs top to bottom. */
const MIN_COLUMN = 150;
/** Room around the graph for the name hung under a step and the lift of a working one. */
const PAD = 12;
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

/** React Flow draws a line between handles; ours are hidden, the path is our own. */
function Handles({ axis }: { axis: FlowAxis }) {
  const across = axis === "across";
  return (
    <>
      <Handle
        type="target"
        position={across ? Position.Left : Position.Top}
        isConnectable={false}
      />
      <Handle
        type="source"
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
  return (
    <div
      className="ui-run-node"
      data-state={v.state}
      data-dim={g.lit && !g.lit.has(id) ? true : undefined}
      data-split={g.axis === "down" && n.of > 1 ? true : undefined}
      style={{ minHeight: g.stretch?.get(id) }}
    >
      <Handles axis={g.axis} />
      <button
        type="button"
        className="ui-run-step"
        aria-pressed={g.picked === id}
        onClick={() => g.onPick(id)}
      >
        <span className="ui-run-index" aria-hidden="true">
          {v.state === "done" ? <Icon name="check" size={11} /> : g.ordinal.get(id)}
        </span>
        <span className="ui-run-name">
          <span className="ui-run-long">{s.label}</span>
          <span className="ui-run-short" aria-hidden="true">
            {s.short ?? s.label}
          </span>
        </span>
        {s.source ? <span className="ui-run-source">{s.source}</span> : null}
        <span className="ui-run-tally">
          <span className="ui-run-count">{num(v.handled)}</span>
          {s.found && v.found ? (
            <span className="ui-run-found">
              {num(v.found)} {s.found}
            </span>
          ) : null}
          {v.waiting ? <span className="ui-run-parked">{num(v.waiting)} waiting</span> : null}
        </span>
        <span className="ui-run-mix" aria-hidden="true">
          {(["found", "did", "failed", "waiting"] as const).map((k) =>
            mix[k] ? <i key={k} data-kind={k} style={{ width: `${mix[k] * 100}%` }} /> : null,
          )}
        </span>
      </button>
      {g.chip?.step === id ? (
        <span key={g.chip.id} className="ui-run-chip" data-kind={g.chip.kind}>
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
  return (
    <div
      className="ui-run-end"
      data-node={id}
      data-state={g.stateOf(id)}
      data-dim={g.lit && !g.lit.has(id) ? true : undefined}
    >
      <Handles axis={g.axis} />
      <span className="ui-run-end-name">
        {id === OUTPUT && g.over ? <Icon name="check" size={12} /> : null}
        {end.label}
      </span>
      {end.note ? <span className="ui-run-source">{end.note}</span> : null}
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
  return (
    <>
      <path
        d={d}
        className="ui-run-edge"
        data-state={state}
        data-trace={g.trace(source, target) || undefined}
      />
      {sparks.length ? (
        <EdgeLabelRenderer>
          {sparks.map((l) => (
            <span
              key={l.id}
              className="ui-run-spark"
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
    <div
      ref={box}
      className="ui-run-graph"
      data-axis={axis}
      data-following={props.lit ? true : undefined}
    >
      <div
        style={{ height: height + 2 * PAD, margin: -PAD, visibility: ready ? undefined : "hidden" }}
      >
        <Graph value={{ ...props, ...drawn, axis }}>
          <ReactFlow
            aria-label="Steps"
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            defaultViewport={{ x: PAD, y: PAD, zoom: 1 }}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag={false}
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            panActivationKeyCode={null}
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            zoomActivationKeyCode={null}
            disableKeyboardA11y
            proOptions={{ hideAttribution: true }}
          />
        </Graph>
      </div>
    </div>
  );
}
