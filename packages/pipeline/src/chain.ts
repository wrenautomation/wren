/**
 * The trail chain (designs/2026-10-23-skips-tokens-and-map-generation.md): the shape as an
 * absorbing Markov chain, with the moves people made as its counts. Pure: the shape and the moves
 * come in; nothing here reads the database. `chain-methods.ts` holds what reads a chain.
 *
 * A state is a node that holds journeys. Two things end the chain: a goal node (the win) and
 * `dropped`. The case is the person, not the journey: a loop edge is a move like any other, so a
 * chain may hold cycles.
 *
 * Each exit of a node has what people did (`seen`) and a prior (add-k counts): `edge` for each
 * flow or loop edge drawn out of the node, `drop` for leaving the shape. With little data the
 * drawn shape speaks; as moves come in, they outweigh it.
 */
import { DROPPED, holds, isEnd, type ShapeBody } from "./model.js";

/** One counted move, summed over days and versions: a `move_flow` row read back. */
export interface Move {
  /** The node left; null for an opening. */
  from: string | null;
  /** The node reached, or `dropped`. */
  to: string;
  moves: number;
  /** Of `moves`, the ones that passed a node. */
  skips: number;
}

/** Pseudo-moves: `edge` for each drawn edge out of a node, `drop` for leaving the shape. */
interface Prior {
  edge: number;
  drop: number;
}

const PRIOR: Prior = { edge: 1, drop: 1 };

export interface Exit {
  /** A node id, or `dropped`. */
  to: string;
  seen: number;
  /** Of `seen`, the moves that passed a node on the way. */
  skips: number;
  prior: number;
}

export interface Chain {
  /** The nodes that hold journeys, in body order: the states. */
  nodes: readonly string[];
  /** The win. A goal node ends the chain, so it keeps no exits. */
  goal: ReadonlySet<string>;
  /** Each node's exits: the drawn edges, then `dropped`, then the moves no edge draws. */
  exits: ReadonlyMap<string, readonly Exit[]>;
}

/** The win: the plan nodes; with none, the offer nodes; with none, the ends. */
export function goalOf(body: ShapeBody): Set<string> {
  for (const kind of ["plan", "offer"] as const) {
    const ids = body.nodes.filter((n) => n.kind === kind).map((n) => n.id);
    if (ids.length) return new Set(ids);
  }
  return new Set(body.nodes.filter((n) => holds(n) && isEnd(body, n.id)).map((n) => n.id));
}

/**
 * The chain of a shape and the moves made on it. A move from or to a node the shape lacks (an
 * older version's) is left out, and so is an opening: it enters the chain, it is no exit.
 */
export function chainOf(
  body: ShapeBody,
  moves: readonly Move[],
  opts: { prior?: Prior; goal?: ReadonlySet<string> } = {},
): Chain {
  const prior = opts.prior ?? PRIOR;
  const goal = opts.goal ?? goalOf(body);
  const nodes = body.nodes.filter(holds).map((n) => n.id);
  const known = new Set(nodes);
  const exits = new Map<string, Map<string, Exit>>();
  const exitOf = (from: string, to: string): Exit => {
    const at = exits.get(from) ?? new Map<string, Exit>();
    exits.set(from, at);
    const x = at.get(to) ?? { to, seen: 0, skips: 0, prior: 0 };
    at.set(to, x);
    return x;
  };
  for (const id of nodes) {
    if (goal.has(id)) continue;
    exits.set(id, new Map());
    for (const e of body.edges)
      if (e.from === id && known.has(e.to)) exitOf(id, e.to).prior += prior.edge;
    if (prior.drop > 0) exitOf(id, DROPPED).prior += prior.drop;
  }
  for (const m of moves) {
    if (m.from === null || m.from === m.to || !known.has(m.from) || goal.has(m.from)) continue;
    if (m.to !== DROPPED && !known.has(m.to)) continue;
    const x = exitOf(m.from, m.to);
    x.seen += m.moves;
    x.skips += m.skips;
  }
  return { nodes, goal, exits: new Map([...exits].map(([k, v]) => [k, [...v.values()]])) };
}

/** An exit's weight: what people did plus the prior. */
export const weightOf = (x: Exit): number => x.seen + x.prior;

/** Each exit of a node with its chance: its weight over the node's. Empty for a goal node. */
export function chancesOf(chain: Chain, node: string): { to: string; p: number }[] {
  const exits = chain.exits.get(node) ?? [];
  const total = exits.reduce((t, x) => t + weightOf(x), 0);
  return total > 0 ? exits.map((x) => ({ to: x.to, p: weightOf(x) / total })) : [];
}
