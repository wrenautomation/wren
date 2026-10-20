/**
 * Two shape versions as one drawing (the Map's History): the newer version's nodes and edges, the
 * added ones marked added and the changed ones changed, with the older version's removed ones drawn
 * beside them, marked removed. `mark` is the graph kit's own diff look. Pure.
 */

import type { ShapeDiff } from "@wren/pipeline/diff";
import type { ShapeBody, ShapeNode } from "@wren/pipeline/model";
import type { GraphEdge, GraphNode } from "@wren/ui";
import { LOOK } from "./model.js";

/** What `pipeline/shapeDiff` answers: the two versions, what changed, and both bodies (a, b). */
export interface DiffAnswer {
  a: number;
  b: number;
  diff: ShapeDiff;
  bodies: [ShapeBody, ShapeBody];
}

/** A node as the graph kit draws it, with no numbers: a diff compares shapes, not people. */
export const nodeOf = (n: ShapeNode, mark?: GraphNode["mark"]): GraphNode => ({
  id: n.id,
  kind: LOOK[n.kind].kind,
  tint: LOOK[n.kind].tint,
  label: n.name,
  ...(mark ? { mark } : {}),
});

export function diffGraph(a: ShapeBody, b: ShapeBody, diff: ShapeDiff) {
  const added = new Set(diff.nodes.added);
  const changed = new Set([...diff.nodes.changed, ...diff.nodes.renamed.map((r) => r.id)]);
  const nodes: GraphNode[] = b.nodes.map((n) =>
    nodeOf(n, added.has(n.id) ? "added" : changed.has(n.id) ? "changed" : undefined),
  );
  for (const n of a.nodes) if (diff.nodes.removed.includes(n.id)) nodes.push(nodeOf(n, "removed"));
  const mark = (id: string): GraphEdge["mark"] =>
    diff.edges.added.includes(id)
      ? "added"
      : diff.edges.changed.includes(id)
        ? "changed"
        : undefined;
  const edge = (e: ShapeBody["edges"][number], m: GraphEdge["mark"]): GraphEdge => ({
    from: e.from,
    to: e.to,
    ...(e.label ? { label: e.label } : {}),
    ...(m ? { mark: m } : {}),
    ...(e.kind === "loop" ? { loop: true as const } : {}),
  });
  const edges: GraphEdge[] = b.edges.map((e) => edge(e, mark(e.id)));
  for (const e of a.edges) if (diff.edges.removed.includes(e.id)) edges.push(edge(e, "removed"));
  return { nodes, edges };
}

/** The list under the drawing: one plain line per change, by node name. */
export function diffLines(a: ShapeBody, b: ShapeBody, diff: ShapeDiff): string[] {
  const name = (id: string, old = false) => {
    const [x, y] = old ? [a, b] : [b, a];
    return x.nodes.find((n) => n.id === id)?.name ?? y.nodes.find((n) => n.id === id)?.name ?? id;
  };
  /** A removed edge is named as the older version knew it. */
  const edgeName = (id: string, old = false) => {
    const e = (old ? a : b).edges.find((x) => x.id === id);
    return e ? `${name(e.from, old)} to ${name(e.to, old)}` : id;
  };
  return [
    ...(diff.name ? [`Shape renamed from ${diff.name.from} to ${diff.name.to}.`] : []),
    ...diff.nodes.added.map((id) => `Added node ${name(id)}.`),
    ...diff.nodes.removed.map((id) => `Removed node ${name(id, true)}.`),
    ...diff.nodes.renamed.map((r) => `Renamed node ${r.from} to ${r.to}.`),
    ...diff.nodes.changed.map((id) => `Changed node ${name(id)}.`),
    ...diff.edges.added.map((id) => `Added edge ${edgeName(id)}.`),
    ...diff.edges.removed.map((id) => `Removed edge ${edgeName(id, true)}.`),
    ...diff.edges.changed.map((id) => `Changed edge ${edgeName(id)}.`),
  ];
}
