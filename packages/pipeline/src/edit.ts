/**
 * Small edits of a shape body (designs/2026-10-19-business-map.md): add a node, connect two nodes,
 * remove a node or an edge. Pure, so the CLI now and an editor later share them. Each gives back a
 * new body and checks nothing beyond its own argument: `saveShape` checks the whole shape and
 * refuses with every reason. `editShape` reads the newest body, applies one edit and saves it.
 */
import type { Queryable } from "@wren/db";
import { and, count, eq } from "drizzle-orm";
import type { Moves } from "./carry.js";
import { edgeIdOf, type ShapeBody, type ShapeEdge, type ShapeNode } from "./model.js";
import { journeys } from "./schema.js";
import { newestShape, Refused, saveShape } from "./store.js";

/** The body with `node` added, and `edges` with it. Refused when the id is taken. */
export function withNode(body: ShapeBody, node: ShapeNode, edges: ShapeEdge[] = []): ShapeBody {
  if (body.nodes.some((n) => n.id === node.id))
    throw new Refused([`The shape already has a node ${node.id}.`]);
  return { ...body, nodes: [...body.nodes, node], edges: [...body.edges, ...edges] };
}

/** A flow edge from `from` to `to`, or a loop edge. The id follows the default unless given. */
export function edgeOf(
  from: string,
  to: string,
  o: { loop?: boolean; label?: string; id?: string } = {},
): ShapeEdge {
  return {
    id: o.id ?? (o.loop ? `${from}_loop_${to}` : edgeIdOf(from, to)),
    from,
    to,
    kind: o.loop ? "loop" : "flow",
    ...(o.label ? { label: o.label } : {}),
  };
}

/** The body with `edge` added. Refused when both ends are not nodes, or the id is taken. */
export function withEdge(body: ShapeBody, edge: ShapeEdge): ShapeBody {
  const ids = new Set(body.nodes.map((n) => n.id));
  const errors = [edge.from, edge.to]
    .filter((id) => !ids.has(id))
    .map((id) => `The shape has no node ${id}.`);
  if (body.edges.some((e) => e.id === edge.id))
    errors.push(`The shape already has an edge ${edge.id}.`);
  if (errors.length) throw new Refused(errors);
  return { ...body, edges: [...body.edges, edge] };
}

/** The body without node `id` and every edge that touches it. Refused when there is no such node. */
export function withoutNode(body: ShapeBody, id: string): ShapeBody {
  if (!body.nodes.some((n) => n.id === id)) throw new Refused([`The shape has no node ${id}.`]);
  return {
    ...body,
    nodes: body.nodes.filter((n) => n.id !== id),
    edges: body.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

/** The body without edge `id`. Refused when there is no such edge. */
export function withoutEdge(body: ShapeBody, id: string): ShapeBody {
  if (!body.edges.some((e) => e.id === id)) throw new Refused([`The shape has no edge ${id}.`]);
  return { ...body, edges: body.edges.filter((e) => e.id !== id) };
}

/** How many open journeys sit on node `id` now. */
export async function openOn(db: Queryable, id: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(journeys)
    .where(and(eq(journeys.node, id), eq(journeys.status, "open")));
  return row?.n ?? 0;
}

/**
 * Read the newest body, apply `change` and save the result as the next version. Refused when
 * there is no shape yet, or when `saveShape` refuses.
 */
export async function editShape(
  db: Queryable,
  o: {
    change: (body: ShapeBody) => ShapeBody;
    note: string;
    by: string;
    triggers: ReadonlySet<string>;
    moves?: Moves;
  },
) {
  const newest = await newestShape(db);
  if (!newest) throw new Refused(["The workspace has no shape yet. Import one first."]);
  return saveShape(db, {
    body: o.change(newest.body),
    note: o.note,
    by: o.by,
    triggers: o.triggers,
    ...(o.moves ? { moves: o.moves } : {}),
  });
}
