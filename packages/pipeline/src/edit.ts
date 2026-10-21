/**
 * Small edits of a shape body (designs/2026-10-19-business-map.md): add a node, connect two nodes,
 * remove a node or an edge. Pure, so the CLI now and an editor later share them. Each gives back a
 * new body and checks nothing beyond its own argument: `saveShape` checks the whole shape and
 * refuses with every reason. `editShape` reads the newest body, applies one edit and saves it.
 */
import type { Queryable } from "@wren/db";
import { and, count, eq } from "drizzle-orm";
import type { Moves } from "./carry.js";
import { canonicalJson, changeKey, changesOf, diffShapes, type ShapeChange } from "./diff.js";
import { isMetro } from "./metro.js";
import type { MetroChange } from "./metro-diff.js";
import { undoMetroChange } from "./metro-edit.js";
import { edgeIdOf, type ShapeBody, type ShapeEdge, type ShapeNode } from "./model.js";
import { journeys } from "./schema.js";
import { newestShape, Refused, saveShape } from "./store.js";
import { metroView, runOf, type StoredBody, type StoredChange } from "./stored.js";

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

/** What an undo by station, track or line says when the newest version is on the graph model. */
export const ON_GRAPH = "The shape is on the graph model. Undo by node or edge.";

/** What an edit of the graph says when the newest version is on the metro model. */
export const ON_METRO = "The shape is on the metro model. Export, edit the YAML, import.";

/**
 * Read the newest body, apply `change` and save the result as the next version. Refused when
 * there is no shape yet, when the newest version is on the metro model (these edits are graph
 * edits: export, edit the YAML, import), or when `saveShape` refuses.
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
  if (isMetro(newest.body)) throw new Refused([ON_METRO]);
  return saveShape(db, {
    body: o.change(newest.body),
    note: o.note,
    by: o.by,
    triggers: o.triggers,
    ...(o.moves ? { moves: o.moves } : {}),
  });
}

/**
 * The inverse of one change from version `a` to version `b`, applied to `newest`
 * (designs/2026-10-19-business-map.md, "Undo one change"). Pure; refused (`Refused`) when the
 * newest body no longer holds what `b` had for that line. `saveShape` checks the result.
 */
export function undoChange(
  newest: ShapeBody,
  a: ShapeBody,
  b: ShapeBody,
  change: ShapeChange,
): ShapeBody {
  const key = changeKey(change);
  if (!changesOf(diffShapes(a, b)).some((c) => changeKey(c) === key))
    throw new Refused(["That change is not between these versions."]);
  const later = (what: string) => new Refused([`${what} Undo the later change first.`]);
  /** A node's name, from the newest body first, then b, then a. */
  const nameOf = (id: string) =>
    [newest, b, a].map((x) => x.nodes.find((n) => n.id === id)?.name).find((n) => n) ?? id;
  const edgeName = (e: ShapeEdge) => `${nameOf(e.from)} to ${nameOf(e.to)}`;
  const nodeIn = (body: ShapeBody, id: string) => body.nodes.find((n) => n.id === id);
  const edgeIn = (body: ShapeBody, id: string) => body.edges.find((e) => e.id === id);
  const sameJson = (x: unknown, y: unknown) => canonicalJson(x) === canonicalJson(y);
  const withoutName = (n: ShapeNode): ShapeNode => ({ ...n, name: "" });

  if (change.on === "name") {
    if (newest.name !== b.name)
      throw later(`The shape is now called ${newest.name}, not ${b.name}.`);
    return { ...newest, name: a.name };
  }

  if (change.on === "node") {
    const { id } = change;
    const was = nodeIn(a, id);
    const then = nodeIn(b, id);
    const now = nodeIn(newest, id);
    if (change.how === "added") {
      if (!now) throw new Refused([`Node ${nameOf(id)} is not in the shape any more.`]);
      return withoutNode(newest, id);
    }
    if (change.how === "removed") {
      if (now) throw later(`Node ${now.name} is in the shape again.`);
      if (!was) throw new Refused(["That change is not between these versions."]);
      const kept = new Set(newest.nodes.map((n) => n.id));
      kept.add(id);
      const taken = new Set(newest.edges.map((e) => e.id));
      const edges = a.edges.filter(
        (e) =>
          (e.from === id || e.to === id) && kept.has(e.from) && kept.has(e.to) && !taken.has(e.id),
      );
      return withNode(newest, was, edges);
    }
    if (!was || !then) throw new Refused(["That change is not between these versions."]);
    if (!now) throw new Refused([`Node ${then.name} is not in the shape any more.`]);
    if (change.how === "renamed") {
      if (now.name !== then.name) throw later(`Node ${then.name} is now called ${now.name}.`);
      return {
        ...newest,
        nodes: newest.nodes.map((n) => (n.id === id ? { ...n, name: was.name } : n)),
      };
    }
    if (!sameJson(withoutName(now), withoutName(then)))
      throw later(`Node ${now.name} was changed again.`);
    return {
      ...newest,
      nodes: newest.nodes.map((n) => (n.id === id ? { ...was, name: n.name } : n)),
    };
  }

  const { id } = change;
  const was = edgeIn(a, id);
  const then = edgeIn(b, id);
  const now = edgeIn(newest, id);
  if (change.how === "removed") {
    if (!was) throw new Refused(["That change is not between these versions."]);
    if (now) throw later(`Edge ${edgeName(now)} is in the shape again.`);
    const missing = [was.from, was.to].filter((n) => !nodeIn(newest, n));
    if (missing.length)
      throw new Refused(
        missing.map(
          (n) => `Edge ${edgeName(was)} needs node ${nameOf(n)}, which is not in the shape.`,
        ),
      );
    return withEdge(newest, was);
  }
  if (!then) throw new Refused(["That change is not between these versions."]);
  if (!now || !sameJson(now, then))
    throw later(
      `Edge ${edgeName(then)} ${now ? "was changed again" : "is not in the shape any more"}.`,
    );
  if (change.how === "added") return withoutEdge(newest, id);
  if (!was) throw new Refused(["That change is not between these versions."]);
  return { ...newest, edges: newest.edges.map((e) => (e.id === id ? was : e)) };
}

/**
 * The inverse of one change from version `a` to version `b`, applied to `newest`, for stored
 * bodies. A `node:` or `edge:` key is a graph key: it needs a graph newest body. A line, station,
 * track, group or frame key is a metro key: it runs on the map view of all three bodies and gives
 * a metro body, so it needs a metro newest body (else refused with `ON_GRAPH`). `name` is in both:
 * the newest body's model decides. Pure; refused with `Refused`.
 */
export function undoStoredChange(
  newest: StoredBody,
  a: StoredBody,
  b: StoredBody,
  change: StoredChange,
): StoredBody {
  const graphKey = change.on === "node" || change.on === "edge";
  if (graphKey || (change.on === "name" && !isMetro(newest))) {
    if (isMetro(newest))
      throw new Refused(["The shape is on the metro model now. Undo by station or track."]);
    return undoChange(newest, runOf(a), runOf(b), change as ShapeChange);
  }
  // A metro key would build a metro body, and a graph newest version never turns into one by undo.
  if (!isMetro(newest)) throw new Refused([ON_GRAPH]);
  return undoMetroChange(metroView(newest), metroView(a), metroView(b), change as MetroChange);
}
