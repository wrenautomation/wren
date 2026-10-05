/**
 * A FlowMap on React Flow, read-only: `flow.ts` places the columns and draws the lines, each box
 * is a link. Always left to right, each start just before what uses it; narrower than its columns, it scrolls sideways in its own box.
 * Labeled lines widen the gaps so the labels sit between the columns.
 */
import {
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { edgePath, flowOf, labelAt, layoutOf } from "./flow.js";
import type { MapBox } from "./flow-map.js";
import { cx } from "./format.js";

/** A column's width, at least and at most: past the most, a short map leaves room on the right. */
const COLUMN = { min: 110, max: 200 };
const HEIGHT = 58;
const GAP_X = 40;
const LABELED_GAP_X = 150;
/** A box's padding and rows (px), and about how wide a character of each is. */
const PAD = { x: 24, y: 18 };
const ROW = { label: 16.25, small: 15.6 };
const CHAR = { label: 7.4, small: 6.6 };

/** Tall enough for the label and number (two rows each at most) and the note (three). */
function heightOf(b: MapBox, w: number): number {
  const rows = (s: string | undefined, char: number, most = 2) =>
    s ? Math.min(most, Math.ceil((s.length * char) / (w - PAD.x))) : 0;
  const small = rows(b.note, CHAR.small, 3) + rows(b.count, CHAR.small);
  return Math.max(HEIGHT, PAD.y + ROW.label * rows(b.label, CHAR.label) + ROW.small * small);
}

function BoxNode({ data }: NodeProps<Node<{ box: MapBox; height: number }>>) {
  const b = data.box;
  const Tag = b.href ? "a" : "div";
  return (
    <>
      <Handle type="target" position={Position.Left} className="invisible" isConnectable={false} />
      <Tag
        href={b.href}
        title={[b.label, b.note, b.count].filter(Boolean).join(". ")}
        className={cx(
          "grid h-full content-center gap-0.5 rounded-(--ui-radius) px-3 text-(--ui-ink) no-underline",
          b.input
            ? "border border-dashed border-(--ui-ink-3)"
            : b.stacked
              ? "bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair),4px_4px_0_-1px_var(--ui-paper),4px_4px_0_0_var(--ui-hair)] hover:shadow-[inset_0_0_0_1px_var(--ui-ink-3),4px_4px_0_-1px_var(--ui-paper),4px_4px_0_0_var(--ui-ink-3)]"
              : "bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair)] hover:shadow-[inset_0_0_0_1px_var(--ui-ink-3)]",
          b.dim && "opacity-45",
        )}
        style={{ height: data.height }}
      >
        <span className="line-clamp-2 text-[13px] leading-[1.25] font-semibold">{b.label}</span>
        {b.note ? (
          <span className="line-clamp-3 text-[12px] leading-[1.3] text-(--ui-ink-2)">{b.note}</span>
        ) : null}
        {b.count ? (
          <span className="line-clamp-2 text-[12px] leading-[1.3] text-(--ui-ink) tabular-nums">
            {b.count}
          </span>
        ) : null}
      </Tag>
      <Handle type="source" position={Position.Right} className="invisible" isConnectable={false} />
    </>
  );
}

type LineData = {
  d: string;
  label?: { text: string; x: number; y: number; anchor: "start" | "end"; max: number } | undefined;
};

function Line({ data }: EdgeProps<Edge<LineData>>) {
  if (!data) return null;
  const l = data.label;
  return (
    <>
      <path
        d={data.d}
        className="fill-none stroke-(--ui-ink-3) stroke-[1.5] [stroke-linecap:round]"
      />
      {l ? (
        // Above every line, its bottom row resting on the spot; long ones wrap upward in the gap.
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute bg-(--ui-paper) px-0.5 text-[11px] leading-[1.25] whitespace-pre-line text-(--ui-ink-2)"
            style={{
              maxWidth: l.max,
              textAlign: l.anchor === "end" ? "right" : "left",
              transform: `translate(${l.anchor === "end" ? "-100%" : "0"}, -100%) translate(${l.x}px, ${l.y}px)`,
            }}
          >
            {l.text}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
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
  const labeled = boxes.some((b) => b.labels && Object.keys(b.labels).length);
  const gapX = labeled ? LABELED_GAP_X : GAP_X;
  const across = (w: number) => graph.cols * w + (graph.cols - 1) * gapX;
  const width = Math.max(across(COLUMN.min), Math.min(room, across(COLUMN.max)));
  const drawn = useMemo(() => {
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const column = (width - (graph.cols - 1) * gapX) / graph.cols;
    // Every box as tall as the tallest, so the lines between boxes stay straight.
    const height = Math.max(HEIGHT, ...boxes.map((b) => heightOf(b, column)));
    const heights = Object.fromEntries(boxes.map((b) => [b.id, height]));
    const laid = layoutOf(graph, "across", width, heights, gapX);
    const at = (id: string) => laid.boxes[id] ?? { x: 0, y: 0, w: 0, h: 0 };
    return {
      height: laid.height,
      nodes: graph.nodes.map(
        (n): Node<{ box: MapBox; height: number }> => ({
          id: n.id,
          type: "box",
          position: { x: at(n.id).x, y: at(n.id).y },
          width: at(n.id).w,
          height: at(n.id).h,
          // Nothing selects or drags, so React Flow would let clicks through to the pane.
          style: { pointerEvents: "all" },
          data: {
            box: byId.get(n.id) ?? { id: n.id, label: n.id, after: [] },
            height: at(n.id).h,
          },
        }),
      ),
      edges: graph.edges.map((e): Edge<LineData> => {
        const text = byId.get(e.to)?.labels?.[e.from];
        const end = graph.edges.filter((x) => x.from === e.from).length === 1 ? "from" : "to";
        return {
          id: `${e.from}>${e.to}`,
          source: e.from,
          target: e.to,
          type: "line",
          data: {
            // The turn sits at the end away from the label, so the label has the long side.
            d: edgePath(
              at(e.from),
              at(e.to),
              e.span,
              "across",
              6,
              labeled ? (end === "from" ? "to" : "from") : undefined,
            ),
            label: text
              ? { text, max: gapX - 32, ...labelAt(at(e.from), at(e.to), e.span, end) }
              : undefined,
          },
        };
      }),
    };
  }, [boxes, graph, width, gapX, labeled]);
  const { nodes, edges } = drawn;

  return (
    <div ref={ref} className="w-full max-w-full overflow-x-auto">
      <div style={{ width, height: drawn.height + 2 }}>
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
