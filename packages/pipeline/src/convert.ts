/**
 * The graph and the metro model, one into the other (designs/2026-10-20-design-language.md,
 * "Decisions (planner C1)"). Pure. `metroOf` reads a graph body and draws it as lines, stations and
 * tracks. `graphOf` is its exact inverse: the runtime keeps the graph, so it lowers a metro body
 * with `graphOf` before it runs. Ids pass through unchanged, so journeys, deals and research need
 * no remap: a station id is the node id, a track id is the edge id, an out line id is the source
 * id, an offer line id is the offer node id.
 */

import {
  type Column,
  HUB,
  isContentKind,
  kindOfAction,
  LOGIC_KINDS,
  type MetroBody,
  type MetroLine,
  type MetroStation,
  type MetroTrack,
} from "./metro.js";
import {
  type Action,
  type Advance,
  edgeIdOf,
  isSource,
  type Job,
  type NodeKind,
  type OfferNode,
  type PlanNode,
  type ShapeBody,
  type ShapeEdge,
  type ShapeNode,
  type SourceNode,
  type StepNode,
} from "./model.js";

type MetroResult = { ok: true; body: MetroBody; notes: string[] } | { ok: false; errors: string[] };

/** Actions that happen where people first meet the business: the marketing column. */
const MARKETING_ACTIONS: readonly Action[] = [
  "comment",
  "reply",
  "dm",
  "email",
  "text",
  "cta",
  "visit",
];
/** Offer lines wear line tokens `--l0` to `--l7` in turn. */
const COLOURS = 8;
/** The line for steps that no deal station can be reached from or reaches. */
const UNROUTED = "unrouted";
const UNROUTED_LABEL = "Not on an offer";
const HUB_LABEL = "First touch";

const COLUMN_ORDER: readonly Column[] = ["marketing", "sales", "delivery", "money"];

/** The fields the graph model holds on each kind of node, and on an edge. Any other field is stray. */
const NODE_FIELDS: Record<NodeKind, readonly string[]> = {
  source: ["id", "kind", "name", "via", "channel", "campaign", "source", "group", "sop", "parked"],
  step: ["id", "kind", "name", "action", "advance", "research", "idleDays"],
  offer: ["id", "kind", "name", "offer", "advance", "research", "idleDays"],
  plan: ["id", "kind", "name", "terms", "advance", "idleDays"],
  job: ["id", "kind", "name", "job", "advance", "idleDays"],
};
const EDGE_FIELDS: readonly string[] = ["id", "from", "to", "kind", "label"];

/** A field on a node or an edge that is not part of the model. The convert drops it. */
interface StrayField {
  of: "node" | "edge";
  id: string;
  field: string;
}

const STRAY_END = "is not part of the model and is dropped.";

/** The note for a stray field. */
export const strayNote = (s: StrayField): string =>
  `${s.of === "node" ? "Node" : "Edge"} ${s.id}: field "${s.field}" ${STRAY_END}`;

/** True for a note made by `strayNote`: a drop that changes nothing the model holds. */
export const isStrayNote = (note: string): boolean => note.endsWith(STRAY_END);

/** The fields of one node or edge that are not in `known`. */
const strayKeys = (x: object, known: readonly string[]): string[] =>
  Object.keys(x).filter((k) => !known.includes(k));

/** Every stray field of a graph, nodes first and then edges, each in body order. Pure. */
export function strayFieldsOf(graph: ShapeBody): StrayField[] {
  const out: StrayField[] = [];
  for (const n of graph.nodes) {
    // A kind the model does not know is `checkShape`'s to refuse, not a stray field.
    const known = NODE_FIELDS[n.kind];
    if (!known) continue;
    for (const field of strayKeys(n, known)) out.push({ of: "node", id: n.id, field });
  }
  for (const e of graph.edges) {
    for (const field of strayKeys(e, EDGE_FIELDS)) out.push({ of: "edge", id: e.id, field });
  }
  return out;
}

/** The graph without exactly the fields `strayFieldsOf` lists. Pure. A node or edge with none is the same object. */
export function withoutStrayFields(graph: ShapeBody): ShapeBody {
  const strip = <T extends object>(x: T, known: readonly string[] | undefined): T => {
    const gone = known ? strayKeys(x, known) : [];
    return gone.length
      ? (Object.fromEntries(Object.entries(x).filter(([k]) => !gone.includes(k))) as T)
      : x;
  };
  return {
    ...graph,
    nodes: graph.nodes.map((n) => strip(n, NODE_FIELDS[n.kind])),
    edges: graph.edges.map((e) => strip(e, EDGE_FIELDS)),
  };
}

/** `base`, or `base_2`, `base_3` and so on, the first one not in `taken`. The id is taken. */
function freeId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

/** Shortest-path search over `next`: the first node in `deals` met, ties by `order`. */
function nearest(
  start: string,
  next: (id: string) => string[],
  deals: ReadonlySet<string>,
  order: ReadonlyMap<string, number>,
): string | undefined {
  const seen = new Set([start]);
  let level = [start];
  while (level.length > 0) {
    const found: string[] = [];
    const following: string[] = [];
    for (const at of level) {
      for (const to of next(at)) {
        if (seen.has(to)) continue;
        seen.add(to);
        following.push(to);
        if (deals.has(to)) found.push(to);
      }
    }
    if (found.length > 0) return found.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))[0];
    level = following;
  }
  return undefined;
}

/**
 * Draw a graph body in the metro model. Refused, with every reason, only when the graph holds
 * what the model cannot draw. `notes` lists what the metro model cannot keep: the body still
 * converts, but `graphOf` gives back a graph that differs by exactly those things. A field that the
 * graph model does not hold on a node or an edge is one of them (`strayFieldsOf`). It does not
 * change what the shape runs, so the convert proof ignores it (`withoutStrayFields`).
 *
 * The rules, in short:
 * - A source is an out line with one start station (its id) and a track to the hub. A source edge
 *   is an entry on the hub track into its target.
 * - An offer node is a core line and a deal station on it. A plan is a cash station on its
 *   offer's line. A step is a station on the line of the nearest deal station after it, else
 *   before it, else on the front line "Not on an offer".
 * - A flow edge is a track (a transfer when its ends sit on different lines). A loop is a back
 *   track.
 */
export function metroOf(graph: ShapeBody): MetroResult {
  const errors: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const nodeBy = new Map(graph.nodes.map((n) => [n.id, n] as const));
  for (const n of graph.nodes) {
    if (n.id === HUB) {
      errors.push(
        `Node "${HUB}" cannot become a station: the metro model keeps the id "${HUB}" for its hub. Rename the node first.`,
      );
    }
  }
  for (const e of graph.edges) {
    for (const end of [e.from, e.to]) {
      if (!ids.has(end))
        errors.push(`Edge "${e.id}" names node "${end}", which is not in the shape.`);
    }
    if (nodeBy.get(e.to)?.kind === "source") {
      errors.push(`Edge "${e.id}" ends at source "${e.to}". Nothing enters a source.`);
    }
  }
  // A content line is drawn on the map only; a graph body never held one.
  for (const n of graph.nodes) {
    if (n.kind === "job" || (n.kind === "source" && n.via === "found")) {
      errors.push(`Node "${n.id}" is on a content line. Draw content lines on the map.`);
    }
  }
  const notes: string[] = strayFieldsOf(graph).map(strayNote);
  // A source holds nobody, so a loop edge from one is never crossed. Leave it out and say so.
  const edges: ShapeEdge[] = [];
  for (const e of graph.edges) {
    if (e.kind === "loop" && nodeBy.get(e.from)?.kind === "source") {
      notes.push(
        `Loop edge "${e.id}" starts at source "${e.from}". A source holds nobody, so the edge does nothing. It is left out.`,
      );
    } else edges.push(e);
  }

  const sources = graph.nodes.filter(isSource);
  const held = graph.nodes.filter(
    (n): n is StepNode | OfferNode | PlanNode => !isSource(n) && n.kind !== "job",
  );
  const offers = held.filter((n) => n.kind === "offer");
  const flows = edges.filter((e) => e.kind === "flow" && ids.has(e.from) && ids.has(e.to));
  const out = (id: string) => flows.filter((e) => e.from === id).map((e) => e.to);
  const into = (id: string) => flows.filter((e) => e.to === id).map((e) => e.from);

  // The offer a plan follows.
  const offerOfPlan = new Map<string, OfferNode>();
  for (const n of held) {
    if (n.kind !== "plan") continue;
    const above = into(n.id)
      .map((id) => nodeBy.get(id))
      .find((x): x is OfferNode => x?.kind === "offer");
    if (above) offerOfPlan.set(n.id, above);
    else errors.push(`Plan "${n.id}" follows no offer node.`);
  }
  if (errors.length > 0) return { ok: false, errors };

  // Lines. Out lines first, in source order; then one core line per offer node.
  const lines: MetroLine[] = sources.map((s) => ({
    id: s.id,
    label: s.name,
    tier: "out",
    entry: {
      via: s.via,
      ...(s.channel !== undefined ? { channel: s.channel } : {}),
      ...(s.campaign !== undefined ? { campaign: s.campaign } : {}),
      ...(s.source !== undefined ? { source: s.source } : {}),
      ...(s.group !== undefined ? { segment: s.group } : {}),
      ...(s.parked ? { parked: true as const } : {}),
    },
  }));
  offers.forEach((o, i) => {
    if (o.kind !== "offer") return;
    lines.push({ id: o.id, label: o.name, tier: "core", offer: o.offer, colour: i % COLOURS });
  });

  // The line of each step: the nearest deal station after it, else before it, else "unrouted".
  const dealIds = new Set(offers.map((o) => o.id));
  const offerOrder = new Map(offers.map((o, i) => [o.id, i] as const));
  const taken = new Set(lines.map((l) => l.id));
  let unrouted: string | undefined;
  const lineOf = new Map<string, string>();
  for (const n of held) {
    if (n.kind === "offer") lineOf.set(n.id, n.id);
    else if (n.kind === "plan") lineOf.set(n.id, offerOfPlan.get(n.id)?.id ?? n.id);
    else {
      const deal =
        nearest(n.id, out, dealIds, offerOrder) ?? nearest(n.id, into, dealIds, offerOrder);
      if (deal) lineOf.set(n.id, deal);
      else {
        unrouted ??= freeId(UNROUTED, taken);
        lineOf.set(n.id, unrouted);
      }
    }
  }
  if (unrouted) lines.push({ id: unrouted, label: UNROUTED_LABEL, tier: "front" });

  // Columns. Marketing actions are marketing, other steps and the deal are sales, steps after a
  // deal are delivery, plans are money. Then lift each column so no flow edge goes left.
  const afterDeal = new Set<string>();
  for (const o of offers) {
    const stack = out(o.id);
    while (stack.length > 0) {
      const at = stack.pop();
      if (at === undefined || afterDeal.has(at)) continue;
      afterDeal.add(at);
      stack.push(...out(at));
    }
  }
  const column = new Map<string, number>();
  for (const n of held) {
    const col: Column =
      n.kind === "plan"
        ? "money"
        : n.kind === "offer"
          ? "sales"
          : afterDeal.has(n.id)
            ? "delivery"
            : MARKETING_ACTIONS.includes(n.action)
              ? "marketing"
              : "sales";
    column.set(n.id, COLUMN_ORDER.indexOf(col));
  }
  for (
    let again = true, rounds = 0;
    again && rounds <= held.length * COLUMN_ORDER.length;
    rounds++
  ) {
    again = false;
    for (const e of flows) {
      const from = column.get(e.from);
      const to = column.get(e.to);
      if (from !== undefined && to !== undefined && to < from) {
        column.set(e.to, from);
        again = true;
      }
    }
  }
  const columnOf = (id: string): Column => COLUMN_ORDER[column.get(id) ?? 0] ?? "marketing";

  // Stations: each source's start station, the hub, then every other node in node order.
  const stations: MetroStation[] = sources.map((s) => ({
    id: s.id,
    label: s.name,
    kind: "att",
    line: s.id,
    column: "marketing",
  }));
  stations.push({ id: HUB, label: HUB_LABEL, kind: "hub", column: "marketing" });
  for (const n of held) {
    const line = lineOf.get(n.id) ?? n.id;
    const base = { id: n.id, label: n.name, line, column: columnOf(n.id) };
    if (n.kind === "plan") {
      stations.push({
        ...base,
        kind: "cash",
        terms: n.terms,
        offer: offerOfPlan.get(n.id)?.offer ?? "",
        advance: structuredClone(n.advance),
        ...(n.idleDays !== undefined ? { idleDays: n.idleDays } : {}),
      });
    } else {
      stations.push({
        ...base,
        kind: n.kind === "offer" ? "att" : kindOfAction(n.action),
        ...(n.kind === "step" ? { action: n.action } : { deal: true as const }),
        advance: structuredClone(n.advance),
        ...(n.research !== undefined ? { research: n.research } : {}),
        ...(n.idleDays !== undefined ? { idleDays: n.idleDays } : {}),
      });
    }
  }
  const stationBy = new Map(stations.map((s) => [s.id, s] as const));

  // Tracks. Ids of kept edges stay; the tracks the convert adds take a free id.
  const sourceIds = new Set(sources.map((s) => s.id));
  const kept = edges.filter((e) => !sourceIds.has(e.from));
  const usedIds = new Set(kept.map((e) => e.id));
  const tracks: MetroTrack[] = sources.map((s) => ({
    id: freeId(edgeIdOf(s.id, HUB), usedIds),
    from: s.id,
    to: HUB,
    line: s.id,
    by: "system",
  }));
  const fromSources = edges.filter((e) => sourceIds.has(e.from));
  for (const e of fromSources) {
    if (e.label !== undefined) {
      notes.push(
        `Source edge "${e.id}" has the label "${e.label}". The metro model keeps no label there. It is dropped.`,
      );
    }
    if (e.id !== edgeIdOf(e.from, e.to)) {
      notes.push(
        `Source edge "${e.id}" becomes "${edgeIdOf(e.from, e.to)}". The metro model keeps no id for it.`,
      );
    }
  }
  for (const n of held) {
    const entries = sources.filter((s) =>
      fromSources.some((e) => e.from === s.id && e.to === n.id),
    );
    if (entries.length === 0) continue;
    tracks.push({
      id: freeId(edgeIdOf(HUB, n.id), usedIds),
      from: HUB,
      to: n.id,
      line: lineOf.get(n.id) ?? n.id,
      by: "system",
      entries: entries.map((s) => s.id),
    });
  }
  for (const e of kept) {
    const from = stationBy.get(e.from);
    const to = stationBy.get(e.to);
    const track: MetroTrack = {
      id: e.id,
      from: e.from,
      to: e.to,
      by: (to?.advance ?? []).length > 0 ? "system" : "person",
    };
    if (e.kind === "loop") track.kind = "back";
    else if (from?.line !== undefined && to?.line !== undefined && from.line !== to.line) {
      track.kind = "xfer";
    }
    if (e.kind !== "loop" && to?.line !== undefined) track.line = to.line;
    if (e.label !== undefined) track.label = e.label;
    tracks.push(track);
  }

  return {
    ok: true,
    notes,
    body: { model: "metro", name: graph.name, lines, stations, tracks, groups: [], frames: [] },
  };
}

/**
 * Lower a metro body to the graph the runtime runs. The exact inverse of `metroOf`: out lines
 * become sources, entries on hub tracks become source edges `<source>_to_<target>`, deal stations
 * become offer nodes, cash stations become plan nodes, other att and time stations become steps,
 * and tracks become edges (a back track is a loop). On a content line the find station becomes a
 * `found` source and each other station a job node, whose advance is the end of the job before it
 * (`trigger.station`). What the graph has no place for drops: the lines' tiers and colours,
 * columns, groups, frames, who moves a track.
 *
 * The output order is fixed, and a stored body must never change it: Restate replays `shape.v<n>`
 * and the workflow depends on the order of nodes and edges. Nodes: the out sources in line order,
 * the find stations in body order, then the other stations in body order. Edges: the tracks in body order. A hub track makes one source
 * edge per entry, in entry order (none: every out line, in line order). A track into the hub
 * makes nothing.
 *
 * Meant for a body whose `lowerable` is empty. On another it stays deterministic: a station that
 * is not att, time or cash is left out, and so is every track that touches one. `attach` and
 * `flows` lower to nothing: the graph is the same with or without them.
 */
export function graphOf(metro: MetroBody): ShapeBody {
  const lineBy = new Map(metro.lines.map((l) => [l.id, l] as const));
  const outs = metro.lines.filter((l) => l.tier === "out");
  const nodes: ShapeNode[] = outs.map((l): SourceNode => {
    const e = l.entry;
    return {
      id: l.id,
      kind: "source",
      name: l.label,
      via: e?.via ?? "manual",
      ...(e?.channel !== undefined ? { channel: e.channel } : {}),
      ...(e?.campaign !== undefined ? { campaign: e.campaign } : {}),
      ...(e?.source !== undefined ? { source: e.source } : {}),
      ...(e?.segment !== undefined ? { group: e.segment } : {}),
      ...(e?.parked ? { parked: true as const } : {}),
    };
  });
  const lowered = new Set<string>();
  for (const s of metro.stations) {
    if (s.kind !== "find") continue;
    nodes.push({
      id: s.id,
      kind: "source",
      name: s.label,
      via: "found",
      ...(s.sop !== undefined ? { sop: s.sop } : {}),
    });
    lowered.add(s.id);
  }
  const stationBy = new Map(metro.stations.map((s) => [s.id, s] as const));
  for (const s of metro.stations) {
    if (lineBy.get(s.line ?? "")?.tier === "out" || s.kind === "find") continue;
    const advance = structuredClone(s.advance ?? []);
    const idle = s.idleDays !== undefined ? { idleDays: s.idleDays } : {};
    if (isContentKind(s.kind)) {
      // The job before it ends: the document moves on. A find before it opens the instance here.
      const after = metro.tracks
        .filter((t) => t.to === s.id && t.kind !== "back")
        .map((t) => stationBy.get(t.from))
        .filter((f) => f !== undefined && isContentKind(f.kind) && f.kind !== "find");
      const ends: Advance[] = [...new Set(after.map((f) => f?.id ?? ""))].map((station) => ({
        trigger: "trigger.station",
        with: { station },
      }));
      nodes.push({
        id: s.id,
        kind: "job",
        name: s.label,
        job: s.kind as Job,
        advance: ends,
        ...idle,
      });
    } else if (s.kind === "cash") {
      nodes.push({ id: s.id, kind: "plan", name: s.label, terms: s.terms ?? "", advance, ...idle });
    } else if (s.kind === "att" || s.kind === "time") {
      const research = s.research !== undefined ? { research: s.research } : {};
      if (s.deal) {
        const offer = lineBy.get(s.line ?? "")?.offer ?? "";
        nodes.push({
          id: s.id,
          kind: "offer",
          name: s.label,
          offer,
          advance,
          ...research,
          ...idle,
        });
      } else {
        const action = s.action ?? "other";
        nodes.push({
          id: s.id,
          kind: "step",
          name: s.label,
          action,
          advance,
          ...research,
          ...idle,
        });
      }
    } else continue;
    lowered.add(s.id);
  }
  const hub = new Set(metro.stations.filter((s) => s.kind === "hub").map((s) => s.id));
  const outIds = outs.map((l) => l.id);
  const edges: ShapeEdge[] = [];
  for (const t of metro.tracks) {
    if (hub.has(t.to)) continue;
    if (hub.has(t.from)) {
      if (!lowered.has(t.to)) continue;
      for (const entry of t.entries ?? outIds) {
        if (!outIds.includes(entry)) continue;
        edges.push({ id: edgeIdOf(entry, t.to), from: entry, to: t.to, kind: "flow" });
      }
      continue;
    }
    if (!lowered.has(t.from) || !lowered.has(t.to)) continue;
    edges.push({
      id: t.id,
      from: t.from,
      to: t.to,
      kind: t.kind === "back" ? "loop" : "flow",
      ...(t.label !== undefined ? { label: t.label } : {}),
    });
  }
  return { name: metro.name, nodes, edges };
}

/**
 * Why `graphOf` cannot run this body. Empty when it can. The runtime does not run logic stations,
 * exits, exit tracks or frames yet, an out line must be a source with its one start station, and
 * a station must be what a node needs: a step has an action, a plan has terms, a deal has an offer.
 */
export function lowerable(metro: MetroBody): string[] {
  const why: string[] = [];
  const lineBy = new Map(metro.lines.map((l) => [l.id, l] as const));
  for (const s of metro.stations) {
    if (s.kind === "exit")
      why.push(`Station "${s.id}" is an exit. The runtime does not run exits yet.`);
    else if ((LOGIC_KINDS as readonly string[]).includes(s.kind)) {
      why.push(`Station "${s.id}" is a ${s.kind} station. The runtime does not run it yet.`);
    }
  }
  for (const t of metro.tracks) {
    if (t.kind === "exit") {
      why.push(`Track "${t.id}" is an exit track. The runtime does not run exit tracks yet.`);
    }
  }
  for (const f of metro.frames) {
    why.push(`Frame "${f.id}" is an interrupt frame. The runtime does not run frames yet.`);
  }
  const hub = new Set(metro.stations.filter((s) => s.kind === "hub").map((s) => s.id));
  for (const t of metro.tracks) {
    if (t.kind === "back" && (hub.has(t.from) || hub.has(t.to))) {
      why.push(`Track "${t.id}" is a back track at the hub. The graph has no hub to loop to.`);
    }
  }
  const content = new Set(metro.stations.filter((s) => isContentKind(s.kind)).map((s) => s.id));
  for (const t of metro.tracks) {
    if (t.kind === "back" && (content.has(t.from) || content.has(t.to))) {
      why.push(
        `Track "${t.id}" is a back track on a content line. The runtime does not run it yet.`,
      );
    }
  }
  // Until the move and stage steps take documents (ingestion engine, phase 1 commit 4).
  for (const l of metro.lines) {
    if (l.tier === "content")
      why.push(`Line "${l.id}" is a content line. The runtime does not run content lines yet.`);
  }
  for (const l of metro.lines) {
    if (l.tier !== "out") continue;
    const own = metro.stations.filter((s) => s.line === l.id);
    if (own.length !== 1 || own[0]?.id !== l.id) {
      why.push(
        `Out line "${l.id}" must hold one station, its own ("${l.id}"), not ${own.length === 0 ? "none" : own.map((s) => `"${s.id}"`).join(", ")}.`,
      );
    }
  }
  for (const s of metro.stations) {
    const tier = lineBy.get(s.line ?? "")?.tier;
    if (tier === "out") continue;
    if (s.kind === "cash" && !s.terms) {
      why.push(`Cash station "${s.id}" has no terms, so it cannot become a plan.`);
    }
    if (s.deal && s.kind !== "cash" && !lineBy.get(s.line ?? "")?.offer) {
      why.push(`Deal station "${s.id}" is on a line without an offer.`);
    }
    if ((s.kind === "att" || s.kind === "time") && !s.deal && s.action === undefined) {
      why.push(`Station "${s.id}" has no action, so it cannot become a step.`);
    }
  }
  return why;
}
