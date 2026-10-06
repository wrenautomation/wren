/**
 * Auto layout with elkjs (layered): columns left to right, or rows top to bottom on a phone.
 * The same graph lays out the same way every load: nodes and wires keep their given order and
 * the seed is fixed. elk loads on first use, in its own chunk.
 */
import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import type { Laid, Point } from "./model.js";

export type Direction = "RIGHT" | "DOWN";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}
export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  /** Room its words take; elk keeps it clear. */
  label?: { width: number; height: number } | undefined;
}

let elk: Promise<ELK> | null = null;
const elkOf = () => {
  elk ??= import("elkjs/lib/elk.bundled.js").then((m) => {
    const Elk = (m as unknown as { default: new () => ELK }).default;
    return new Elk();
  });
  return elk;
};

/** Gaps (px): between columns, between nodes in one, and a wire's words from its line. */
const GAP = { layers: 64, nodes: 22, label: 4 };

export async function layout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  dir: Direction,
  /** Between columns: wider when wires carry words. */
  layers = GAP.layers,
): Promise<Laid> {
  const ids = new Set(nodes.map((n) => n.id));
  // A wire back into its own node, or to one not drawn, has no route here.
  const drawn = edges.filter((e) => e.from !== e.to && ids.has(e.from) && ids.has(e.to));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": dir,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.randomSeed": "1",
      "elk.spacing.nodeNode": String(GAP.nodes),
      "elk.spacing.edgeNode": "14",
      "elk.spacing.edgeEdge": "10",
      "elk.spacing.edgeLabel": String(GAP.label),
      "elk.spacing.componentComponent": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layers),
      "elk.layered.spacing.edgeNodeBetweenLayers": "18",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.edgeLabels.sideSelection": dir === "RIGHT" ? "ALWAYS_UP" : "ALWAYS_DOWN",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    },
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: drawn.map(
      (e): ElkExtendedEdge => ({
        id: e.id,
        sources: [e.from],
        targets: [e.to],
        ...(e.label?.width
          ? {
              labels: [
                {
                  id: `${e.id}:words`,
                  width: e.label.width,
                  height: e.label.height,
                  // elk skips a label with no text, whatever its size.
                  text: "words",
                },
              ],
            }
          : {}),
      }),
    ),
  };
  const out = await (await elkOf()).layout(graph);
  const laid: Laid = { width: out.width ?? 0, height: out.height ?? 0, nodes: {}, edges: {} };
  for (const c of out.children ?? [])
    laid.nodes[c.id] = { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 };
  for (const e of (out.edges ?? []) as ElkExtendedEdge[]) {
    const s = e.sections?.[0];
    if (!s) continue;
    const points: Point[] = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
    const l = e.labels?.[0];
    laid.edges[e.id] = {
      points,
      label: l && l.x !== undefined && l.y !== undefined ? { x: l.x, y: l.y } : undefined,
    };
  }
  return laid;
}
