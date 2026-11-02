/**
 * Branches of one journey: where a person stands on each track of a split (designs/2026-11-02-
 * campaigns.md, phase 4 rules). Pure: the move step reads the row, asks here, writes the answer.
 */
import { type Gate, gateOf, type ShapeBody, type ShapeEdge } from "./model.js";

/** One place a journey stands. `pin`: a branch waiting at a split leaves only by this edge. */
export interface Branch {
  key: string;
  node: string;
  pin?: string;
}

/** The key of a journey's first branch; its crossings carry no `branch`. */
export const MAIN = "main";

/** The branches a row holds; none stored is one branch at `node`. */
export const branchesOf = (stored: readonly Branch[] | null | undefined, node: string): Branch[] =>
  stored?.length ? stored.map((b) => ({ ...b })) : [{ key: MAIN, node }];

/** What to store: none when one plain branch is left, so a journey with no logic stays as it was. */
export const storedOf = (branches: readonly Branch[]): Branch[] =>
  branches.length === 1 && !branches[0]?.pin ? [] : [...branches];

/** How many tracks in a join needs: `all`, `any` or `<n> of <m>`. */
export function needOf(g: Gate, ins: number): number {
  if (g.rule === "any") return 1;
  const m = /^([1-9][0-9]*) of [1-9][0-9]*$/.exec(g.rule ?? "");
  return m ? Number(m[1]) : ins;
}

export interface BranchMove {
  /** The branch that moved, and where it stood. */
  branch: string;
  from: string;
  edges: string[];
  /** The nodes it passed, not gates, not the last. */
  skipped: string[];
  branches: Branch[];
  /** Branches a join closed into the mover. */
  closed: string[];
  /** Race arms a cause took: each stops the person's acts in the race's campaign. */
  won: Array<{ gate: string; arm: string }>;
}

/** Only the clock takes a race's wait arm, and only for its branch at the station before it. */
export interface Clock {
  gate: string;
  branch: string;
}

const flowOut = (body: ShapeBody, id: string) =>
  body.edges.filter((e) => e.kind === "flow" && e.from === id);
const flowIn = (body: ShapeBody, id: string) =>
  body.edges.filter((e) => e.kind === "flow" && e.to === id);

/** Can `b` reach `to`? Its pin fixes its first edge. */
function reaches(body: ShapeBody, b: Branch, to: string): boolean {
  const seen = new Set([b.node]);
  let level = b.pin ? body.edges.filter((e) => e.id === b.pin).map((e) => e.to) : [b.node];
  for (const id of level) seen.add(id);
  while (level.length) {
    if (level.includes(to)) return true;
    const next: string[] = [];
    for (const id of level)
      for (const e of flowOut(body, id)) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        next.push(e.to);
      }
    level = next;
  }
  return false;
}

/**
 * The shortest legal path for one branch, as `pathOf` finds one, with the gates' rules: a race
 * takes a cond arm by a cause or its wait arm by its clock; a join passes when its rule is met.
 */
function pathFor(
  body: ShapeBody,
  b: Branch,
  others: readonly Branch[],
  to: string,
  clock: Clock | undefined,
): ShapeEdge[] | null {
  const legal = (e: ShapeEdge): boolean => {
    const g = gateOf(body, e.from);
    if (g?.kind === "race") return clock ? clock.gate === g.id && !!e.wait : !e.wait;
    // Branches wait at a split once it is crossed: never twice.
    if (g?.kind === "split" && b.node !== g.id && others.some((o) => o.node === g.id)) return false;
    const j = gateOf(body, e.to);
    if (j?.kind === "join") {
      const ins = flowIn(body, j.id);
      // In: a branch that stands at the station before; one pulled through it is not.
      const held = ins.filter((i) => [b, ...others].some((o) => !o.pin && o.node === i.from));
      return held.length >= needOf(j, ins.length);
    }
    return true;
  };
  const via = new Map<string, ShapeEdge>();
  const seen = new Set([b.node]);
  let level = [b.node];
  while (level.length && !seen.has(to)) {
    const step: string[] = [];
    for (const at of level) {
      for (const e of flowOut(body, at)) {
        if (seen.has(e.to) || (at === b.node && b.pin && e.id !== b.pin) || !legal(e)) continue;
        seen.add(e.to);
        via.set(e.to, e);
        step.push(e.to);
      }
    }
    level = step;
  }
  if (!seen.has(to) || to === b.node) return null;
  const path: ShapeEdge[] = [];
  for (let at = to; at !== b.node; ) {
    const e = via.get(at);
    if (!e) return null;
    path.unshift(e);
    at = e.from;
  }
  // A clock fired after its branch moved on does nothing.
  if (clock && path[0]?.to !== clock.gate) return null;
  return path;
}

/**
 * Move the nearest branch with a legal path to `to`. Ties go to `front`, then key order. Null when
 * none has one: the caller opens a new branch or refuses.
 */
export function moveBranches(
  body: ShapeBody,
  branches: readonly Branch[],
  to: string,
  opts: { front?: string; clock?: Clock } = {},
): BranchMove | null {
  if (gateOf(body, to)) return null;
  const order = [...branches].sort(
    (a, b) =>
      Number(b.key === opts.front) - Number(a.key === opts.front) || a.key.localeCompare(b.key),
  );
  let best: { b: Branch; path: ShapeEdge[] } | null = null;
  for (const b of order) {
    if (opts.clock && b.key !== opts.clock.branch) continue;
    const path = pathFor(
      body,
      b,
      branches.filter((o) => o !== b),
      to,
      opts.clock,
    );
    if (path && (!best || path.length < best.path.length)) best = { b, path };
  }
  if (!best) return null;
  const { b, path } = best;
  // Splits crossed: the tracks not taken wait there, each its own branch.
  let next: Branch[] = branches.filter((o) => o !== b);
  for (const e of path) {
    const g = gateOf(body, e.from);
    if (g?.kind !== "split" || g.id === b.node) continue;
    for (const o of flowOut(body, g.id))
      if (o.id !== e.id) next.push({ key: o.id, node: g.id, pin: o.id });
  }
  // Joins crossed: every other branch that can still reach one closes into the mover.
  const closed: string[] = [];
  for (const e of path) {
    const g = gateOf(body, e.to);
    if (g?.kind !== "join") continue;
    for (const o of next) if (reaches(body, o, g.id)) closed.push(o.key);
    next = next.filter((o) => !closed.includes(o.key));
  }
  const won = path.flatMap((e) =>
    gateOf(body, e.from)?.kind === "race" && !e.wait ? [{ gate: e.from, arm: e.id }] : [],
  );
  return {
    branch: b.key,
    from: b.node,
    edges: path.map((e) => e.id),
    skipped: path
      .slice(0, -1)
      .map((e) => e.to)
      .filter((id) => !gateOf(body, id)),
    branches: [...next, { key: b.key, node: to }],
    closed,
    won,
  };
}

/**
 * A move by hand with no legal path: the front jumps to `to`, and branches that could reach `to`
 * close into it, so a hand move past a join leaves nothing behind it.
 */
export function forceBranches(
  body: ShapeBody,
  branches: readonly Branch[],
  to: string,
  front: string,
): { branches: Branch[]; closed: string[] } {
  const mover = branches.find((b) => b.key === front) ?? branches[0];
  const closed = branches.filter((b) => b !== mover && reaches(body, b, to)).map((b) => b.key);
  return {
    branches: [
      ...branches.filter((b) => b !== mover && !closed.includes(b.key)),
      { key: mover?.key ?? MAIN, node: to },
    ],
    closed,
  };
}

/** The branch at the row's `node`: the one that moved last. */
export const frontOf = (branches: readonly Branch[], node: string): Branch | undefined =>
  branches.find((b) => b.node === node && !b.pin) ?? branches[0];

/** The races right after `node`: arriving there sets their clocks. */
export const racesAfter = (body: ShapeBody, node: string): Gate[] =>
  flowOut(body, node).flatMap((e) => {
    const g = gateOf(body, e.to);
    return g?.kind === "race" ? [g] : [];
  });

/** The campaign a node is in; null is the default. */
export const campaignAt = (body: ShapeBody, node: string): string | null =>
  body.campaigns?.[node] ?? null;

/**
 * May a cause no branch can reach open a new branch at `to`? Only in a campaign that holds no
 * branch yet (the caller checks a source takes the cause).
 */
export const opensBranch = (body: ShapeBody, branches: readonly Branch[], to: string): boolean => {
  const campaign = campaignAt(body, to);
  return campaign !== null && !branches.some((b) => campaignAt(body, b.node) === campaign);
};
