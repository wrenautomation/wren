/**
 * The shape: one directed graph per database (designs/2026-10-19-business-map.md). Sources open
 * journeys. Steps, offers and plans hold them. Flow edges carry them forward. Loop edges send them
 * back as a new journey. Pure: the known triggers, groups and lists come in as arguments, so this
 * file imports nothing from the executor.
 */
import { SOP_NAME, SOURCE_ID } from "@wren/core/logic";

export interface Advance {
  /** A trigger component id: `trigger.booking`, `trigger.touch`, ... */
  trigger: string;
  /** That trigger's settings, as a node's `with`. */
  with?: Record<string, string | number>;
}

/** The longest `idleDays` a node may set. */
export const IDLE_DAYS_MAX = 365;

export const RESEARCH_LEVELS = ["none", "light", "full"] as const;
export type Research = (typeof RESEARCH_LEVELS)[number];

/** What a step is: the kind of thing that happens there. */
export const ACTIONS = [
  "comment",
  "reply",
  "dm",
  "email",
  "text",
  "call",
  "cta",
  "visit",
  "form",
  "book",
  "held",
  "proposal",
  "signed",
  "other",
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * How a source finds its subjects. Today's entry kinds, less `funnel` (an edge does that). All
 * but `found` find people; `found` finds documents for a content line (designs/2026-10-25-
 * ingestion-engine.md).
 */
export const VIAS = [
  "organic",
  "outbound",
  "ads",
  "referral",
  "sourced",
  "group",
  "manual",
  "found",
] as const;
export type Via = (typeof VIAS)[number];
/** The vias that find people: every via but `found`. */
export const PEOPLE_VIAS: readonly Via[] = VIAS.filter((v) => v !== "found");

/** What an instance is about: a person, or a document on a content line. */
export const SUBJECT_KINDS = ["person", "document"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** What a job node does to a document on arrival. Each job, when done, moves it on. */
export const JOBS = ["read", "extract", "call", "measure"] as const;
export type Job = (typeof JOBS)[number];

export { SOP_NAME };

const NODE_KINDS = ["source", "step", "offer", "plan", "job"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

const EDGE_KINDS = ["flow", "loop"] as const;
type EdgeKind = (typeof EDGE_KINDS)[number];

interface NodeBase {
  /** The executor node id rule (`STAGE_KEY`). Never goes, moves or gets renamed. */
  id: string;
  name: string;
}

/** Where people come from. Nobody sits on a source: an opening crosses its edge. */
export interface SourceNode extends NodeBase {
  kind: "source";
  via: Via;
  /** The platform or channel the cause must come from. */
  channel?: string;
  /** An ads campaign id or a `/go/` campaign. */
  campaign?: string;
  /** Via `sourced`: the list the person was added to, `import:<batch id>`. */
  source?: string;
  /** Via `group`: the saved query whose members enter (a segment id as text). */
  group?: string;
  /** Via `found`: the SOP whose finds enter (the tag the hunt and his saves give a document). */
  sop?: string;
  /** Opens nothing. Keeps the node and its numbers. */
  parked?: true;
}

export interface StepNode extends NodeBase {
  kind: "step";
  action: Action;
  /** What moves a journey to this node. */
  advance: Advance[];
  /** How much research the person gets on arrival. Default `none`. */
  research?: Research;
  /** Whole days an open journey may sit here before it reads stale (1 to 365). */
  idleDays?: number;
}

/** Reaching an offer node makes the deal. */
export interface OfferNode extends NodeBase {
  kind: "offer";
  /** The registry offer id. */
  offer: string;
  advance: Advance[];
  research?: Research;
  idleDays?: number;
}

/** Reaching a plan node signs the deal under the plan's terms. */
export interface PlanNode extends NodeBase {
  kind: "plan";
  /** A terms plan slug of the offer above this node. */
  terms: string;
  advance: Advance[];
  idleDays?: number;
}

/**
 * A content line's station: holds a document while its job runs (`read`, `extract`) or waits
 * (`call`: his call on every finding; `measure`). The job's end is a `trigger.station` fire for
 * this node, which `graphOf` makes the advance of the node after it.
 */
export interface JobNode extends NodeBase {
  kind: "job";
  job: Job;
  advance: Advance[];
  idleDays?: number;
}

export type ShapeNode = SourceNode | StepNode | OfferNode | PlanNode | JobNode;
/** A node that holds instances (every kind but source). */
export type HoldNode = StepNode | OfferNode | PlanNode | JobNode;

export interface ShapeEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
}

export interface ShapeBody {
  name: string;
  nodes: ShapeNode[];
  edges: ShapeEdge[];
}

/** One step of a journey's trail: a crossing of an edge (null when forced by hand). */
export interface Crossing {
  edge: string | null;
  /** The node it left; the source for an opening. */
  from: string | null;
  to: string;
  /** ISO time. */
  at: string;
}

/** A group is a segment: its id as text, a positive whole number. */
const GROUP_ID = /^[1-9][0-9]{0,9}$/;
export const STAGE_KEY = /^[a-z][a-z0-9_]*$/;
const EDGE_ID = /^[a-z][a-z0-9_]*$/;
/** The widest a node id goes (`journeys.node` is varchar(40)). */
export const NODE_ID_MAX = 40;
/** Two node ids and `_to_`: the widest default edge id. */
export const EDGE_ID_MAX = NODE_ID_MAX * 2 + 4;
/** The key of the node a drop arrives at; no node may take it. */
export const DROPPED = "dropped";

/** What `checkShape` needs from outside. */
export interface ShapeCheckContext {
  /** Trigger component ids that exist. */
  triggers: ReadonlySet<string>;
  /**
   * A stored group (a segment in this workspace) by id as text, or undefined if there is none.
   * `active` is false once it is archived: an archived group tells no one.
   */
  group(id: string): { active: boolean } | undefined;
  /** A sourced list by id (`import:<batch id>`), or undefined if there is none. */
  source(id: string): { exists: true } | undefined;
}

/** The id an edge takes when none is given. */
export const edgeIdOf = (from: string, to: string): string => `${from}_to_${to}`;

export const isSource = (n: ShapeNode): n is SourceNode => n.kind === "source";
/** What a node's instances are about: a job node and a `found` source hold documents. */
export const subjectKindOf = (n: ShapeNode): SubjectKind =>
  n.kind === "job" || (n.kind === "source" && n.via === "found") ? "document" : "person";
export const holds = (n: ShapeNode): n is HoldNode => n.kind !== "source";

export const nodeOf = (body: ShapeBody, id: string): ShapeNode | undefined =>
  body.nodes.find((n) => n.id === id);

export const flowEdgesFrom = (body: ShapeBody, id: string): ShapeEdge[] =>
  body.edges.filter((e) => e.kind === "flow" && e.from === id);

/** A node no flow edge leaves: a journey that reaches it is done. */
export const isEnd = (body: ShapeBody, id: string): boolean => flowEdgesFrom(body, id).length === 0;

/**
 * Check a new shape. Returns what is wrong, in plain English. Empty means ok.
 */
export function checkShape(next: ShapeBody, ctx: ShapeCheckContext): string[] {
  const errors: string[] = [];
  if (typeof next.name !== "string" || next.name.trim() === "") {
    errors.push("The shape needs a name.");
  }
  const ids = next.nodes.map((n) => n.id);

  if (!next.nodes.some((n) => n.kind === "source")) {
    errors.push("The shape needs at least one source.");
  }

  for (const [i, n] of next.nodes.entries()) {
    const k = n.id;
    if (typeof k !== "string" || !STAGE_KEY.test(k)) {
      errors.push(
        `Node id "${k}" must be lowercase letters, digits and underscores, starting with a letter.`,
      );
    } else if (k.length > NODE_ID_MAX) {
      errors.push(`Node id "${k}" is longer than ${NODE_ID_MAX} characters.`);
    }
    if (ids.indexOf(k) !== i) errors.push(`Node id "${k}" is used twice.`);
    if (k === DROPPED) errors.push(`Node id "${k}" is reserved for dropped journeys.`);
    if (typeof n.name !== "string" || n.name.trim() === "") {
      errors.push(`Node "${k}" needs a name.`);
    }
    if (!NODE_KINDS.includes(n.kind)) {
      errors.push(`Node "${k}" has kind "${n.kind}". Use ${NODE_KINDS.join(", ")}.`);
      continue;
    }
    checkNode(n, ctx, errors);
  }

  const edgeIds = next.edges.map((e) => e.id);
  const known = new Set(ids);
  const kindOf = new Map(next.nodes.map((n) => [n.id, n.kind]));
  for (const [i, e] of next.edges.entries()) {
    if (typeof e.id !== "string" || !EDGE_ID.test(e.id)) {
      errors.push(
        `Edge id "${e.id}" must be lowercase letters, digits and underscores, starting with a letter.`,
      );
    } else if (e.id.length > EDGE_ID_MAX) {
      errors.push(`Edge id "${e.id}" is longer than ${EDGE_ID_MAX} characters.`);
    }
    if (edgeIds.indexOf(e.id) !== i) errors.push(`Edge id "${e.id}" is used twice.`);
    if (!EDGE_KINDS.includes(e.kind)) {
      errors.push(`Edge "${e.id}" has kind "${e.kind}". Use flow or loop.`);
    }
    for (const end of [e.from, e.to]) {
      if (!known.has(end))
        errors.push(`Edge "${e.id}" names node "${end}", which is not in the shape.`);
    }
    if (e.from === e.to) errors.push(`Edge "${e.id}" starts and ends at "${e.from}".`);
    const twin = next.edges.findIndex(
      (o) => o.from === e.from && o.to === e.to && o.kind === e.kind,
    );
    if (twin !== -1 && twin < i) {
      errors.push(
        `Edge "${e.id}" repeats edge "${next.edges[twin]?.id}": same ${e.kind} from "${e.from}" to "${e.to}".`,
      );
    }
    if (kindOf.get(e.to) === "source") {
      errors.push(`Edge "${e.id}" ends at source "${e.to}". Nothing enters a source.`);
    }
    const a = nodeOf(next, e.from);
    const b = nodeOf(next, e.to);
    if (a && b && NODE_KINDS.includes(a.kind) && NODE_KINDS.includes(b.kind)) {
      if (subjectKindOf(a) !== subjectKindOf(b))
        errors.push(
          `Edge "${e.id}" joins a ${subjectKindOf(a)} node to a ${subjectKindOf(b)} node. An edge never changes what an instance is about.`,
        );
    }
  }

  // Loop and flow edges that end at a source are reported above; the rest of the rules need
  // edges that name real nodes.
  const real = next.edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);
  const flows = real.filter((e) => e.kind === "flow");

  const cycle = cycleOf(
    ids,
    flows.map((e) => [e.from, e.to]),
  );
  if (cycle) {
    errors.push(`Flow edges form a loop: ${cycle.join(" -> ")}. Mark one edge as a loop edge.`);
  }

  for (const n of next.nodes) {
    if (n.kind === "source") continue;
    const incoming = flows.filter((e) => e.to === n.id);
    if (incoming.length === 0) {
      errors.push(`Node "${n.id}" has no flow edge into it. Nothing can reach it.`);
      continue;
    }
    if (n.kind === "plan") {
      const from = new Set(incoming.map((e) => e.from));
      const offers = [...from].filter((f) => kindOf.get(f) === "offer");
      if (from.size !== offers.length || offers.length !== 1) {
        errors.push(
          `Plan "${n.id}" must follow one offer node. Its flow edges come from one offer.`,
        );
      }
    }
  }
  return errors;
}

/** The fields of an entry that `checkEntry` reads: how a source finds people. */
interface EntryFields {
  via: Via;
  source?: string | undefined;
  group?: string | undefined;
  sop?: string | undefined;
}

/**
 * Check how a source finds people: its via, and the list or group it names. `who` opens each
 * message (`Source "yt"`). The graph's sources and the metro model's out lines share it.
 */
export function checkEntry(
  who: string,
  e: EntryFields,
  ctx: ShapeCheckContext,
  errors: string[],
  vias: readonly Via[] = VIAS,
): void {
  if (!vias.includes(e.via)) {
    errors.push(`${who} has via "${e.via}". Use ${vias.join(", ")}.`);
  }
  if (e.via === "sourced") {
    if (!e.source) errors.push(`${who} has via sourced but names no source.`);
    else if (!SOURCE_ID.test(e.source))
      errors.push(`${who} names source "${e.source}", which is not a list's id (import:12).`);
    else if (!ctx.source(e.source))
      errors.push(`${who} names source ${e.source}, which does not exist.`);
  }
  if (e.via === "found") {
    if (!e.sop) errors.push(`${who} has via found but names no SOP.`);
    else if (!SOP_NAME.test(e.sop))
      errors.push(`${who} names SOP "${e.sop}". Use lowercase letters, digits and dashes.`);
  }
  if (e.via === "group") {
    if (!e.group) errors.push(`${who} has via group but names no group.`);
    else if (!GROUP_ID.test(e.group))
      errors.push(`${who} names group "${e.group}", which is not a group's number.`);
    else {
      const g = ctx.group(e.group);
      if (!g) errors.push(`${who} names group ${e.group}, which does not exist.`);
      else if (!g.active)
        errors.push(`${who} names group ${e.group}, which is archived. Restore it first.`);
    }
  }
}

function checkNode(n: ShapeNode, ctx: ShapeCheckContext, errors: string[]): void {
  const k = n.id;
  if (n.kind === "source") {
    checkEntry(`Source "${k}"`, n, ctx, errors);
    return;
  }

  if (n.kind === "job" && !JOBS.includes(n.job)) {
    errors.push(`Job node "${k}" has job "${n.job}". Use ${JOBS.join(", ")}.`);
  }
  if (n.kind === "step" && !ACTIONS.includes(n.action)) {
    errors.push(`Step "${k}" has action "${n.action}". Use ${ACTIONS.join(", ")}.`);
  }
  if (n.kind === "offer" && (typeof n.offer !== "string" || n.offer === "")) {
    errors.push(`Offer node "${k}" names no offer.`);
  }
  if (n.kind === "plan" && (typeof n.terms !== "string" || n.terms === "")) {
    errors.push(`Plan "${k}" names no terms plan.`);
  }
  if (
    (n.kind === "step" || n.kind === "offer") &&
    n.research !== undefined &&
    !RESEARCH_LEVELS.includes(n.research)
  ) {
    errors.push(`Node "${k}" has research "${n.research}". Use none, light or full.`);
  }
  if (
    n.idleDays !== undefined &&
    !(Number.isInteger(n.idleDays) && n.idleDays >= 1 && n.idleDays <= IDLE_DAYS_MAX)
  ) {
    errors.push(
      `Node "${k}" has idleDays ${JSON.stringify(n.idleDays)}. Use a whole number of days from 1 to ${IDLE_DAYS_MAX}.`,
    );
  }
  if (!Array.isArray(n.advance)) {
    errors.push(`Node "${k}" needs an advance list, even an empty one.`);
    return;
  }
  for (const a of n.advance) {
    if (!ctx.triggers.has(a.trigger)) {
      errors.push(`Node "${k}" uses "${a.trigger}", which is not a known trigger.`);
    }
  }
}

/** One directed cycle through `pairs`, as node ids from the start back to the start, or null. */
export function cycleOf(
  ids: readonly string[],
  pairs: readonly (readonly [string, string])[],
): string[] | null {
  const next = new Map<string, string[]>();
  for (const [a, b] of pairs) next.set(a, [...(next.get(a) ?? []), b]);
  const done = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const at = stack.indexOf(id);
    if (at !== -1) return [...stack.slice(at), id];
    if (done.has(id)) return null;
    stack.push(id);
    for (const to of next.get(id) ?? []) {
      const found = visit(to);
      if (found) return found;
    }
    stack.pop();
    done.add(id);
    return null;
  };
  for (const id of ids) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}

/**
 * How far each node sits from a source: the longest flow path from any source. Sources are 0.
 * Loop edges are ignored. Pure, and safe on a body that has not been checked (a cycle does not
 * loop; a node nothing reaches is 0).
 */
export function depthOf(body: ShapeBody): Record<string, number> {
  const into = new Map<string, string[]>();
  for (const e of body.edges) {
    if (e.kind === "flow") into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
  }
  const depth: Record<string, number> = {};
  const open = new Set<string>();
  const visit = (id: string): number => {
    const known = depth[id];
    if (known !== undefined) return known;
    if (open.has(id)) return 0;
    open.add(id);
    let d = 0;
    for (const from of into.get(id) ?? []) d = Math.max(d, visit(from) + 1);
    open.delete(id);
    depth[id] = d;
    return d;
  };
  for (const n of body.nodes) {
    // A source has no incoming edge in a checked shape; force it to 0 in an unchecked one.
    if (n.kind === "source") depth[n.id] = 0;
  }
  for (const n of body.nodes) visit(n.id);
  return depth;
}

/**
 * The shortest flow path from `from` to `to` as edge ids (fewest edges, ties by edge order in
 * the body), or null. With `loops` (the default) and no flow path, one loop edge from `from` to
 * `to` counts as a path of one. A node has no path to itself.
 */
export function pathOf(
  body: ShapeBody,
  from: string,
  to: string,
  opts: { loops?: boolean } = {},
): string[] | null {
  if (from === to) return null;
  const via = new Map<string, ShapeEdge>();
  const seen = new Set([from]);
  let level = [from];
  while (level.length > 0 && !seen.has(to)) {
    const step: string[] = [];
    for (const at of level) {
      for (const e of body.edges) {
        if (e.kind !== "flow" || e.from !== at || seen.has(e.to)) continue;
        seen.add(e.to);
        via.set(e.to, e);
        step.push(e.to);
      }
    }
    level = step;
  }
  if (seen.has(to)) {
    const path: string[] = [];
    for (let at = to; at !== from; ) {
      const e = via.get(at);
      if (!e) return null;
      path.unshift(e.id);
      at = e.from;
    }
    return path;
  }
  if (opts.loops ?? true) {
    const loop = body.edges.find((e) => e.kind === "loop" && e.from === from && e.to === to);
    if (loop) return [loop.id];
  }
  return null;
}

/** The edges named by `ids`, in order, from a body. An id the body lacks is left out. */
export const edgesOf = (body: ShapeBody, ids: readonly string[]): ShapeEdge[] =>
  ids.flatMap((id) => body.edges.find((e) => e.id === id) ?? []);

/** The nodes a path from `from` passes through, not counting `from` and the last node. */
export function passedThrough(body: ShapeBody, edges: readonly string[]): string[] {
  return edgesOf(body, edges)
    .slice(0, -1)
    .map((e) => e.to);
}
