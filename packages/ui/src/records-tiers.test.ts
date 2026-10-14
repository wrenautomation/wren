import { describe, expect, it } from "vitest";
import { tiersOf, waitsOn } from "./records.js";

const rows = [
  { id: 1, status: "closed" },
  { id: 2, status: "open" },
  { id: 3, status: "closed" },
  { id: 4, status: "open" },
];
const needs = { status: ["open"] };

describe("needs tiers", () => {
  it("a row waits when every named field holds one of its states", () => {
    expect(waitsOn(needs, { id: 1, status: "open" })).toBe(true);
    expect(waitsOn(needs, { id: 1, status: "closed" })).toBe(false);
    expect(waitsOn({ status: ["open"], side: ["risk"] }, { id: 1, status: "open" })).toBe(false);
  });

  it("puts what waits first, each tier in its own order, and says where For info starts", () => {
    const t = tiersOf(rows, needs, false);
    expect(t.rows.map((r) => r.id)).toEqual([2, 4, 1, 3]);
    expect(t.split).toBe(2);
  });

  it("keeps the order when grouped or sorted by hand, or when one tier holds every row", () => {
    expect(tiersOf(rows, needs, true)).toEqual({ rows, split: -1 });
    expect(tiersOf(rows, undefined, false)).toEqual({ rows, split: -1 });
    const open = rows.filter((r) => r.status === "open");
    expect(tiersOf(open, needs, false)).toEqual({ rows: open, split: -1 });
  });
});
