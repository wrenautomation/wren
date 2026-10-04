/**
 * A genome's versions on React Flow, read-only, oldest at the top: each node says what that
 * version added and retired, the line runs from its parent. Its own chunk, loaded when shown.
 */
import { type Edge, Handle, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { cx } from "./format.js";
import type { LineageVersion } from "./lineage.js";

/** Lines of copy shown per side before "and N more". */
const SHOWN = 3;
const WIDTH = 300;
const GAP = 28;
const HEAD = 40;
const LINE = 19;

type Data = { v: LineageVersion; first: boolean };
const linesOf = (v: LineageVersion) =>
  Math.min(v.added.length, SHOWN + 1) + Math.min(v.retired.length, SHOWN + 1);
const heightOf = (v: LineageVersion, first: boolean) =>
  HEAD + (first ? LINE : linesOf(v) * LINE || LINE) + 10;

function Side({ sign, items }: { sign: "+" | "−"; items: LineageVersion["added"] }) {
  const more = items.length - SHOWN;
  return (
    <>
      {items.slice(0, SHOWN).map((a) => (
        <li key={`${a.locus}/${a.text}`} className="truncate" title={`${a.locus}: ${a.text}`}>
          <span className={sign === "+" ? "text-(--ui-good)" : "text-(--ui-ink-3)"}>{sign}</span>{" "}
          <span className="text-(--ui-ink-2)">{a.locus}:</span> {a.text}
        </li>
      ))}
      {more > 0 ? <li className="text-(--ui-ink-2)">and {more} more</li> : null}
    </>
  );
}

function VersionNode({ data }: NodeProps<Node<Data>>) {
  const { v, first } = data;
  return (
    <div
      className={cx(
        "grid gap-1 rounded-(--ui-radius) border bg-(--ui-paper) px-3 py-2 text-[12.5px] leading-[19px] text-(--ui-ink)",
        v.live ? "border-(--ui-ink)" : "border-(--ui-hair)",
      )}
      style={{ width: WIDTH }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" isConnectable={false} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[12px]">{v.version}</span>
        <span className="text-[11.5px] text-(--ui-ink-2)">
          {v.live ? "Live · " : ""}
          {new Date(v.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      </div>
      <ul className="grid min-w-0">
        {first ? (
          <li className="text-(--ui-ink-2)">Started from the template</li>
        ) : v.added.length || v.retired.length ? (
          <>
            <Side sign="+" items={v.added} />
            <Side sign="−" items={v.retired} />
          </>
        ) : (
          <li className="text-(--ui-ink-2)">No copy changed</li>
        )}
      </ul>
      <Handle
        type="source"
        position={Position.Bottom}
        className="opacity-0"
        isConnectable={false}
      />
    </div>
  );
}

const NODE_TYPES = { version: VersionNode };

export default function LineageGraph({ versions }: { versions: readonly LineageVersion[] }) {
  let y = 0;
  const nodes: Node<Data>[] = versions.map((v, i) => {
    const node = {
      id: v.version,
      type: "version",
      position: { x: 0, y },
      data: { v, first: i === 0 },
    };
    y += heightOf(v, i === 0) + GAP;
    return node;
  });
  const edges: Edge[] = versions.flatMap((v) =>
    v.parent
      ? [
          {
            id: `${v.parent}>${v.version}`,
            source: v.parent,
            target: v.version,
            style: { stroke: "var(--ui-ink-3)" },
          },
        ]
      : [],
  );
  return (
    <div className="w-full max-w-full overflow-hidden" style={{ height: Math.max(y - GAP, 0) + 4 }}>
      <ReactFlow
        aria-label="Versions"
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        defaultViewport={{ x: 1, y: 1, zoom: 1 }}
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
  );
}
