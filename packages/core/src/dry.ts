/**
 * A test of a workflow, dry (designs/2026-10-06-workflow-editor.md, Test): the spine's own walker
 * on a store in memory, so nothing is claimed, and on a clock of its own, so a two-day wait
 * passes at once. Logic nodes run for real, rules answer as the test says, and every other step
 * is a stub that says what it would do and passes the event on: by its outputs of the event's
 * kind, else down every branch. Nothing leaves this process.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Component, Effect, Port } from "./components.js";
import { logicOf, logicSteps } from "./logic.js";
import {
  type Arrival,
  resume,
  type SpineEvent,
  type SpineStore,
  type Step,
  type Tally,
  type Walk,
  walk,
} from "./spine.js";
import type { Workflow, WorkflowNode } from "./workflows.js";

/** One arrival in a test, in order: what came in, what it sent on, what it would have done. */
export interface DryStep {
  /** Dotted from the top workflow, as `events.node`; "out" when it left. */
  node: string;
  port: string;
  subject: string;
  /** Ms after the test began, on its own clock. */
  at: number;
  /** How long it waited on its wire first, in ms. */
  waited?: number;
  in: Record<string, unknown>;
  out: Array<{ port: string; data: Record<string, unknown> }>;
  /** What the step would have done outside: "Would send", "Would post to …". */
  would?: string;
  error?: string;
}

export interface DryResult {
  steps: DryStep[];
  tally: Tally;
  /** It stopped at `most` arrivals: a loop, or a very big test. */
  capped: boolean;
}

/** The most arrivals one test walks, and the most waits it lets pass. */
const MOST = 200;
const MOST_WAITS = 50;

class Capped extends Error {}

const WOULD: Record<Effect, string> = {
  sends: "Would send",
  spends: "Would spend",
  posts: "Would post",
};

/** What a stubbed node would do, in words. */
function wouldOf(n: WorkflowNode, part: Component | undefined): string {
  const run = n.own?.run ?? "";
  if (run.startsWith("https://")) return `Would post to ${new URL(run).host}`;
  const effects = part?.effects ?? [];
  if (effects.length) return effects.map((e) => WOULD[e]).join(", ");
  return `Would run ${part?.name ?? n.own?.name ?? n.uses ?? n.id}`;
}

/** A node's outputs, as the walker reads them. */
function outsOf(
  n: WorkflowNode,
  parts: ReadonlyMap<string, Component>,
  flows: ReadonlyMap<string, Workflow>,
): Port[] {
  return n.own?.out ?? parts.get(n.uses ?? "")?.out ?? flows.get(n.uses ?? "")?.out ?? [];
}

/**
 * Walk `events` from `from` ("in.port" or "node.port") through `workflow`, dry. `rules` is what
 * every rule answers: a wire's `when` and every If.
 */
export async function dryWalk(o: {
  flows: ReadonlyMap<string, Workflow>;
  parts: ReadonlyMap<string, Component>;
  workflow: string;
  from: string;
  events: SpineEvent[];
  client: string | null;
  rules?: boolean;
  most?: number;
}): Promise<DryResult> {
  const most = o.most ?? MOST;
  const steps: DryStep[] = [];
  const rows = new Map<
    string,
    { id: string; by: string; due: number | null; a: Arrival; step: DryStep }
  >();
  const byId = new Map<string, string>();
  const would = new Map<string, string>();
  const key = (a: Arrival) => [a.workflow, a.node, a.port, a.event.subject].join("|");
  let clock = 0;
  const waits: Array<{ id: string; at: number }> = [];

  // The Postgres store's rules, in memory: a row per arrival, owned by the call that kept it.
  const store: SpineStore = {
    async claim(a, by, due) {
      const r = rows.get(key(a));
      if (r) return r.by === by ? r.id : null;
      if (steps.length >= most) throw new Capped();
      const id = String(rows.size + 1);
      // The walker set `due` from the real clock: back to its wait, to the second.
      const ms = due ? Math.round(Math.max(0, due.getTime() - Date.now()) / 1000) * 1000 : 0;
      const step: DryStep = {
        node: a.node,
        port: a.port,
        subject: a.event.subject,
        at: clock,
        in: a.event.data,
        out: [],
        ...(due ? { waited: ms } : {}),
      };
      steps.push(step);
      rows.set(key(a), { id, by, due: due ? clock + ms : null, a, step });
      byId.set(id, key(a));
      return id;
    },
    async release(id, by) {
      const r = rows.get(byId.get(id) ?? "");
      if (!r || !(r.due !== null || r.by === by)) return null;
      r.step.at = r.due ?? clock;
      r.due = null;
      r.by = by;
      return r.a;
    },
    async fail(a, error) {
      const r = rows.get(key(a));
      if (r) r.step.error = error;
    },
    async retry() {
      return null;
    },
    async sent(id, outs) {
      const r = rows.get(byId.get(id) ?? "");
      if (!r) return;
      r.step.out = outs.map((x) => ({ port: x.port, data: x.event.data }));
      const w = would.get(`${r.a.node}|${r.a.event.subject}`);
      if (w) r.step.would = w;
    },
  };

  const rule = async () => o.rules ?? true;
  const logic = logicSteps(rule);
  const dry = (n: WorkflowNode): Step => {
    if (n.uses && logicOf(n.uses)) return logic[n.uses] ?? (async () => []);
    const part = n.uses ? o.parts.get(n.uses) : undefined;
    const outs = outsOf(n, o.parts, o.flows);
    // A stub passes the event on by each output of its kind, as a run where it went through.
    // One with none of its kind (a call in, a client out) sends it down every branch it has.
    return async (_port, e, at) => {
      would.set(`${at.node}|${e.subject}`, wouldOf(n, part));
      const same = outs.filter((p) => p.kind === e.kind);
      return (same.length ? same : outs).map((p) => ({
        port: p.id,
        event: { ...e, kind: p.kind },
      }));
    };
  };

  let call = 0;
  const walkOf = (): Walk => ({
    flows: o.flows,
    parts: o.parts,
    steps: {},
    store,
    client: o.client,
    by: `dry:${call++}`,
    run: async (_name, fn, capped) => {
      try {
        return await fn();
      } catch (err) {
        if (capped && !(err instanceof Capped) && !(err instanceof restate.TerminalError))
          throw new restate.TerminalError((err as Error).message);
        throw err;
      }
    },
    later: (id, ms) => waits.push({ id, at: clock + ms }),
    rule,
    dry,
  });

  const tally: Tally = { arrived: 0, seen: 0, waiting: 0, failed: 0, out: 0 };
  const add = (t: Tally | null) => {
    if (!t) return;
    for (const k of Object.keys(tally) as (keyof Tally)[]) tally[k] += t[k];
  };
  try {
    add(await walk(walkOf(), o.workflow, o.from, o.events));
    // Each wait passes on the test's clock, soonest first.
    for (let i = 0; i < MOST_WAITS && waits.length; i++) {
      waits.sort((a, b) => a.at - b.at);
      const next = waits.shift() as { id: string; at: number };
      clock = next.at;
      tally.waiting--;
      add(await resume(walkOf(), next.id));
    }
  } catch (err) {
    if (!(err instanceof Capped)) throw err;
    return { steps, tally, capped: true };
  }
  return { steps, tally, capped: waits.length > 0 };
}

/**
 * Test step: one node on one event, dry. A node that opens a workflow walks it whole; any other
 * runs its own step (logic) or its stub, and nothing after it.
 */
export async function dryStep(o: {
  flows: ReadonlyMap<string, Workflow>;
  parts: ReadonlyMap<string, Component>;
  workflow: string;
  node: string;
  port: string;
  event: SpineEvent;
  client: string | null;
  rules?: boolean;
}): Promise<DryResult> {
  const flow = o.flows.get(o.workflow);
  const n = flow?.nodes.find((x) => x.id === o.node);
  if (!flow || !n) throw new Error(`no node ${o.node}`);
  const inside = n.uses ? (o.parts.get(n.uses)?.inside ?? n.uses) : undefined;
  if (inside && !logicOf(n.uses) && o.flows.has(inside))
    return dryWalk({ ...o, workflow: inside, from: `in.${o.port}`, events: [o.event] });
  // Alone: a walk with only this node, wired from a test input, so its outputs go nowhere.
  const alone: Workflow = {
    ...flow,
    in: [{ id: "test", label: "test", kind: o.event.kind }],
    nodes: [n],
    wires: [{ from: "in.test", to: `${n.id}.${o.port}`, via: "events" }],
  };
  return dryWalk({
    ...o,
    flows: new Map([...o.flows, [flow.id, alone]]),
    from: "in.test",
    events: [o.event],
  });
}

/** A sample event of `kind` for a test: synthetic, about no one real. */
export const sampleEvent = (
  kind: SpineEvent["kind"],
  data: Record<string, unknown> = {},
): SpineEvent => ({
  subject: `test:${kind}`,
  kind,
  data,
});
