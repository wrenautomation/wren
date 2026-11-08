import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { walkTo } from "./records.js";
import {
  drawnOf,
  type RowsLine,
  type RowsPick,
  type RowsWait,
  statsOf,
  useRowsPick,
  waitFrom,
} from "./rows.js";

const wait = (hours: number, late = false): RowsWait => ({ hours, late });

describe("statsOf", () => {
  it("counts every row, the late ones, and the longest wait", () => {
    const s = statsOf([wait(5), wait(52, true), null, wait(20)]);
    expect(s.n).toBe(4);
    expect(s.late).toBe(1);
    expect(s.oldest).toEqual(wait(52, true));
  });
  it("an empty set has no oldest", () => {
    expect(statsOf([])).toEqual({ n: 0, late: 0, oldest: null });
    expect(statsOf([null, null])).toEqual({ n: 2, late: 0, oldest: null });
  });
});

describe("waitFrom", () => {
  const now = new Date("2026-10-17T15:00:00Z");
  const old = "2026-10-15T15:00:00Z"; // 48 hours before now
  it("an open row past its promise is late", () => {
    expect(waitFrom(old, "24h", true, now)).toEqual({ hours: 48, late: true });
  });
  it("an answered row past its promise shows its age and is not late", () => {
    const w = waitFrom(old, "24h", false, now);
    expect(w).toEqual({ hours: 48, late: false });
    // The foot's Late count follows.
    expect(statsOf([w, waitFrom(old, "24h", true, now)]).late).toBe(1);
  });
  it("a row with no start date does not wait", () => {
    expect(waitFrom("", "24h", true, now)).toBeNull();
  });
});

describe("drawnOf", () => {
  type P = { id: string; hours: number; late: boolean };
  const row = (p: P, index: number): RowsLine<P> => ({ kind: "row", key: p.id, index, row: p });
  const A: P[] = [
    { id: "a1", hours: 5, late: false },
    { id: "a2", hours: 50, late: true },
  ];
  const B: P[] = [{ id: "b1", hours: 1, late: false }];
  const lines: RowsLine<P>[] = [
    { kind: "group", key: "A", label: "A" },
    row(A[0] as P, 0),
    { kind: "box", key: "box:a1", node: "words" },
    row(A[1] as P, 1),
    { kind: "group", key: "B", label: "B" },
    row(B[0] as P, 2),
  ];
  const waits = (r: P) => wait(r.hours, r.late);
  const keys = (out: ReturnType<typeof drawnOf<P>>) => out.map((l) => l.key);

  it("gives each group its count and its oldest wait", () => {
    const out = drawnOf(lines, undefined, waits);
    const heads = out.filter((l) => l.kind === "group");
    expect(heads.map((h) => h.stats?.n)).toEqual([2, 1]);
    expect(heads[0]?.stats?.oldest).toEqual(wait(50, true));
    expect(heads[0]?.stats?.late).toBe(1);
    expect(heads[1]?.stats?.oldest).toEqual(wait(1));
  });

  it("a shut group keeps its head and its numbers, and loses its rows and their boxes", () => {
    const out = drawnOf(lines, new Set(["A"]), waits);
    expect(keys(out)).toEqual(["A", "B", "b1"]);
    expect(out[0]).toMatchObject({ kind: "group", stats: { n: 2, late: 1 } });
  });

  it("with no wait, a group still counts its rows", () => {
    const out = drawnOf(lines, undefined, undefined);
    expect(out.find((l) => l.key === "A")).toMatchObject({
      stats: { n: 2, late: 0, oldest: null },
    });
  });

  it("a tier ends a group's fold", () => {
    const tiered: RowsLine<P>[] = [
      { kind: "group", key: "A", label: "A" },
      row(A[0] as P, 0),
      { kind: "tier", key: "t", head: "For info" },
      row(B[0] as P, 1),
    ];
    expect(keys(drawnOf(tiered, new Set(["A"]), waits))).toEqual(["A", "t", "b1"]);
  });
});

describe("walkTo", () => {
  const none = () => false;
  it("steps one row, and stays at either end", () => {
    expect(walkTo(1, 1, 4, none)).toBe(2);
    expect(walkTo(1, -1, 4, none)).toBe(0);
    expect(walkTo(3, 1, 4, none)).toBe(3);
    expect(walkTo(0, -1, 4, none)).toBe(0);
  });
  it("starts at the first row from no row", () => {
    expect(walkTo(-1, 1, 4, none)).toBe(0);
    expect(walkTo(-1, -1, 4, none)).toBe(0);
  });
  it("steps over the rows a shut group hides", () => {
    const hidden = (i: number) => i === 1 || i === 2;
    expect(walkTo(0, 1, 5, hidden)).toBe(3);
    expect(walkTo(3, -1, 5, hidden)).toBe(0);
  });
  it("stays when only hidden rows lie that way, and gives -1 when all are hidden", () => {
    const hidden = (i: number) => i > 1;
    expect(walkTo(1, 1, 4, hidden)).toBe(1);
    expect(walkTo(0, 1, 4, () => true)).toBe(-1);
  });
  it("leaves a row a fold now hides for the first row in view", () => {
    expect(walkTo(2, 1, 5, (i) => i >= 2 && i <= 3)).toBe(4);
    expect(walkTo(2, -1, 5, (i) => i >= 2)).toBe(1);
  });
});

/** A pick over four rows, read once through a server render; `got` holds each set it hands back. */
function pickOf(picked: string[], keys = ["1", "2", "3", "4"]) {
  const got: string[][] = [];
  let pick: RowsPick | null = null;
  function Probe() {
    pick = useRowsPick(keys, new Set(picked), (s) => got.push([...s].sort()));
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!pick) throw new Error("no pick");
  return { pick: pick as RowsPick, got };
}

describe("useRowsPick", () => {
  it("counts the rows shown that are picked", () => {
    const { pick } = pickOf(["2"]);
    expect([pick.all, pick.some, pick.picked("2"), pick.picked("1"), pick.count]).toEqual([
      false,
      true,
      true,
      false,
      1,
    ]);
    expect(pickOf(["1", "2", "3", "4"]).pick.all).toBe(true);
    expect(pickOf([], []).pick.all).toBe(false);
  });
  it("a shift-click takes every row from the last one pressed", () => {
    const { pick, got } = pickOf([]);
    pick.toggle("1");
    pick.toggle("3", true);
    expect(got).toEqual([["1"], ["1", "2", "3"]]);
  });
  it("a shift-click with no row pressed yet picks one", () => {
    const { pick, got } = pickOf([]);
    pick.toggle("3", true);
    expect(got).toEqual([["3"]]);
  });
  it("all lets go of only the rows shown", () => {
    const { pick, got } = pickOf(["1", "2", "9"], ["1", "2"]);
    pick.toggleAll();
    expect(got).toEqual([["9"]]);
  });
});
