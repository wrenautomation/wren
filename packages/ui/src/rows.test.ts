import { describe, expect, it } from "vitest";
import { walkTo } from "./records.js";
import { drawnOf, type RowsLine, type RowsWait, statsOf, waitWords } from "./rows.js";

const wait = (hours: number, late = false): RowsWait => ({ hours, late });

describe("waitWords", () => {
  it("says minutes under an hour, hours under a day, then days", () => {
    expect(waitWords(0.25)).toBe("15 minutes");
    expect(waitWords(1 / 60)).toBe("1 minute");
    expect(waitWords(1)).toBe("1 hour");
    expect(waitWords(6)).toBe("6 hours");
    expect(waitWords(24)).toBe("1 day");
    expect(waitWords(49)).toBe("2 days");
  });
});

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
