/**
 * What reads a trail chain (`chain.ts`), behind interfaces, so a better method can take a slot
 * without a change to the callers. Each slot has a registry and a default id:
 *
 * - `NodeValuer`: each node's chance to reach the goal and the moves it takes. First: the
 *   absorbing Markov chain.
 * - `SkipRule`: when a skip is an express arc, and when a node is optional (a dashed ring). First:
 *   the Wilson low bound; the raw share stays as the other.
 */
import { Matrix, solve } from "ml-matrix";
import { type Chain, chancesOf } from "./chain.js";
import { DROPPED } from "./model.js";

/** A node's value. */
export interface Value {
  /** The chance that a person at the node reaches the goal, 0 to 1. */
  reach: number;
  /** The moves that a person at the node who reaches the goal makes on the way; null if none can. */
  steps: number | null;
}

export interface NodeValuer {
  id: string;
  name: string;
  /** A value for each node of the chain. A goal node: reach 1 in 0 steps. */
  values(chain: Chain): Map<string, Value>;
}

/**
 * The absorbing Markov chain. Q holds the chances between the nodes that are not ends, R the
 * chances into the goal. With N = (I − Q)⁻¹, reach is B = N·R, and N·B over B is the moves to the
 * goal of the people who reach it. Solved with LU, never a full inverse.
 *
 * A node no path leaves (no exits, or a closed loop with no way to an end) keeps nobody moving:
 * reach 0, steps null. A move into one counts as an end with no win. This also keeps I − Q
 * invertible.
 */
const markov: NodeValuer = {
  id: "markov",
  name: "Absorbing Markov chain",
  values(chain) {
    const out = new Map<string, Value>();
    for (const g of chain.goal) out.set(g, { reach: 1, steps: 0 });
    const rows = new Map(
      chain.nodes
        .filter((n) => !chain.goal.has(n))
        .map((n) => [n, chancesOf(chain, n).filter((c) => c.p > 0)]),
    );
    const open = leavers(chain, rows);
    for (const n of rows.keys()) if (!open.includes(n)) out.set(n, { reach: 0, steps: null });
    if (!open.length) return out;
    const at = new Map(open.map((n, i) => [n, i]));
    const free = Matrix.eye(open.length);
    const win = Matrix.zeros(open.length, 1);
    for (const [i, n] of open.entries())
      for (const { to, p } of rows.get(n) ?? []) {
        const j = at.get(to);
        if (j !== undefined) free.set(i, j, free.get(i, j) - p);
        else if (chain.goal.has(to)) win.set(i, 0, win.get(i, 0) + p);
      }
    const reach = solve(free, win);
    const timed = solve(free, reach);
    for (const [i, n] of open.entries()) {
      const b = Math.min(1, Math.max(0, reach.get(i, 0)));
      out.set(n, { reach: b, steps: b > 1e-12 ? timed.get(i, 0) / b : null });
    }
    return out;
  },
};

/**
 * The nodes not ends from which some path reaches an end: the goal, `dropped`, or a node with no
 * exits. Found backwards from the ends.
 */
function leavers(chain: Chain, rows: Map<string, { to: string; p: number }[]>): string[] {
  const into = new Map<string, string[]>();
  for (const [from, cs] of rows)
    for (const { to } of cs) into.set(to, [...(into.get(to) ?? []), from]);
  const ends = [
    ...chain.goal,
    DROPPED,
    ...[...rows].filter(([, cs]) => !cs.length).map(([n]) => n),
  ];
  const seen = new Set(ends);
  const queue = [...ends];
  for (let n = queue.shift(); n !== undefined; n = queue.shift())
    for (const from of into.get(n) ?? [])
      if (!seen.has(from)) {
        seen.add(from);
        queue.push(from);
      }
  return [...rows].filter(([n, cs]) => cs.length && seen.has(n)).map(([n]) => n);
}

/** Thresholds of the skip rules: an arc at a 5% share and 3 people, a ring at 30%. */
export const SKIP_BAR = { arcShare: 0.05, arcPeople: 3, ringShare: 0.3 } as const;

export interface SkipRule {
  id: string;
  name: string;
  /** A skip from a node is an express arc: `skips` of the `left` people who left that node made it. */
  arc(n: { skips: number; left: number }): boolean;
  /** A node is optional: `skipped` people passed it, `arrived` reached it. */
  ring(n: { skipped: number; arrived: number }): boolean;
}

/**
 * The low bound of a share's Wilson score interval: `k` of `n`, at z (1.2816: one-sided 90%).
 * With few people it stays low: 1 of 2 is a 50% share, a 16% low bound.
 */
export function wilsonLow(k: number, n: number, z = 1.2816): number {
  if (n <= 0) return 0;
  const p = k / n;
  const z2 = z * z;
  const mid = p + z2 / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (mid - half) / (1 + z2 / n));
}

/** The share's 90% low bound must meet the bar, so a few people never make an arc or a ring. */
const wilson: SkipRule = {
  id: "wilson",
  name: "Wilson low bound (90%)",
  arc: ({ skips, left }) =>
    skips >= SKIP_BAR.arcPeople && wilsonLow(skips, left) >= SKIP_BAR.arcShare,
  ring: ({ skipped, arrived }) => wilsonLow(skipped, skipped + arrived) >= SKIP_BAR.ringShare,
};

/** The raw share must meet the bar. */
const share: SkipRule = {
  id: "share",
  name: "Raw share",
  arc: ({ skips, left }) =>
    skips >= SKIP_BAR.arcPeople && left > 0 && skips / left >= SKIP_BAR.arcShare,
  ring: ({ skipped, arrived }) =>
    skipped + arrived > 0 && skipped / (skipped + arrived) >= SKIP_BAR.ringShare,
};

export const VALUERS: Readonly<Record<string, NodeValuer>> = { markov };
export const SKIP_RULES: Readonly<Record<string, SkipRule>> = { wilson, share };
export const DEFAULT_VALUER = "markov";
export const DEFAULT_SKIP_RULE = "wilson";

const pick = <T>(registry: Readonly<Record<string, T>>, slot: string, id: string): T => {
  const m = registry[id];
  if (!m) throw new Error(`no ${slot} "${id}"; known: ${Object.keys(registry).join(", ")}`);
  return m;
};
export const valuerOf = (id = DEFAULT_VALUER) => pick(VALUERS, "valuer", id);
export const skipRuleOf = (id = DEFAULT_SKIP_RULE) => pick(SKIP_RULES, "skip rule", id);
