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

/**
 * One line of a diff, by what changed (designs/2026-10-19-business-map.md, "History like git").
 * A node renamed and changed in one diff is two changes. `changeKey` is how the CLI prints it and
 * how undo names it: `name`, `node:<id>:<how>`, `edge:<id>:<how>`.
 */
export type ShapeChange =
  | { on: "name" }
  | { on: "node"; id: string; how: "added" | "removed" | "renamed" | "changed" }
  | { on: "edge"; id: string; how: "added" | "removed" | "changed" };

/** Every change of a diff, in the order its lines read. */
export function changesOf(d: ShapeDiff): ShapeChange[] {
  return [
    ...(d.name ? [{ on: "name" } as const] : []),
    ...d.nodes.added.map((id) => ({ on: "node", id, how: "added" }) as const),
    ...d.nodes.removed.map((id) => ({ on: "node", id, how: "removed" }) as const),
    ...d.nodes.renamed.map((r) => ({ on: "node", id: r.id, how: "renamed" }) as const),
    ...d.nodes.changed.map((id) => ({ on: "node", id, how: "changed" }) as const),
    ...d.edges.added.map((id) => ({ on: "edge", id, how: "added" }) as const),
    ...d.edges.removed.map((id) => ({ on: "edge", id, how: "removed" }) as const),
    ...d.edges.changed.map((id) => ({ on: "edge", id, how: "changed" }) as const),
  ];
}

export const changeKey = (c: ShapeChange): string =>
  c.on === "name" ? "name" : `${c.on}:${c.id}:${c.how}`;

const NODE_HOWS = ["added", "removed", "renamed", "changed"] as const;
const EDGE_HOWS = ["added", "removed", "changed"] as const;

/** A key back to its change; null when it names none. */
export function parseChangeKey(key: string): ShapeChange | null {
  if (key === "name") return { on: "name" };
  const m = /^(node|edge):(.+):([a-z]+)$/.exec(key);
  if (!m) return null;
  const [, on, id = "", how] = m;
  if (on === "node" && (NODE_HOWS as readonly string[]).includes(how ?? ""))
    return { on, id, how: how as (typeof NODE_HOWS)[number] };
  if (on === "edge" && (EDGE_HOWS as readonly string[]).includes(how ?? ""))
    return { on, id, how: how as (typeof EDGE_HOWS)[number] };
  return null;
}

/** One change as a plain line, by node name: `a` is the older body, `b` the newer. */
export function changeLine(a: ShapeBody, b: ShapeBody, c: ShapeChange): string {
  const name = (id: string, old = false) => {
    const [x, y] = old ? [a, b] : [b, a];
    return x.nodes.find((n) => n.id === id)?.name ?? y.nodes.find((n) => n.id === id)?.name ?? id;
  };
  /** A removed edge is named as the older body knew it. */
  const edgeName = (id: string, old = false) => {
    const e = (old ? a : b).edges.find((x) => x.id === id);
    return e ? `${name(e.from, old)} to ${name(e.to, old)}` : id;
  };
  if (c.on === "name") return `Shape renamed from ${a.name} to ${b.name}.`;
  if (c.on === "node") {
    if (c.how === "added") return `Added node ${name(c.id)}.`;
    if (c.how === "removed") return `Removed node ${name(c.id, true)}.`;
    if (c.how === "renamed") return `Renamed node ${name(c.id, true)} to ${name(c.id)}.`;
    return `Changed node ${name(c.id)}.`;
  }
  if (c.how === "added") return `Added edge ${edgeName(c.id)}.`;
  if (c.how === "removed") return `Removed edge ${edgeName(c.id, true)}.`;
  return `Changed edge ${edgeName(c.id)}.`;
}

/** Every change of `diff` (from `a` to `b`) as a plain line. */
export const changeLines = (a: ShapeBody, b: ShapeBody, diff: ShapeDiff): string[] =>
  changesOf(diff).map((c) => changeLine(a, b, c));
