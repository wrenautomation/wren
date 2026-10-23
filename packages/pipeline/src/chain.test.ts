import { describe, expect, it } from "vitest";
import { flow, loop } from "../test/fixtures.js";
import { chainOf, chancesOf, goalOf, type Move } from "./chain.js";
import {
  DEFAULT_SKIP_RULE,
  DEFAULT_VALUER,
  SKIP_RULES,
  skipRuleOf,
  valuerOf,
  wilsonLow,
} from "./chain-methods.js";
import type { ShapeBody, ShapeEdge, ShapeNode } from "./model.js";

const step = (id: string): ShapeNode => ({
  id,
  kind: "step",
  name: id,
  action: "reply",
  advance: [],
});
const plan = (id: string): ShapeNode => ({
  id,
  kind: "plan",
  name: id,
  terms: "standard",
  advance: [],
});
const offer = (id: string): ShapeNode => ({ id, kind: "offer", name: id, offer: "o", advance: [] });
const body = (nodes: ShapeNode[], edges: ShapeEdge[]): ShapeBody => ({
  name: "Chain test",
  nodes: [
    { id: "src", kind: "source", name: "Source", via: "organic", channel: "email" },
    ...nodes,
  ],
  edges: [flow("src", nodes[0]?.id ?? ""), ...edges],
});
const move = (from: string | null, to: string, moves: number, skips = 0): Move => ({
  from,
  to,
  moves,
  skips,
});
const NONE = { prior: { edge: 0, drop: 0 } };
const values = (b: ShapeBody, moves: Move[], opts = NONE) =>
  Object.fromEntries(valuerOf().values(chainOf(b, moves, opts)));

/** a → b → p, the plan the goal. */
const line = body([step("a"), step("b"), plan("p")], [flow("a", "b"), flow("b", "p")]);

describe("the trail chain", () => {
  it("counts each node's exits from the moves; an opening and a goal's exits are no exits", () => {
    const c = chainOf(line, [
      move(null, "a", 10),
      move("a", "b", 8),
      move("a", "dropped", 2),
      move("p", "a", 1),
      move("gone", "a", 4),
      move("a", "gone", 4),
    ]);
    expect(c.nodes).toEqual(["a", "b", "p"]);
    expect([...c.goal]).toEqual(["p"]);
    expect(c.exits.get("p")).toBeUndefined();
    expect(c.exits.get("a")).toEqual([
      { to: "b", seen: 8, skips: 0, prior: 1 },
      { to: "dropped", seen: 2, skips: 0, prior: 1 },
    ]);
    expect(chancesOf(c, "a")).toEqual([
      { to: "b", p: 9 / 12 },
      { to: "dropped", p: 3 / 12 },
    ]);
  });

  it("takes the plans as the goal, else the offers, else the ends", () => {
    expect(goalOf(line)).toEqual(new Set(["p"]));
    expect(goalOf(body([step("a"), offer("o")], [flow("a", "o")]))).toEqual(new Set(["o"]));
    expect(goalOf(body([step("a"), step("b")], [flow("a", "b")]))).toEqual(new Set(["b"]));
  });
});

describe("the Markov valuer", () => {
  it("multiplies the chances down a line; steps count the moves to the goal", () => {
    const v = values(line, [
      move("a", "b", 8),
      move("a", "dropped", 2),
      move("b", "p", 5),
      move("b", "dropped", 5),
    ]);
    expect(v.p).toEqual({ reach: 1, steps: 0 });
    expect(v.b?.reach).toBeCloseTo(0.5);
    expect(v.b?.steps).toBeCloseTo(1);
    expect(v.a?.reach).toBeCloseTo(0.4);
    expect(v.a?.steps).toBeCloseTo(2);
  });

  it("counts a skip as one move: wins over it come in fewer steps", () => {
    // a: 2 of 10 skip b to the plan, 6 go to b, 2 drop. b: half win.
    const v = values(line, [
      move("a", "p", 2, 2),
      move("a", "b", 6),
      move("a", "dropped", 2),
      move("b", "p", 3),
      move("b", "dropped", 3),
    ]);
    expect(v.a?.reach).toBeCloseTo(0.2 + 0.6 * 0.5);
    // 0.2 win in 1 move, 0.3 in 2: (0.2 + 0.6) / 0.5.
    expect(v.a?.steps).toBeCloseTo(1.6);
  });

  it("solves a loop: the person goes round until they win or drop", () => {
    const b = body(
      [step("a"), step("b"), plan("p")],
      [flow("a", "b"), flow("b", "p"), loop("b", "a")],
    );
    const v = values(b, [
      move("a", "b", 4),
      move("b", "p", 2),
      move("b", "a", 1),
      move("b", "dropped", 1),
    ]);
    // reach(b) = 0.5 + 0.25 reach(a), reach(a) = reach(b).
    expect(v.b?.reach).toBeCloseTo(2 / 3);
    expect(v.a?.reach).toBeCloseTo(2 / 3);
  });

  it("with no moves, the drawn shape speaks through the prior", () => {
    const v = values(line, [], { prior: { edge: 1, drop: 1 } });
    expect(v.b?.reach).toBeCloseTo(0.5);
    expect(v.a?.reach).toBeCloseTo(0.25);
  });

  it("gives a node no path leaves reach 0 and no steps, and does not fail", () => {
    const b = body(
      [step("a"), step("b"), step("c"), plan("p")],
      [flow("a", "b"), loop("b", "a"), flow("c", "p")],
    );
    const v = values(b, [move("a", "b", 3), move("b", "a", 3)], { prior: { edge: 1, drop: 0 } });
    expect(v.a).toEqual({ reach: 0, steps: null });
    expect(v.b).toEqual({ reach: 0, steps: null });
    expect(v.c?.reach).toBeCloseTo(1);
  });
});

describe("the skip rules", () => {
  it("keeps a share's low bound under the share, lower with fewer people", () => {
    expect(wilsonLow(0, 0)).toBe(0);
    expect(wilsonLow(1, 2)).toBeLessThan(0.2);
    expect(wilsonLow(10, 20)).toBeGreaterThan(wilsonLow(1, 2));
    expect(wilsonLow(10, 20)).toBeLessThan(0.5);
  });

  it("Wilson waits for people where the raw share does not", () => {
    const wilson = skipRuleOf("wilson");
    const share = skipRuleOf("share");
    // 3 of 30 is a 10% share; its low bound is under 5%.
    expect(share.arc({ skips: 3, left: 30 })).toBe(true);
    expect(wilson.arc({ skips: 3, left: 30 })).toBe(false);
    expect(wilson.arc({ skips: 3, left: 10 })).toBe(true);
    // Never under 3 people, whatever the share.
    expect(share.arc({ skips: 2, left: 2 })).toBe(false);
    // 1 of 2 passed by: 50%, but one person.
    expect(share.ring({ skipped: 1, arrived: 1 })).toBe(true);
    expect(wilson.ring({ skipped: 1, arrived: 1 })).toBe(false);
    expect(wilson.ring({ skipped: 30, arrived: 30 })).toBe(true);
    expect(share.ring({ skipped: 0, arrived: 0 })).toBe(false);
  });

  it("finds each method by id and refuses an unknown one", () => {
    expect(valuerOf().id).toBe(DEFAULT_VALUER);
    expect(skipRuleOf().id).toBe(DEFAULT_SKIP_RULE);
    expect(Object.keys(SKIP_RULES)).toEqual(["wilson", "share"]);
    expect(() => valuerOf("nope")).toThrow(/no valuer "nope"; known: markov/);
  });
});
