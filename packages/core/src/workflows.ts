/**
 * A workflow: parts wired output to input, with inputs and outputs of its own, so it nests in
 * another workflow as a node (designs/2026-10-05-workflows.md). This module knows the shape and
 * the check, never a workflow; the worker collects Wren's.
 */
import { type Component, EVENT_KINDS, type Port, type Stage } from "./components.js";
import { logicOf, logicProblems } from "./logic.js";
import type { TemplateRef } from "./templates.js";

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
  /** Its settings at this node, handed to its step: which copy, which step. */
  with?: Record<string, string | number>;
  /** The copy it sends, in the template store: what the Library joins a step's numbers on. */
  template?: TemplateRef;
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

/**
 * A workflow sold as one install (designs/2026-10-07-template-install.md): the parts it puts on a
 * client, each with its settings, the copy beyond what those parts read, and its door.
 */
export interface TemplateSpec {
  /** Part id to its settings block, requirements first. Every part a listed one requires is listed. */
  parts: Record<string, Record<string, unknown>>;
  /** Copy refs or prefixes (`sms:texts/speed-to-lead#1`) beyond the parts' own `provides.templates`. */
  copy?: string[];
  /** Where leads come in from outside: a hook on this input, keyed by `subject` in the payload. */
  door?: { input: string; subject: string };
}

export interface Workflow {
  id: string;
  /**
   * `setup`: runs once per account and leaves facts on it (`./setup.ts`); kept out of the Shop's
   * workflows, opened from the account. Absent: an ordinary workflow.
   */
  kind?: "setup";
  name: string;
  blurb: string;
  icon: string;
  for: "client" | "wren";
  stage: Stage;
  in: Port[];
  out: Port[];
  nodes: WorkflowNode[];
  wires: Wire[];
  /** Set: the Shop sells it as a template a client installs in one go. */
  template?: TemplateSpec;
}

type Input = Omit<Workflow, "in" | "out"> & Partial<Pick<Workflow, "in" | "out">>;

export const defineWorkflow = (w: Input): Workflow => ({ ...w, in: w.in ?? [], out: w.out ?? [] });

/**
 * One step of any channel's sequence, as the spine runs it: after its wait, one touch by a
 * channel's part, sending one template. Email, texts and DMs each declare their steps their own
 * way (business days from the opener, days after the last); their cadences all come out as these.
 */
export interface CadenceStep {
  /** The wait after the previous step went ("2 days"); none = right away. */
  after?: string;
  /** The part that makes the touch: `sms.touch`. */
  touch: string;
  /** The copy it sends: kind (the channel's), system, name. */
  template: TemplateRef;
  with: Record<string, string | number>;
}

/** A follow-up cadence's workflow id. */
export const cadenceId = (name: string) => `follow_up.${name}`;

/**
 * A follow-up cadence as a workflow of touches (designs/2026-10-05-workflows.md, Follow-ups). A
 * lead enters the first; each touch's `sent` leaves when the channel's sender sends it and waits
 * on the next one's wire; any touch answers `replied` instead once they have; the last `sent`
 * leaves as `quiet`. Node `s<n>` is step n, so a sender knows where a sent step leaves from.
 */
export function cadenceWorkflow(c: {
  name: string;
  label: string;
  blurb: string;
  for: Workflow["for"];
  steps: readonly CadenceStep[];
}): Workflow {
  const at = (i: number) => `s${i + 1}`;
  const wait = (s: CadenceStep) => (s.after ? { wait: s.after } : {});
  return defineWorkflow({
    id: cadenceId(c.name),
    name: c.label,
    blurb: c.blurb,
    icon: "cycle",
    for: c.for,
    stage: "follow",
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [
      { id: "replied", label: "replies", kind: "reply" },
      { id: "quiet", label: "every step sent", kind: "lead" },
    ],
    nodes: c.steps.map((s, i) => ({
      id: at(i),
      uses: s.touch,
      with: s.with,
      template: s.template,
    })),
    wires: c.steps.flatMap((s, i) => [
      {
        from: i === 0 ? "in.leads" : `${at(i - 1)}.sent`,
        to: `${at(i)}.lead`,
        via: "events" as const,
        ...wait(s),
      },
      { from: `${at(i)}.replied`, to: "out.replied", via: "events" as const },
      ...(i === c.steps.length - 1
        ? [{ from: `${at(i)}.sent`, to: "out.quiet", via: "events" as const }]
        : []),
    ]),
  });
}

const NODE_ID = /^[a-z][a-z0-9_]*$/;
const WAIT = /^(\d+ (minute|hour|day|week)s?|until [a-z]+)$/;

/** A node's ports, from whatever it uses; null when that's unknown. */
export function portsOf(
  n: WorkflowNode,
  parts: ReadonlyMap<string, Component>,
  flows: ReadonlyMap<string, Workflow>,
): { in: Port[]; out: Port[] } | null {
  if (n.own) return n.own;
  const l = logicOf(n.uses);
  if (l) return l.ports(n.with ?? {});
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
      out.push(...logicProblems(`${w.id}.${n.id}`, n));
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
    if (w.template) out.push(...templateProblems(w, w.template, components));
  }

  for (const c of components)
    if (
      c.comesWith &&
      !workflows.some((w) => w.template && templateIdOf(w, components) === c.comesWith)
    )
      out.push(`${c.id}: comes with ${c.comesWith}, which is no template`);

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
 * A workflow as one client saved it on the canvas (designs/2026-10-05-workflows.md, Editing): its
 * routed wires and the nodes it added, whole. An added node is a custom step, a logic node or
 * trigger (`./logic.ts`), or a part or workflow from the catalog. The code's nodes and built-in
 * wires always come from code, so a change there still reaches every saved copy.
 */
export interface WorkflowEdits {
  wires: Wire[];
  steps: WorkflowNode[];
  /** A built-in logic node's settings as the save has them (a Wait's "at most"), by node id. */
  settings?: Record<string, Record<string, string | number>>;
}

export const withEdits = (w: Workflow, e: WorkflowEdits): Workflow => ({
  ...w,
  nodes: [
    ...w.nodes.map((n) => {
      const set = e.settings?.[n.id];
      return set ? { ...n, with: set } : n;
    }),
    ...e.steps,
  ],
  wires: [...w.wires.filter((x) => x.via === "code"), ...e.wires],
});

/**
 * What a save may not do that the check allows: rewire a built-in wire, wait "until", add a
 * custom step that isn't an https URL, or give a client's workflow one of Wren's own parts.
 */
function editRules(
  w: Workflow,
  e: WorkflowEdits,
  parts: ReadonlyMap<string, Component>,
  flows: ReadonlyMap<string, Workflow>,
): string[] {
  const wrens = (s: WorkflowNode) =>
    w.for === "client" &&
    !!s.uses &&
    (parts.get(s.uses)?.for === "wren" || flows.get(s.uses)?.for === "wren");
  return [
    ...e.wires
      .filter((x) => x.via !== "events")
      .map((x) => `${w.id}: ${x.from} to ${x.to} is built in, so it can't be rewired yet`),
    ...e.wires
      .filter((x) => x.wait?.startsWith("until "))
      .map((x) => `${w.id}: waits until an event aren't built yet (${x.from} to ${x.to})`),
    ...e.steps
      .filter((s) => s.own && !s.own.run.startsWith("https://"))
      .map((s) => `${w.id}.${s.id}: an added custom step runs at an https URL`),
    ...Object.keys(e.settings ?? {})
      .filter((id) => !w.nodes.find((n) => n.id === id)?.uses?.startsWith("logic."))
      .map((id) => `${w.id}.${id}: only a built-in logic node's settings change in a save`),
    ...e.steps
      .filter(wrens)
      .map((s) => `${w.id}.${s.id}: ${s.uses} runs Wren's own business, not a client's`),
  ];
}

/**
 * Every workflow with its saved edits in (null: back to the code's), and why a save was left
 * out: it fails the check, after a code change or before saving. Edits touch one workflow's
 * insides, never its ports, so each is checked against the code alone.
 */
export function flowsWith(
  workflows: readonly Workflow[],
  saves: Readonly<Record<string, WorkflowEdits | null>>,
  components: readonly Component[],
): { flows: Workflow[]; broken: Record<string, string[]> } {
  const flows = [...workflows];
  const broken: Record<string, string[]> = {};
  const parts = new Map(components.map((c) => [c.id, c]));
  const byId = new Map(workflows.map((w) => [w.id, w]));
  for (const [id, e] of Object.entries(saves)) {
    const i = workflows.findIndex((w) => w.id === id);
    const w = workflows[i];
    if (!w || !e) continue;
    const next = withEdits(w, e);
    const lines = [
      ...editRules(w, e, parts, byId),
      ...checkWorkflows(
        workflows.map((x) => (x === w ? next : x)),
        components,
      ),
    ];
    if (lines.length) broken[id] = lines;
    else flows[i] = next;
  }
  return { flows, broken };
}

/** A template's Shop id: the part whose inside it is, else the workflow's own. */
export const templateIdOf = (w: Pick<Workflow, "id">, components: readonly Component[]): string =>
  components.find((c) => c.inside === w.id)?.id ?? w.id;

/** What's wrong with a workflow's template: parts, their order and settings, its door. */
function templateProblems(w: Workflow, t: TemplateSpec, components: readonly Component[]) {
  const out: string[] = [];
  const id = templateIdOf(w, components);
  if (w.for !== "client") out.push(`${w.id}: a template is for clients`);
  const listed = Object.keys(t.parts);
  for (const [i, pid] of listed.entries()) {
    const c = components.find((x) => x.id === pid);
    if (!c) {
      out.push(`${w.id}: template part ${pid} isn't one`);
      continue;
    }
    if (c.for !== "client") out.push(`${w.id}: template part ${pid} runs Wren's own business`);
    if (!c.settings.safeParse(t.parts[pid]).success)
      out.push(`${w.id}: template settings for ${pid} don't parse`);
    for (const r of c.requires.components)
      if (!listed.slice(0, i).includes(r)) out.push(`${w.id}: ${pid} needs ${r} listed before it`);
    if (c.comesWith && c.comesWith !== id)
      out.push(`${w.id}: ${pid} comes with ${c.comesWith}, not this template`);
  }
  for (const c of components)
    if (c.comesWith === id && !listed.includes(c.id))
      out.push(`${w.id}: ${c.id} comes with it but isn't listed`);
  if (t.door && !w.in.some((p) => p.id === t.door?.input))
    out.push(`${w.id}: the door's input ${t.door.input} isn't one`);
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
