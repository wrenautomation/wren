/**
 * One execution on its workflow's canvas: which cards it reached, how each went, and the in and
 * out data of each step. The spine keeps a step's node as a dotted path from the top workflow,
 * so a step inside a stacked card lights that card. Pure, so it's tested without a browser.
 */
import type { GraphNode, GraphTone } from "@wren/ui";
import type { Drawn } from "../marketplace/boxes.js";
import { boxOf } from "./canvas.js";

/** One step, as `console.execution` loads it (`executionSteps`). */
export interface TraceStep {
  id: string;
  node: string;
  port: string;
  kind: string;
  data: Record<string, unknown>;
  at: string;
  due: string | null;
  error: string | null;
  sent: { port: string; subject: string; kind: string; data: Record<string, unknown> }[] | null;
  sentAt: string | null;
}

/** One row of `console.execution`. */
export interface ExecutionRow {
  id: string;
  workflow: string;
  subject: string;
  kind: string;
  state: "failed" | "waiting" | "done";
  node: string;
  entered: string;
  lastAt: string;
  due: string | null;
  error: string | null;
  steps: number;
}

/** The card a step sits on: its node path's first id, or the workflow's own output. */
export const cardOf = (s: Pick<TraceStep, "node" | "port">) => {
  const [head = ""] = s.node.split(".");
  return head === "out" ? `out.${s.port}` : head;
};

export interface Trace {
  /** Cards it reached, and the inputs it entered by: lit, the rest faded. */
  lit: string[];
  /** How each reached card went. */
  states: Map<string, { label: string; tone: GraphTone }>;
  /** Each card's steps, in order. */
  steps: Map<string, TraceStep[]>;
}

const stateOf = (ss: readonly TraceStep[]): { label: string; tone: GraphTone } =>
  ss.some((s) => s.error)
    ? { label: "Failed", tone: "bad" }
    : ss.some((s) => s.due)
      ? { label: "Waiting", tone: "warn" }
      : { label: "Done", tone: "good" };

export function traceOf(w: Drawn, steps: readonly TraceStep[]): Trace {
  const by = new Map<string, TraceStep[]>();
  for (const s of steps) {
    const c = cardOf(s);
    by.set(c, [...(by.get(c) ?? []), s]);
  }
  const reached = new Set(by.keys());
  // The inputs it came in by: an input wired straight to a card it reached first.
  const first = steps[0] ? cardOf(steps[0]) : null;
  const entered = w.wires
    .filter((x) => boxOf(x.from).startsWith("in.") && boxOf(x.to) === first)
    .map((x) => boxOf(x.from));
  return {
    lit: [...new Set([...entered, ...reached])],
    states: new Map([...by].map(([c, ss]) => [c, stateOf(ss)])),
    steps: by,
  };
}

/** The canvas's cards with an execution's marks: each reached card's state and when it got there. */
export function litNodes(
  nodes: readonly GraphNode[],
  t: Trace,
  when: (iso: string) => string,
): GraphNode[] {
  return nodes.map((n) => {
    const ss = t.steps.get(n.id);
    const state = t.states.get(n.id);
    if (!ss?.length || !state) return { ...n, number: undefined, more: undefined, dim: false };
    const last = ss.at(-1) as TraceStep;
    return {
      ...n,
      state,
      dim: false,
      number: undefined,
      more: undefined,
      note: last.due
        ? `Waits until ${when(last.due)}`
        : `${ss.length > 1 ? `${ss.length} steps, last ` : ""}${when(last.sentAt ?? last.at)}`,
    };
  });
}

const UNITS: [number, string][] = [
  [86_400_000, "d"],
  [3_600_000, "h"],
  [60_000, "m"],
];

/** How long ago, short: "3d", "5h", "12m", "now". */
export function age(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  for (const [unit, sign] of UNITS) if (ms >= unit) return `${Math.floor(ms / unit)}${sign}`;
  return "now";
}

/** A step's data as text to read: pretty, cut past `most` characters. */
export function dataText(v: unknown, most = 4000): string {
  const t = JSON.stringify(v, null, 2) ?? "";
  return t.length > most ? `${t.slice(0, most)}\n…` : t;
}
