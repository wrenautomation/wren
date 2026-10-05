/**
 * A workflow: parts wired output to input, with inputs and outputs of its own, so it nests in
 * another workflow as a node (designs/2026-10-05-workflows.md). This module knows the shape and
 * the check, never a workflow; the worker collects Wren's.
 */
import { type Component, EVENT_KINDS, type Port, type Stage } from "./components.js";

/**
 * A custom step: the escape hatch for a one-off integration, kept out of the catalog. Anything
 * reusable, built or planned, is a component.
 */
export interface Own {
  name: string;
  blurb: string;
  icon: string;
  in: Port[];
  out: Port[];
  /** The step's registered name, or the https URL it posts each event to. */
  run: string;
}

export interface WorkflowNode {
  /** Unique in its workflow; `in` and `out` name the workflow's own ports. */
  id: string;
  /** A component's or a workflow's id. */
  uses?: string;
  own?: Own;
  /** What it does here, over its blurb. */
  note?: string;
}

export interface Wire {
  /** "node.port": a node's output, or `in.<port>` for the workflow's own input. */
  from: string;
  /** "node.port": a node's input, or `out.<port>` for the workflow's own output. */
  to: string;
  /** "code": the parts' own code moves it today. "events": the event log does, so it rewires. */
  via: "code" | "events";
  /** A rule in words; only what matches passes. */
  when?: string;
  /** "90 days", or "until <kind>". */
  wait?: string;
}

export interface Workflow {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  for: "client" | "wren";
  stage: Stage;
  in: Port[];
  out: Port[];
  nodes: WorkflowNode[];
  wires: Wire[];
}

type Input = Omit<Workflow, "in" | "out"> & Partial<Pick<Workflow, "in" | "out">>;

export const defineWorkflow = (w: Input): Workflow => ({ ...w, in: w.in ?? [], out: w.out ?? [] });

const NODE_ID = /^[a-z][a-z0-9_]*$/;
const WAIT = /^(\d+ (minute|hour|day|week)s?|until [a-z]+)$/;

/** A node's ports, from whatever it uses; null when that's unknown. */
function portsOf(
  n: WorkflowNode,
  parts: ReadonlyMap<string, Component>,
  flows: ReadonlyMap<string, Workflow>,
): { in: Port[]; out: Port[] } | null {
  if (n.own) return n.own;
  const p = (n.uses && (parts.get(n.uses) ?? flows.get(n.uses))) || null;
  return p ? { in: p.in, out: p.out } : null;
}

/** Every way these workflows break against these parts, as readable lines; empty when sound. */
export function checkWorkflows(
  workflows: readonly Workflow[],
  components: readonly Component[],
): string[] {
  const out: string[] = [];
  const parts = new Map(components.map((c) => [c.id, c]));
  const flows = new Map<string, Workflow>();
  for (const w of workflows) {
    if (parts.has(w.id) || flows.has(w.id)) out.push(`${w.id}: id taken`);
    flows.set(w.id, w);
  }

  for (const c of components)
    if (c.inside !== null) {
      const w = flows.get(c.inside);
      if (!w) out.push(`${c.id}: inside ${c.inside} is no workflow`);
      else if (!samePorts(c, w)) out.push(`${c.id}: its ports differ from ${w.id}'s`);
    }

  for (const w of workflows) {
    const nodes = new Map<string, WorkflowNode>();
    for (const n of w.nodes) {
      if (!NODE_ID.test(n.id) || n.id === "in" || n.id === "out")
        out.push(`${w.id}: bad node id ${n.id}`);
      if (nodes.has(n.id)) out.push(`${w.id}: two nodes ${n.id}`);
      nodes.set(n.id, n);
      if (!n.uses === !n.own) out.push(`${w.id}.${n.id}: needs uses or own, not both`);
      else if (!portsOf(n, parts, flows))
        out.push(`${w.id}.${n.id}: uses ${n.uses}, which isn't one`);
      if (n.own && !/^(https:\/\/\S+|[a-z][a-z0-9_.]*)$/.test(n.own.run))
        out.push(`${w.id}.${n.id}: run is no step name or https URL`);
    }

    /** The port a wire end names, on the side it must be. */
    const end = (ref: string, side: "from" | "to"): Port | string => {
      const [node, port, ...rest] = ref.split(".");
      if (!node || !port || rest.length) return `${ref} is not node.port`;
      if (node === (side === "from" ? "in" : "out")) {
        const own = side === "from" ? w.in : w.out;
        return own.find((p) => p.id === port) ?? `${ref}: the workflow has no such port`;
      }
      const n = nodes.get(node);
      if (!n) return `${ref}: no node ${node}`;
      const ports = portsOf(n, parts, flows);
      const p = (side === "from" ? ports?.out : ports?.in)?.find((x) => x.id === port);
      return p ?? `${ref}: ${node} has no ${side === "from" ? "output" : "input"} ${port}`;
    };

    const used = new Set<string>();
    for (const wire of w.wires) {
      const a = end(wire.from, "from");
      const b = end(wire.to, "to");
      used.add(wire.from).add(wire.to);
      for (const e of [a, b]) if (typeof e === "string") out.push(`${w.id}: ${e}`);
      if (typeof a !== "string" && typeof b !== "string" && a.kind !== b.kind)
        out.push(`${w.id}: ${wire.from} carries ${a.kind}, ${wire.to} takes ${b.kind}`);
      if (wire.wait !== undefined) {
        const until = wire.wait.startsWith("until ") ? wire.wait.slice(6) : null;
        if (!WAIT.test(wire.wait) || (until !== null && !(until in EVENT_KINDS)))
          out.push(`${w.id}: wait "${wire.wait}" is not "<n> days" or "until <kind>"`);
      }
    }
    for (const p of w.in) if (!used.has(`in.${p.id}`)) out.push(`${w.id}: in.${p.id} goes nowhere`);
    for (const p of w.out)
      if (!used.has(`out.${p.id}`)) out.push(`${w.id}: out.${p.id} gets nothing`);
  }

  // A workflow may not hold itself, through a node or a part's inside.
  const holds = (id: string): string[] => {
    const w = flows.get(id);
    if (!w) return [];
    return w.nodes.flatMap((n) => {
      const c = n.uses ? parts.get(n.uses) : undefined;
      return [c ? c.inside : n.uses].filter((x): x is string => !!x && flows.has(x));
    });
  };
  for (const w of workflows) {
    const seen = new Set<string>();
    const todo = holds(w.id);
    while (todo.length) {
      const id = todo.pop() as string;
      if (id === w.id) {
        out.push(`${w.id}: holds itself`);
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      todo.push(...holds(id));
    }
  }
  return out;
}

/**
 * Every part a workflow runs, through the workflows it nests but not into a part's own inside:
 * the part already speaks for it. Its channels, effects and readiness are theirs.
 */
export function partsIn(
  id: string,
  workflows: readonly Workflow[],
  components: readonly Component[],
): Component[] {
  const parts = new Map(components.map((c) => [c.id, c]));
  const flows = new Map(workflows.map((w) => [w.id, w]));
  const out = new Map<string, Component>();
  const seen = new Set<string>();
  const walk = (w: Workflow | undefined) => {
    if (!w || seen.has(w.id)) return;
    seen.add(w.id);
    for (const n of w.nodes) {
      const c = n.uses ? parts.get(n.uses) : undefined;
      if (c) out.set(c.id, c);
      else if (n.uses) walk(flows.get(n.uses));
    }
  };
  walk(flows.get(id));
  return [...out.values()];
}

const key = (ps: readonly Port[]) =>
  ps
    .map((p) => `${p.id}:${p.kind}`)
    .sort()
    .join(",");
const samePorts = (a: { in: Port[]; out: Port[] }, b: { in: Port[]; out: Port[] }) =>
  key(a.in) === key(b.in) && key(a.out) === key(b.out);
