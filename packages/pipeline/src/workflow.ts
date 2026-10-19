/**
 * A funnel version as a spine workflow (designs/2026-10-18-journeys.md, "The generated
 * workflow"). Pure, the way `cadenceWorkflow` is. Per stage `k`:
 *
 *   t_<k>_<i>  the stage's i-th Advance trigger, with its settings
 *   m_<k>      `journey.move` to k: a cause in, `moved` out
 *   s_<k>      `journey.stage` k: the stage arrival
 *
 * Workflow inputs `in.<k>` and `in.dropped` take manual moves and drops. A `funnel` entry is a
 * `trigger.journey` node (`e_<i>`) wired to the move node of the stage it opens at; a `group`
 * entry is a `trigger.segment` node (`e_<i>`, `entered`) wired the same way. The move and
 * stage nodes are the workflow's own steps (`own`), not catalog parts: a wire joins equal event
 * kinds only, and each trigger fixes its own, so a move node takes one input per kind it hears.
 */
import type { EventKind, Port } from "@wren/core/components";
import { logicOf } from "@wren/core/logic";
import { defineWorkflow, type Wire, type Workflow, type WorkflowNode } from "@wren/core/workflows";
import { DROPPED, type FunnelBody } from "./model.js";

export const MOVE_STEP = "journey.move";
export const STAGE_STEP = "journey.stage";
/** The port every move node has for a journey event: a manual move or a composed funnel. */
export const JOURNEY_PORT = "journey";

/** The trigger a `group` entry listens on: a person entering the group. */
export const SEGMENT_TRIGGER = "trigger.segment";

export type Scope = "wren" | "client";

/** `funnel.main.v2`. */
export const funnelFlowId = (funnel: string, version: number) => `funnel.${funnel}.v${version}`;
const FLOW_ID = /^funnel\.([a-z][a-z0-9_-]*)\.v([1-9][0-9]*)$/;
/** A funnel workflow's id taken apart; null when it is not one. */
export function parseFunnelFlow(id: string): { funnel: string; version: number } | null {
  const m = FLOW_ID.exec(id);
  return m ? { funnel: m[1] as string, version: Number(m[2]) } : null;
}

const port = (id: string, label: string, kind: EventKind): Port => ({ id, label, kind });

/** The kind a trigger's output carries; it fixes the move node's input for it. */
function outKind(adv: { trigger: string; with?: Record<string, string | number> }): EventKind {
  const out = logicOf(adv.trigger)?.ports(adv.with ?? {}).out[0];
  if (!out) throw new Error(`${adv.trigger} is not a trigger with an output`);
  return out.kind;
}

/**
 * `saleOf` answers a `funnel` entry that names no stage: that funnel's sale stage. Without it,
 * or when it knows no such funnel, the entry gets no node.
 */
export function funnelWorkflow(
  funnelId: string,
  versionNumber: number,
  body: FunnelBody,
  scope: Scope,
  saleOf?: (funnel: string) => string | undefined,
): Workflow {
  const nodes: WorkflowNode[] = [];
  const wires: Wire[] = [];
  const wire = (from: string, to: string) => wires.push({ from, to, via: "events" });
  const first = body.stages[0]?.key;

  /** Each stage's move-node inputs: one per event kind that reaches it. */
  const takes = new Map<string, Map<string, EventKind>>(
    body.stages.map((s) => [s.key, new Map<string, EventKind>([[JOURNEY_PORT, "journey"]])]),
  );
  const triggers: Array<{ node: WorkflowNode; to: string; kind: EventKind }> = [];

  for (const s of body.stages) {
    for (const [i, adv] of s.on.entries()) {
      const kind = outKind(adv);
      takes.get(s.key)?.set(kind, kind);
      triggers.push({
        node: { id: `t_${s.key}_${i}`, uses: adv.trigger, ...(adv.with ? { with: adv.with } : {}) },
        to: s.key,
        kind,
      });
    }
  }
  for (const [i, e] of body.entries.entries()) {
    if (e.kind !== "funnel" || !e.funnel) continue;
    const stage = e.funnel.at ?? saleOf?.(e.funnel.id);
    const to = e.to ?? first;
    if (!stage || !to) continue;
    triggers.push({
      node: {
        id: `e_${i}`,
        uses: "trigger.journey",
        with: { funnel: e.funnel.id, stage, on: "entered" },
      },
      to,
      kind: "journey",
    });
  }

  for (const [i, e] of body.entries.entries()) {
    if (e.kind !== "group" || !e.group) continue;
    const to = e.to ?? first;
    const segment = Number(e.group);
    if (!to || !Number.isSafeInteger(segment) || !takes.has(to)) continue;
    const settings = { segment, on: "entered" };
    const kind = outKind({ trigger: SEGMENT_TRIGGER, with: settings });
    takes.get(to)?.set(kind, kind);
    triggers.push({ node: { id: `e_${i}`, uses: SEGMENT_TRIGGER, with: settings }, to, kind });
  }

  for (const s of body.stages) {
    const inputs = [...(takes.get(s.key) ?? new Map<string, EventKind>()).entries()].map(
      ([id, kind]) => port(id, id === JOURNEY_PORT ? "journeys" : `${kind} events`, kind),
    );
    nodes.push({
      id: `m_${s.key}`,
      own: {
        name: `Move to ${s.label}`,
        blurb: `Moves a person's journey forward to ${s.label}, or opens one there.`,
        icon: "board",
        in: inputs,
        out: [port("moved", "moves", "journey")],
        run: MOVE_STEP,
      },
      with: { to: s.key },
    });
    nodes.push({
      id: `s_${s.key}`,
      own: {
        name: s.label,
        blurb: `A journey reached ${s.label}.`,
        icon: "board",
        in: [port("in", "moves", "journey")],
        out: [],
        run: STAGE_STEP,
      },
      with: { stage: s.key, ...(s.research ? { research: s.research } : {}) },
    });
    wire(`m_${s.key}.moved`, `s_${s.key}.in`);
    wire(`in.${s.key}`, `m_${s.key}.${JOURNEY_PORT}`);
  }
  for (const t of triggers) {
    nodes.push(t.node);
    wire(`${t.node.id}.out`, `m_${t.to}.${t.kind === "journey" ? JOURNEY_PORT : t.kind}`);
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
    with: { stage: DROPPED },
  });
  wire(`in.${DROPPED}`, `${DROPPED}.in`);

  return defineWorkflow({
    id: funnelFlowId(funnelId, versionNumber),
    name: body.name,
    blurb: `${body.name}, version ${versionNumber}: people through its stages.`,
    icon: "board",
    for: scope,
    stage: "follow",
    in: [
      ...body.stages.map((s) => port(s.key, s.label, "journey")),
      port(DROPPED, "Dropped", "journey"),
    ],
    nodes,
    wires,
  });
}
