/**
 * A FlowMap on the graph kit: each box a node, each `after` a wire carrying its label. Accounts
 * and a workflow's own ends are dashed, a workflow inside is a stack, each box is a link. With
 * `edit`, a box shows handles to drag a line from and onto, and a line can be clicked.
 */

import type { FlowEdit, MapBox } from "./flow-map.js";
import GraphCanvas from "./graph/canvas.js";
import type { GraphEdge, GraphNode } from "./graph/model.js";

const END = /^(in|out)\./;

/** The words a box's note says it is in, as a filter. */
const stateOf = (b: MapBox) =>
  b.input ? "Account" : b.dim ? "Not here" : b.note?.split(". ")[0] || "Ready";

export function nodesOf(boxes: readonly MapBox[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const ids = new Set(boxes.map((b) => b.id));
  const nodes = boxes.map(
    (b): GraphNode => ({
      id: b.id,
      // A workflow's own ends are `in.x` and `out.x`; any other input is an account it uses.
      kind: !b.input ? (b.stacked ? "workflow" : "part") : END.test(b.id) ? "record" : "account",
      dashed: b.input,
      label: b.label,
      note: b.note,
      lines: b.count ? [{ text: b.count }] : undefined,
      href: b.href,
      dim: b.dim,
      stacked: b.stacked,
      facets: {
        Kind: b.input ? (END.test(b.id) ? "End" : "Account") : b.stacked ? "Workflow" : "Part",
        State: stateOf(b),
      },
    }),
  );
  const edges = boxes.flatMap((b) =>
    b.after
      .filter((a) => ids.has(a))
      .map((a): GraphEdge => {
        const [label, ...notes] = (b.labels?.[a] ?? "").split("\n").filter(Boolean);
        return { from: a, to: b.id, label, notes };
      }),
  );
  return { nodes, edges };
}

export default function FlowMapGraph({
  boxes,
  label,
  edit,
  tools,
}: {
  boxes: readonly MapBox[];
  label: string;
  edit?: FlowEdit | undefined;
  tools?: boolean | undefined;
}) {
  const { nodes, edges } = nodesOf(boxes);
  return (
    <GraphCanvas
      nodes={nodes}
      edges={edges}
      label={label}
      edit={edit}
      tools={tools ?? boxes.length > 6}
    />
  );
}
