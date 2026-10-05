/**
 * A FlowMap on React Flow, read-only: `flow.ts` places the columns and draws the lines, each box
 * is a link. Always left to right, each start just before what uses it; narrower than its columns, it scrolls sideways in its own box.
 */
import {
  type Edge,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { edgePath, flowOf, layoutOf } from "./flow.js";
import type { MapBox } from "./flow-map.js";
import { cx } from "./format.js";

/** A column's width, at least and at most: past the most, a short map leaves room on the right. */
const COLUMN = { min: 110, max: 200 };
const HEIGHT = 58;
const GAP_X = 40;

function BoxNode({ data }: NodeProps<Node<{ box: MapBox }>>) {
  const b = data.box;
  const Tag = b.href ? "a" : "div";
  return (
    <>
      <Handle type="target" position={Position.Left} className="invisible" isConnectable={false} />
      <Tag
        href={b.href}
        className={cx(
          "grid h-full content-center gap-0.5 rounded-(--ui-radius) px-3 text-(--ui-ink) no-underline",
          b.input
            ? "border border-dashed border-(--ui-ink-3)"
            : "bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair)] hover:shadow-[inset_0_0_0_1px_var(--ui-ink-3)]",
          b.dim && "opacity-45",
        )}
        style={{ height: HEIGHT }}
      >
        <span className="line-clamp-2 text-[13px] leading-[1.25] font-semibold">{b.label}</span>
        {b.note ? (
          <span className="truncate text-[12px] leading-[1.3] text-(--ui-ink-2)">{b.note}</span>
        ) : null}
      </Tag>
      <Handle type="source" position={Position.Right} className="invisible" isConnectable={false} />
    </>
  );
}

function Line({ data }: EdgeProps<Edge<{ d: string }>>) {
  return data ? (
    <path
      d={data.d}
      className="fill-none stroke-(--ui-ink-3) stroke-[1.5] [stroke-linecap:round]"
    />
  ) : null;
}

const NODE_TYPES = { box: BoxNode };
const EDGE_TYPES = { line: Line };

export default function FlowMapGraph({
  boxes,
  label,
}: {
  boxes: readonly MapBox[];
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setRoom(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const graph = useMemo(() => flowOf(boxes, () => true, undefined, true), [boxes]);
  const across = (w: number) => graph.cols * w + (graph.cols - 1) * GAP_X;
  const width = Math.max(across(COLUMN.min), Math.min(room, across(COLUMN.max)));
  const { nodes, edges, height } = useMemo(() => {
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const heights = Object.fromEntries(boxes.map((b) => [b.id, HEIGHT]));
    const laid = layoutOf(graph, "across", width, heights);
    const at = (id: string) => laid.boxes[id] ?? { x: 0, y: 0, w: 0, h: 0 };
    return {
      height: laid.height,
      nodes: graph.nodes.map(
        (n): Node<{ box: MapBox }> => ({
          id: n.id,
          type: "box",
          position: { x: at(n.id).x, y: at(n.id).y },
          width: at(n.id).w,
          height: HEIGHT,
          // Nothing selects or drags, so React Flow would let clicks through to the pane.
          style: { pointerEvents: "all" },
          data: { box: byId.get(n.id) ?? { id: n.id, label: n.id, after: [] } },
        }),
      ),
      edges: graph.edges.map(
        (e): Edge<{ d: string }> => ({
          id: `${e.from}>${e.to}`,
          source: e.from,
          target: e.to,
          type: "line",
          data: { d: edgePath(at(e.from), at(e.to), e.span, "across") },
        }),
      ),
    };
  }, [boxes, graph, width]);

  return (
    <div ref={ref} className="w-full max-w-full overflow-x-auto">
      <div style={{ width, height: height + 2 }}>
        <ReactFlow
          aria-label={label}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultViewport={{ x: 0, y: 1, zoom: 1 }}
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
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomActivationKeyCode={null}
          panActivationKeyCode={null}
          disableKeyboardA11y
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </div>
  );
}
