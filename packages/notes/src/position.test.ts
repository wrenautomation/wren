import { describe, expect, it } from "vitest";
import { positionBetween } from "./position.js";

const sorted = (a: string[]) => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

describe("positionBetween", () => {
  it("starts a column, then goes before and after", () => {
    const first = positionBetween(null, null);
    const after = positionBetween(first, null);
    const before = positionBetween(null, first);
    expect(sorted([after, first, before])).toEqual([before, first, after]);
  });

  it("finds a place between neighbours", () => {
    const a = positionBetween(null, null);
    const c = positionBetween(a, null);
    const b = positionBetween(a, c);
    expect(sorted([c, a, b])).toEqual([a, b, c]);
  });

  it("keeps splitting one gap without running out", () => {
    let lo = positionBetween(null, null);
    const hi = positionBetween(lo, null);
    const made: string[] = [lo, hi];
    for (let i = 0; i < 200; i++) {
      lo = positionBetween(lo, hi);
      made.push(lo);
    }
    expect(new Set(made).size).toBe(made.length);
    expect(made.every((p) => p < hi || p === hi)).toBe(true);
  });

  it("keeps appending and prepending in order", () => {
    const order: string[] = [positionBetween(null, null)];
    for (let i = 0; i < 100; i++) order.push(positionBetween(order.at(-1) ?? null, null));
    for (let i = 0; i < 100; i++) order.unshift(positionBetween(null, order[0] ?? null));
    expect(sorted(order)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });

  it("refuses a backwards gap", () => {
    expect(() => positionBetween("b", "a")).toThrow();
  });
});
