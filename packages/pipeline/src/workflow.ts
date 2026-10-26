/**
 * A shape version as an executor workflow (designs/2026-10-19-business-map.md). Pure, the way
 * `cadenceWorkflow` is. Per node `k` that holds journeys (every kind but source):
 *
 *   t_<k>_<i>  the node's i-th Advance trigger, with its settings
 *   m_<k>      `journey.move` to k: a cause in, `moved` out
 *   s_<k>      `journey.stage` k: the arrival
 *
 * Workflow inputs `in.<k>` and `in.dropped` take manual moves and drops. A `group` source is a
 * `trigger.segment` node (`e_<source>`, `entered`, repeating: coming back to the group is a new
 * journey), a `sourced` source a `trigger.source` node and a `found` source a `trigger.found` node
 * (each `e_<source>`), each wired to the move node of every flow edge the source has. A job node
 * (a content line's station) holds documents: its move and stage nodes carry `doc` events. A parked source builds nothing. The move and stage
 * nodes are the workflow's own steps (`own`), not catalog parts: a wire joins equal event kinds
 * only, and each trigger fixes its own, so a move node takes one input per kind it hears.
 */
import type { EventKind, Port } from "@wren/core/components";
import { logicOf } from "@wren/core/logic";
import { defineWorkflow, type Wire, type Workflow, type WorkflowNode } from "@wren/core/workflows";
import { DROPPED, holds, type ShapeBody, subjectKindOf } from "./model.js";

export const MOVE_STEP = "journey.move";
export const STAGE_STEP = "journey.stage";
/** The port every move node has for a journey event: a manual move. */
export const JOURNEY_PORT = "journey";

/** The trigger a `group` source listens on: a person entering the group. */
const SEGMENT_TRIGGER = "trigger.segment";
/** The trigger a `sourced` source listens on: a person added to the list. */
const SOURCE_TRIGGER = "trigger.source";
/** The trigger a `found` source listens on: a document tagged with the line's SOP. */
const FOUND_TRIGGER = "trigger.found";

export type Scope = "wren" | "client";

/** `shape.v2`. */
export const shapeFlowId = (version: number) => `shape.v${version}`;
const FLOW_ID = /^shape\.v([1-9][0-9]*)$/;
/** A shape workflow's id taken apart; null when it is not one. */
export function parseShapeFlow(id: string): { version: number } | null {
  const m = FLOW_ID.exec(id);
  return m ? { version: Number(m[1]) } : null;
}

const port = (id: string, label: string, kind: EventKind): Port => ({ id, label, kind });

/** The kind a trigger's output carries; it fixes the move node's input for it. */
function outKind(adv: { trigger: string; with?: Record<string, string | number> }): EventKind {
  const out = logicOf(adv.trigger)?.ports(adv.with ?? {}).out[0];
  if (!out) throw new Error(`${adv.trigger} is not a trigger with an output`);
  return out.kind;
}

export function shapeWorkflow(versionNumber: number, body: ShapeBody, scope: Scope): Workflow {
  const nodes: WorkflowNode[] = [];
  const wires: Wire[] = [];
  const wire = (from: string, to: string) => wires.push({ from, to, via: "events" });
  const held = body.nodes.filter(holds);

  /** What an instance at a node moves as: a person's journey, or a document. */
  const movesAs = (n: (typeof held)[number]): EventKind =>
    subjectKindOf(n) === "document" ? "doc" : "journey";
  /** Each node's move-node inputs: one per event kind that reaches it. */
  const takes = new Map<string, Map<string, EventKind>>(
    held.map((n) => [n.id, new Map<string, EventKind>([[JOURNEY_PORT, movesAs(n)]])]),
  );
  const triggers: Array<{ node: WorkflowNode; tos: string[]; kind: EventKind }> = [];

  for (const n of held) {
    for (const [i, adv] of n.advance.entries()) {
      const kind = outKind(adv);
      // The node's own kind comes in on the journey port; any other kind on a port of its own.
      if (kind !== movesAs(n)) takes.get(n.id)?.set(kind, kind);
      triggers.push({
        node: { id: `t_${n.id}_${i}`, uses: adv.trigger, ...(adv.with ? { with: adv.with } : {}) },
        tos: [n.id],
        kind,
      });
    }
  }

  for (const s of body.nodes) {
    if (s.kind !== "source" || s.parked) continue;
    let node: WorkflowNode | undefined;
    let kind: EventKind | undefined;
    if (s.via === "group" && s.group) {
      const segment = Number(s.group);
      if (!Number.isSafeInteger(segment)) continue;
      // Each time: a person who leaves the group and comes back starts a new journey.
      const settings = { segment, on: "entered", repeat: "each" };
      kind = outKind({ trigger: SEGMENT_TRIGGER, with: settings });
      node = { id: `e_${s.id}`, uses: SEGMENT_TRIGGER, with: settings };
    } else if (s.via === "sourced" && s.source) {
      const settings = { source: s.source };
      kind = outKind({ trigger: SOURCE_TRIGGER, with: settings });
      node = { id: `e_${s.id}`, uses: SOURCE_TRIGGER, with: settings };
    } else if (s.via === "found" && (s.study || s.sop)) {
      const settings: Record<string, string> = s.study ? { study: s.study } : { sop: s.sop ?? "" };
      kind = outKind({ trigger: FOUND_TRIGGER, with: settings });
      node = { id: `e_${s.id}`, uses: FOUND_TRIGGER, with: settings };
    }
    if (!node || !kind) continue;
    const tos = [
      ...new Set(
        body.edges
          .filter((e) => e.kind === "flow" && e.from === s.id && takes.has(e.to))
          .map((e) => e.to),
      ),
    ];
    if (tos.length === 0) continue;
    for (const t of tos) {
      const n = held.find((h) => h.id === t);
      if (n && kind !== movesAs(n)) takes.get(t)?.set(kind, kind);
    }
    triggers.push({ node, tos, kind });
  }

  for (const n of held) {
    const as = movesAs(n);
    const doc = as === "doc";
    const inputs = [...(takes.get(n.id) ?? new Map<string, EventKind>()).entries()].map(
      ([id, kind]) =>
        port(id, id === JOURNEY_PORT ? (doc ? "documents" : "journeys") : `${kind} events`, kind),
    );
    const research =
      (n.kind === "step" || n.kind === "offer") && n.research ? { research: n.research } : {};
    const job = n.kind === "job" ? { job: n.job } : {};
    nodes.push({
      id: `m_${n.id}`,
      own: {
        name: `Move to ${n.name}`,
        blurb: doc
          ? `Moves a document forward to ${n.name}, or opens its instance there.`
          : `Moves a person's journey forward to ${n.name}, or opens one there.`,
        icon: "board",
        in: inputs,
        out: [port("moved", "moves", as)],
        run: MOVE_STEP,
      },
      with: { to: n.id },
    });
    nodes.push({
      id: `s_${n.id}`,
      own: {
        name: n.name,
        blurb: doc ? `A document reached ${n.name}.` : `A journey reached ${n.name}.`,
        icon: "board",
        in: [port("in", "moves", as)],
        out: [],
        run: STAGE_STEP,
      },
      with: { node: n.id, ...research, ...job },
    });
    wire(`m_${n.id}.moved`, `s_${n.id}.in`);
    wire(`in.${n.id}`, `m_${n.id}.${JOURNEY_PORT}`);
  }
  for (const t of triggers) {
    nodes.push(t.node);
    for (const to of t.tos) {
      const n = held.find((h) => h.id === to);
      const own = n && t.kind === movesAs(n);
      wire(`${t.node.id}.out`, `m_${to}.${own ? JOURNEY_PORT : t.kind}`);
    }
  }

  nodes.push({
    id: DROPPED,
    own: {
      name: "Dropped",
      blurb: "A journey was closed before the end.",
      icon: "board",
      in: [port("in", "drops", "journey")],
      out: [],
      run: STAGE_STEP,
    },
    with: { node: DROPPED },
  });
  wire(`in.${DROPPED}`, `${DROPPED}.in`);

  return defineWorkflow({
    id: shapeFlowId(versionNumber),
    name: body.name,
    blurb: `${body.name}, version ${versionNumber}: people through its nodes.`,
    icon: "board",
    for: scope,
    stage: "follow",
    in: [...held.map((n) => port(n.id, n.name, movesAs(n))), port(DROPPED, "Dropped", "journey")],
    nodes,
    wires,
  });
}
