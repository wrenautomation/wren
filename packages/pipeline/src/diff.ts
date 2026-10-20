/**
 * What changed between two shape bodies, by id (designs/2026-10-19-business-map.md). Pure and free
 * of the database, so the Map's web reads it too: the server answers a diff with it, and the
 * Map's draft counts its changes with it. `store.ts` re-exports these.
 */
import type { ShapeBody } from "./model.js";

/** JSON with sorted keys and no undefined: the same value always gives the same text. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>)
          .filter(([, y]) => y !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, y]) => [k, sort(y)]),
      );
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

/** What changed between two shape bodies, by id. */
export interface ShapeDiff {
  nodes: {
    added: string[];
    removed: string[];
    /** Same id, new name. */
    renamed: Array<{ id: string; from: string; to: string }>;
    /** Same id, any other field changed. */
    changed: string[];
  };
  edges: { added: string[]; removed: string[]; changed: string[] };
  /** The shape's own name changed. */
  name: { from: string; to: string } | null;
}

/** Nodes and edges added, removed, renamed (nodes) and changed between `a` and `b`. Pure. */
export function diffShapes(a: ShapeBody, b: ShapeBody): ShapeDiff {
  const same = (x: unknown, y: unknown) => canonicalJson(x) === canonicalJson(y);
  const by = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x] as const));
  const an = by(a.nodes);
  const bn = by(b.nodes);
  const ae = by(a.edges);
  const be = by(b.edges);
  const nodes: ShapeDiff["nodes"] = { added: [], removed: [], renamed: [], changed: [] };
  for (const [id, n] of bn) {
    const was = an.get(id);
    if (!was) {
      nodes.added.push(id);
      continue;
    }
    if (was.name !== n.name) nodes.renamed.push({ id, from: was.name, to: n.name });
    if (!same({ ...was, name: "" }, { ...n, name: "" })) nodes.changed.push(id);
  }
  for (const id of an.keys()) if (!bn.has(id)) nodes.removed.push(id);
  const edges: ShapeDiff["edges"] = { added: [], removed: [], changed: [] };
  for (const [id, e] of be) {
    const was = ae.get(id);
    if (!was) edges.added.push(id);
    else if (!same(was, e)) edges.changed.push(id);
  }
  for (const id of ae.keys()) if (!be.has(id)) edges.removed.push(id);
  return { nodes, edges, name: a.name === b.name ? null : { from: a.name, to: b.name } };
}
