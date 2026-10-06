/**
 * A genome's versions on the graph kit, oldest at the top: each node says what that version
 * added and retired, the line runs from its parent. Its own chunk, loaded when shown.
 */
import GraphCanvas from "./graph/canvas.js";
import type { GraphEdge, GraphNode } from "./graph/model.js";
import type { LineageVersion } from "./lineage.js";

/** Lines of copy shown per side before "and N more". */
const SHOWN = 3;

type Line = NonNullable<GraphNode["lines"]>[number];
const side = (sign: "+" | "−", items: LineageVersion["added"]): Line[] => [
  ...items.slice(0, SHOWN).map((a) => ({ sign, text: `${a.locus}: ${a.text}` })),
  ...(items.length > SHOWN ? [{ text: `and ${items.length - SHOWN} more` }] : []),
];

export function versionNodes(versions: readonly LineageVersion[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes = versions.map(
    (v, i): GraphNode => ({
      id: v.version,
      kind: "record",
      label: v.version,
      state: v.live ? { label: "Live", tone: "good" } : undefined,
      note: new Date(v.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      lines:
        i === 0
          ? [{ text: "Started from the template" }]
          : v.added.length || v.retired.length
            ? [...side("+", v.added), ...side("−", v.retired)]
            : [{ text: "No copy changed" }],
      facets: { State: v.live ? "Live" : "Retired" },
    }),
  );
  const edges = versions.flatMap((v): GraphEdge[] =>
    v.parent ? [{ from: v.parent, to: v.version }] : [],
  );
  return { nodes, edges };
}

export default function LineageGraph({ versions }: { versions: readonly LineageVersion[] }) {
  const { nodes, edges } = versionNodes(versions);
  return (
    <GraphCanvas
      nodes={nodes}
      edges={edges}
      label="Versions"
      direction="down"
      tools={nodes.length > 6}
      name="versions"
    />
  );
}
