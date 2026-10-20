/**
 * Editing the shape on the Map (designs/2026-10-19-business-map.md, "Map page", edit mode), pure:
 * a draft is a body plus the moves for people on nodes it drops. Each function takes a body and
 * gives the next one, so a test needs no browser. `reasonFor` mirrors what `checkShape` refuses
 * about a line, so the canvas can say no while the line is still being dragged. The server checks
 * the whole shape again on Save.
 */
import { TRIGGER_IDS } from "@wren/core/logic";
import { canonicalJson, diffShapes } from "@wren/pipeline/diff";
import {
  type Advance,
  checkShape,
  DROPPED,
  EDGE_ID_MAX,
  type EdgeKind,
  edgeIdOf,
  NODE_ID_MAX,
  nodeOf,
  pathOf,
  type ShapeBody,
  type ShapeEdge,
  type ShapeNode,
  STAGE_KEY,
} from "@wren/pipeline/model";
import type { IconName } from "@wren/ui";
import type { Person } from "./model.js";

export type Kind = ShapeNode["kind"];
/** Where people on a dropped node go: `{ oldNode: newNode }`. */
export type Moves = Record<string, string>;

/** What the person edits: the body, and where people on the nodes it drops go. */
export interface Draft {
  body: ShapeBody;
  moves: Moves;
}

/** The four kinds, as the palette and the panel name them. */
export const KINDS: readonly {
  kind: Kind;
  title: string;
  blurb: string;
  glyph: IconName;
}[] = [
  {
    kind: "source",
    title: "Source",
    blurb: "Where people come from: a channel, a list or a campaign.",
    glyph: "boxes",
  },
  {
    kind: "step",
    title: "Step",
    blurb: "Something that happens to a person: a reply, a call, a booking.",
    glyph: "dot",
  },
  {
    kind: "offer",
    title: "Offer",
    blurb: "An offer made to a person. Reaching it makes the deal.",
    glyph: "doc",
  },
  {
    kind: "plan",
    title: "Plan",
    blurb: "One plan of the offer before it. Reaching it signs the deal.",
    glyph: "workflow",
  },
];
export const TITLE = Object.fromEntries(KINDS.map((k) => [k.kind, k.title])) as Record<
  Kind,
  string
>;

// --- ids -------------------------------------------------------------------------------------

/**
 * A node id for `name` that is free: lowercase letters, digits and underscores, starting with a
 * letter, within the id limit, not taken and not the dropped key. A taken id gets `_2`, `_3`, ...
 */
export function idFrom(name: string, taken: ReadonlySet<string>): string {
  let base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "node";
  if (!/^[a-z]/.test(base)) base = `n_${base}`;
  base = base.slice(0, NODE_ID_MAX).replace(/_+$/, "");
  let id = base;
  for (let i = 2; taken.has(id) || id === DROPPED || !STAGE_KEY.test(id); i++) {
    const tail = `_${i}`;
    id = base.slice(0, NODE_ID_MAX - tail.length) + tail;
  }
  return id;
}

/** `name`, or `name 2`, `name 3`, ... when a node already has it. */
function nameFree(body: ShapeBody, name: string): string {
  const names = new Set(body.nodes.map((n) => n.name));
  let out = name;
  for (let i = 2; names.has(out); i++) out = `${name} ${i}`;
  return out;
}

// --- nodes -----------------------------------------------------------------------------------

/** A new node of `kind`, with the fewest fields that make it valid but empty. */
export function blankNode(kind: Kind, id: string, name: string): ShapeNode {
  switch (kind) {
    case "source":
      return { id, name, kind, via: "manual" };
    case "step":
      return { id, name, kind, action: "other", advance: [] };
    case "offer":
      return { id, name, kind, offer: "", advance: [] };
    case "plan":
      return { id, name, kind, terms: "", advance: [] };
  }
}

/** The body with one more node of `kind`, and its id. */
export function addNode(body: ShapeBody, kind: Kind): { body: ShapeBody; id: string } {
  const name = nameFree(body, TITLE[kind]);
  const id = idFrom(name, new Set(body.nodes.map((n) => n.id)));
  return { body: { ...body, nodes: [...body.nodes, blankNode(kind, id, name)] }, id };
}

/** The body with node `id` changed by `fn`. */
export function patchNode(body: ShapeBody, id: string, fn: (n: ShapeNode) => ShapeNode): ShapeBody {
  return { ...body, nodes: body.nodes.map((n) => (n.id === id ? fn(n) : n)) };
}

/** A node with `key` set to `value`, or without the key when `value` is undefined or empty. */
export function withField<N extends ShapeNode>(n: N, key: string, value: unknown): N {
  const { [key]: _gone, ...rest } = n as unknown as Record<string, unknown>;
  const keep = value !== undefined && value !== "";
  return (keep ? { ...rest, [key]: value } : rest) as unknown as N;
}

export const setField = (body: ShapeBody, id: string, key: string, value: unknown): ShapeBody =>
  patchNode(body, id, (n) => withField(n, key, value));

export const renameNode = (body: ShapeBody, id: string, name: string): ShapeBody =>
  patchNode(body, id, (n) => ({ ...n, name }));

/** The body without node `id` and the edges that touch it. */
export const removeNode = (body: ShapeBody, id: string): ShapeBody => ({
  ...body,
  nodes: body.nodes.filter((n) => n.id !== id),
  edges: body.edges.filter((e) => e.from !== id && e.to !== id),
});

/** The advance rules of a node that holds journeys; a source has none. */
export const rulesOf = (n: ShapeNode): Advance[] => (n.kind === "source" ? [] : n.advance);

export const setRules = (body: ShapeBody, id: string, advance: Advance[]): ShapeBody =>
  patchNode(body, id, (n) => (n.kind === "source" ? n : { ...n, advance }));

/** The offer a plan follows: the registry id on the offer node that flows into it, or null. */
export function offerBefore(body: ShapeBody, plan: string): string | null {
  for (const e of body.edges) {
    if (e.kind !== "flow" || e.to !== plan) continue;
    const from = nodeOf(body, e.from);
    if (from?.kind === "offer") return from.offer || null;
  }
  return null;
}

// --- edges -----------------------------------------------------------------------------------

/**
 * Why a line of `kind` from `from` to `to` is refused, in a sentence, or null when it fits. The
 * same refusals as `checkShape` (into a source, to itself, a circle of flow lines, a plan that
 * follows two offers), plus one: two nodes take one line each way, since the canvas keys a
 * wire by its two ends.
 */
export function reasonFor(
  body: ShapeBody,
  from: string,
  to: string,
  kind: EdgeKind,
): string | null {
  const a = nodeOf(body, from);
  const b = nodeOf(body, to);
  if (!a || !b) return "That node is not in the shape.";
  if (from === to) return "A node cannot join itself.";
  if (b.kind === "source") return "Nothing enters a source.";
  if (body.edges.some((e) => e.from === from && e.to === to))
    return "These two are already joined.";
  if (kind === "flow") {
    if (pathOf(body, to, from, { loops: false }))
      return "That would make flow lines run in a circle. Draw it as a loop line.";
    if (b.kind === "plan") {
      const feeds = body.edges.filter((e) => e.kind === "flow" && e.to === to);
      if (a.kind !== "offer" || feeds.some((e) => e.from !== from))
        return "A plan follows exactly one offer.";
    }
  }
  return null;
}

/** An edge id for a line from `from` to `to` that no edge has, within the id limit. */
function edgeIdFree(body: ShapeBody, from: string, to: string): string {
  const taken = new Set(body.edges.map((e) => e.id));
  const base = edgeIdOf(from, to).slice(0, EDGE_ID_MAX);
  let id = base;
  for (let i = 2; taken.has(id); i++) {
    const tail = `_${i}`;
    id = base.slice(0, EDGE_ID_MAX - tail.length) + tail;
  }
  return id;
}

/** The body with a line from `from` to `to`; unchanged when `reasonFor` refuses it. */
export function connect(body: ShapeBody, from: string, to: string, kind: EdgeKind): ShapeBody {
  if (reasonFor(body, from, to, kind)) return body;
  const edge: ShapeEdge = { id: edgeIdFree(body, from, to), from, to, kind };
  return { ...body, edges: [...body.edges, edge] };
}

export const patchEdge = (
  body: ShapeBody,
  id: string,
  fn: (e: ShapeEdge) => ShapeEdge,
): ShapeBody => ({ ...body, edges: body.edges.map((e) => (e.id === id ? fn(e) : e)) });

/** An edge's label: empty takes it off. */
export const labelEdge = (body: ShapeBody, id: string, label: string): ShapeBody =>
  patchEdge(body, id, ({ label: _was, ...e }) => (label.trim() ? { ...e, label } : e));

/** Why edge `id` may not become `kind`, or null: the line is judged without itself. */
export function kindReason(body: ShapeBody, id: string, kind: EdgeKind): string | null {
  const e = body.edges.find((x) => x.id === id);
  if (!e) return "That line is not in the shape.";
  if (e.kind === kind) return null;
  const rest = { ...body, edges: body.edges.filter((x) => x.id !== id) };
  return reasonFor(rest, e.from, e.to, kind);
}

export const setKind = (body: ShapeBody, id: string, kind: EdgeKind): ShapeBody =>
  patchEdge(body, id, (e) => ({ ...e, kind }));

export const removeEdge = (body: ShapeBody, id: string): ShapeBody => ({
  ...body,
  edges: body.edges.filter((e) => e.id !== id),
});

/** The edge a click on the line from `from` to `to` names. */
export const edgeBetween = (body: ShapeBody, from: string, to: string): ShapeEdge | undefined =>
  body.edges.find((e) => e.from === from && e.to === to);

// --- people ----------------------------------------------------------------------------------

/** The open journeys on node `id`. */
export const peopleOn = (people: readonly Person[], id: string): Person[] =>
  people.filter((p) => p.node === id);

/**
 * The moves that still mean something: a key the body dropped, to a node the body has. The server
 * refuses a target the body lacks, and a key the body keeps would move people off a live node.
 */
export function cleanMoves(body: ShapeBody, moves: Moves): Moves {
  const ids = new Set(body.nodes.map((n) => n.id));
  return Object.fromEntries(
    Object.entries(moves).filter(([from, to]) => !ids.has(from) && ids.has(to)),
  );
}

// --- the draft -------------------------------------------------------------------------------

/** What the shape holds now, as the text the edits store compares a draft to. */
export const serverText = (body: ShapeBody): string => canonicalJson({ body, moves: {} });
export const textOf = (d: Draft): string => canonicalJson({ body: d.body, moves: d.moves });

/** A draft from its text; the newest body when the text is not one (a store from an older build). */
export function draftOf(text: string, base: ShapeBody): Draft {
  try {
    const x = JSON.parse(text) as { body?: ShapeBody; moves?: Moves };
    const b = x.body;
    if (b && typeof b.name === "string" && Array.isArray(b.nodes) && Array.isArray(b.edges)) {
      const moves =
        x.moves && typeof x.moves === "object"
          ? Object.fromEntries(Object.entries(x.moves).filter(([, v]) => typeof v === "string"))
          : {};
      return { body: b, moves };
    }
  } catch {
    // Falls through to the newest body.
  }
  return { body: base, moves: {} };
}

/** How many nodes, lines and names the draft changes against `base`; a node counts once. */
export function changesOf(base: ShapeBody, now: ShapeBody): number {
  const d = diffShapes(base, now);
  const nodes = new Set([
    ...d.nodes.added,
    ...d.nodes.removed,
    ...d.nodes.changed,
    ...d.nodes.renamed.map((r) => r.id),
  ]);
  return (
    nodes.size +
    d.edges.added.length +
    d.edges.removed.length +
    d.edges.changed.length +
    (d.name ? 1 : 0)
  );
}

/**
 * What `checkShape` finds wrong with the draft, once each. Groups and lists are taken as there;
 * the server knows which exist and checks them on Save.
 */
export function problemsOf(body: ShapeBody): string[] {
  return [
    ...new Set(
      checkShape(body, {
        triggers: TRIGGER_IDS,
        group: () => ({ active: true }),
        source: () => ({ exists: true }),
      }),
    ),
  ];
}
