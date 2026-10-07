/**
 * A dry test on the canvas (designs/2026-10-06-workflow-editor.md, Test): the steps
 * `console/workflowTest` answers, as an execution's trace, so the same cards light. Its times are
 * on the test's own clock, from when it began. Pure, so it's tested without a browser.
 */
import type { Port } from "@wren/core/components";
import type { GraphNode, GraphTone } from "@wren/ui";
import type { Drawn } from "../marketplace/boxes.js";
import { type TraceStep, traceOf } from "./trace.js";

/** One arrival in a test, as `dryWalk` keeps it. */
export interface DryStep {
  node: string;
  port: string;
  subject: string;
  /** Ms after the test began. */
  at: number;
  waited?: number;
  in: Record<string, unknown>;
  out: Array<{ port: string; data: Record<string, unknown> }>;
  would?: string;
  error?: string;
}

export interface DryResult {
  steps: DryStep[];
  tally: { arrived: number; seen: number; waiting: number; failed: number; out: number };
  capped: boolean;
}

const UNITS: [number, string][] = [
  [604_800_000, "week"],
  [86_400_000, "day"],
  [3_600_000, "hour"],
  [60_000, "minute"],
];

/** When on the test's clock: "at once", "after 2 days". */
export function afterText(ms: number): string {
  for (const [unit, name] of UNITS)
    if (ms >= unit && ms % unit === 0) {
      const n = ms / unit;
      return `after ${n} ${name}${n === 1 ? "" : "s"}`;
    }
  if (ms >= 60_000) return `after ${Math.round(ms / 60_000)} minutes`;
  return "at once";
}

/** The test's steps as an execution's: each keeps its index as its id and ms as its time. */
export function dryTrace(w: Drawn, steps: readonly DryStep[]) {
  const ts: TraceStep[] = steps.map((s, i) => ({
    id: String(i),
    node: s.node,
    port: s.port,
    kind: "",
    data: s.in,
    at: String(s.at),
    due: null,
    error: s.error ?? null,
    sent: s.out.map((o) => ({ port: o.port, subject: s.subject, kind: "", data: o.data })),
    sentAt: null,
  }));
  return traceOf(w, ts);
}

/** How a card went in the test: failed, would do something outside, or passed. */
function stateOf(ss: readonly DryStep[]): { label: string; tone: GraphTone } {
  if (ss.some((s) => s.error)) return { label: "Failed", tone: "bad" };
  const would = ss.find((s) => s.would)?.would;
  return would ? { label: would, tone: "accent" } : { label: "Passed", tone: "good" };
}

/**
 * The canvas's cards with a test's marks; cards it never reached keep no numbers. `from` is where
 * it entered: "in.<port>" or a trigger's "<node>.<port>".
 */
export function dryNodes(
  nodes: readonly GraphNode[],
  w: Drawn,
  steps: readonly DryStep[],
  from?: string,
): { nodes: GraphNode[]; lit: string[] } {
  const t = dryTrace(w, steps);
  // Where it entered is known: that input or trigger, rather than the one the trace guesses.
  if (from) {
    const [head = "", port = ""] = from.split(".");
    const start = head === "in" ? `in.${port}` : head;
    t.lit = [start, ...t.lit.filter((x) => !x.startsWith("in.") && x !== start)];
  }
  const by = new Map<string, DryStep[]>();
  for (const [card, ts] of t.steps)
    by.set(
      card,
      ts.map((x) => steps[Number(x.id)] as DryStep),
    );
  return {
    lit: t.lit,
    nodes: nodes.map((n) => {
      const ss = by.get(n.id);
      if (!ss?.length) return { ...n, number: undefined, more: undefined, dim: false };
      const last = ss.at(-1) as DryStep;
      return {
        ...n,
        state: stateOf(ss),
        dim: false,
        number: undefined,
        more: undefined,
        note: afterText(last.at),
      };
    }),
  };
}

/**
 * Where a whole test may enter: the workflow's inputs, then each output of a card nothing feeds
 * (a trigger, a lead sheet). Each as a port whose id is the wire end the walk starts from.
 */
export function entriesOf(w: Drawn): Port[] {
  const fed = new Set(w.wires.map((x) => x.to.split(".")[0]));
  return [
    ...w.in.map((p) => ({ ...p, id: `in.${p.id}` })),
    ...w.nodes
      .filter((n) => !fed.has(n.id))
      .flatMap((n) =>
        (n.out ?? []).map((p) => ({ ...p, id: `${n.id}.${p.id}`, label: `${n.name}: ${p.label}` })),
      ),
  ];
}
