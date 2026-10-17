import { describe, expect, it } from "vitest";
import { LEAD_NEEDS, LEADS } from "./fixtures/records.js";
import { tiersOf, waitsOn } from "./records.js";

const rows = LEADS;
const needs = LEAD_NEEDS;
/** Ids of the leads that wait on the viewer, in list order. */
const waiting = rows.filter((r) => r.state === "waiting").map((r) => r.id);
const rest = rows.filter((r) => r.state !== "waiting").map((r) => r.id);

describe("needs tiers", () => {
  it("a row waits when every named field holds one of its states", () => {
    expect(waitsOn(needs, { id: 1, state: "waiting" })).toBe(true);
    expect(waitsOn(needs, { id: 1, state: "closed" })).toBe(false);
    expect(waitsOn({ state: ["waiting"], side: ["risk"] }, { id: 1, state: "waiting" })).toBe(
      false,
    );
  });

  it("puts what waits first, each tier in its own order, and says where For info starts", () => {
    const t = tiersOf(rows, needs, false);
    expect(t.rows.map((r) => r.id)).toEqual([...waiting, ...rest]);
    expect(t.split).toBe(waiting.length);
  });

  it("keeps the order when grouped or sorted by hand, or when one tier holds every row", () => {
    expect(tiersOf(rows, needs, true)).toEqual({ rows, split: -1 });
    expect(tiersOf(rows, undefined, false)).toEqual({ rows, split: -1 });
    const open = rows.filter((r) => r.state === "waiting");
    expect(tiersOf(open, needs, false)).toEqual({ rows: open, split: -1 });
  });
});
