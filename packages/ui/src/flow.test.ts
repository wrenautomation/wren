import { describe, expect, it } from "vitest";
import { edgePath, flowOf, INPUT, OUTPUT, tracksOf } from "./flow.js";

const all = () => true;

/** The portal's run: three checks off the list, then rank, brief, draft. */
const RUN = [
  { id: "verify", after: [] },
  { id: "lookup", after: [] },
  { id: "signals", after: [] },
  { id: "score", after: ["lookup", "signals"] },
  { id: "brief", after: ["score"] },
  { id: "compose", after: ["brief", "verify"] },
];

const colsOf = (g: ReturnType<typeof flowOf>) =>
  Object.fromEntries(g.nodes.map((n) => [n.id, n.col]));

describe("flowOf", () => {
  it("steps with no after run one after another", () => {
    const g = flowOf([{ id: "a" }, { id: "b" }, { id: "c" }], all);
    expect(colsOf(g)).toEqual({ a: 0, b: 1, c: 2 });
    expect(g.edges).toEqual([
      { from: "a", to: "b", span: 1 },
      { from: "b", to: "c", span: 1 },
    ]);
    expect(g.rows).toBe(1);
  });

  it("a step sits one column past the furthest step it builds on", () => {
    const g = flowOf(RUN, all, { input: true, output: true });
    expect(colsOf(g)).toEqual({
      [INPUT]: 0,
      verify: 1,
      lookup: 1,
      signals: 1,
      score: 2,
      brief: 3,
      compose: 4,
      [OUTPUT]: 5,
    });
    expect(g.cols).toBe(6);
    expect(g.rows).toBe(3);
    expect(g.edges).toContainEqual({ from: "verify", to: "compose", span: 3 });
    expect(g.edges).toContainEqual({ from: INPUT, to: "signals", span: 1 });
  });

  it("only what nothing builds on feeds the output", () => {
    const g = flowOf(RUN, all, { input: true, output: true });
    expect(g.edges.filter((e) => e.to === OUTPUT)).toEqual([
      { from: "compose", to: OUTPUT, span: 1 },
    ]);
  });

  it("nodes sharing a column count off in step order", () => {
    const g = flowOf(RUN, all);
    const col0 = g.nodes.filter((n) => n.col === 0);
    expect(col0.map((n) => [n.id, n.index, n.of])).toEqual([
      ["verify", 0, 3],
      ["lookup", 1, 3],
      ["signals", 2, 3],
    ]);
  });

  it("a dropped step's lines join up around it", () => {
    const g = flowOf(RUN, (id) => id !== "score");
    expect(g.nodes.map((n) => n.id)).not.toContain("score");
    expect(g.edges).toContainEqual({ from: "lookup", to: "brief", span: 1 });
    expect(g.edges).toContainEqual({ from: "signals", to: "brief", span: 1 });
    expect(colsOf(g).compose).toBe(2);
  });

  it("dropping the first of a chain hands its place to the input", () => {
    const g = flowOf([{ id: "a" }, { id: "b" }], (id) => id === "b", {
      input: true,
      output: false,
    });
    expect(g.edges).toEqual([{ from: INPUT, to: "b", span: 1 }]);
  });

  it("nothing kept: an empty graph, not a crash", () => {
    expect(flowOf(RUN, () => false, { input: true, output: true })).toEqual({
      nodes: [],
      edges: [],
      cols: 0,
      rows: 0,
    });
  });

  it("after naming a step that doesn't exist is ignored", () => {
    const g = flowOf([{ id: "a", after: ["ghost"] }], all, { input: true, output: false });
    expect(g.edges).toEqual([{ from: INPUT, to: "a", span: 1 }]);
  });

  it("a loop in after ends, rather than hangs", () => {
    const g = flowOf(
      [
        { id: "a", after: ["b"] },
        { id: "b", after: ["a"] },
      ],
      all,
    );
    expect(g.nodes).toHaveLength(2);
  });
});

describe("tracksOf", () => {
  it("splits evenly for every column's count", () => {
    expect(tracksOf(flowOf(RUN, all, { input: true, output: true }))).toBe(3);
    const g = flowOf(
      [
        { id: "a", after: [] },
        { id: "b", after: [] },
        { id: "c", after: ["a", "b"] },
        { id: "d", after: ["a", "b"] },
        { id: "e", after: ["a", "b"] },
      ],
      all,
    );
    expect(tracksOf(g)).toBe(6);
  });
});

describe("edgePath", () => {
  const a = { x: 0, y: 0, w: 100, h: 40 };

  it("level neighbours: one straight line", () => {
    expect(edgePath(a, { x: 140, y: 0, w: 100, h: 40 }, 1, "across")).toBe("M100 20H140");
  });

  it("neighbours at different heights turn halfway across the gap", () => {
    const d = edgePath(a, { x: 140, y: 100, w: 100, h: 40 }, 1, "across");
    expect(d.startsWith("M100 20H110Q120 20 120 30")).toBe(true);
    expect(d.endsWith("H140")).toBe(true);
  });

  it("further across, it runs level then drops into the target from above", () => {
    const d = edgePath(a, { x: 300, y: 100, w: 100, h: 40 }, 3, "across");
    expect(d).toBe("M100 20H340Q350 20 350 30V100");
  });

  it("further across but already level, it goes straight in", () => {
    expect(edgePath(a, { x: 300, y: 0, w: 100, h: 40 }, 3, "across")).toBe("M100 20H300");
  });

  it("down to a node below: straight, or a turn halfway down", () => {
    expect(edgePath(a, { x: 0, y: 80, w: 100, h: 40 }, 1, "down")).toBe("M50 40V80");
    const d = edgePath(a, { x: 200, y: 80, w: 100, h: 40 }, 1, "down");
    expect(d.startsWith("M50 40V50Q50 60 60 60")).toBe(true);
    expect(d.endsWith("V80")).toBe(true);
  });

  it("further down, it rides the left gutter in", () => {
    const d = edgePath({ x: 18, y: 0, w: 100, h: 40 }, { x: 18, y: 200, w: 100, h: 40 }, 3, "down");
    expect(d).toBe("M18 20H16Q6 20 6 30V210Q6 220 16 220H18");
  });

  it("never draws a turn bigger than the room it has", () => {
    const d = edgePath(a, { x: 104, y: 4, w: 100, h: 40 }, 1, "across");
    expect(d).not.toMatch(/NaN|-\d/);
  });
});

describe("flowOf on bad input", () => {
  it("a loop leaves no empty column and no line running backwards", () => {
    const g = flowOf(
      [
        { id: "a", after: ["b"] },
        { id: "b", after: ["a"] },
      ],
      all,
      { input: true, output: true },
    );
    expect(colsOf(g)).toEqual({ [INPUT]: 0, b: 1, a: 2, [OUTPUT]: 3 });
    expect(g.edges.every((e) => e.span >= 1)).toBe(true);
    expect(g.edges.filter((e) => e.to === OUTPUT)).toEqual([{ from: "a", to: OUTPUT, span: 1 }]);
  });

  it("a repeated id keeps the first, so keys stay unique", () => {
    const g = flowOf([{ id: "a" }, { id: "b" }, { id: "a" }], all);
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(g.edges).toEqual([{ from: "a", to: "b", span: 1 }]);
  });

  it("a step can't take an end's id", () => {
    const g = flowOf([{ id: INPUT }, { id: "a", after: [] }], all, { input: true, output: false });
    expect(g.nodes.map((n) => n.id)).toEqual([INPUT, "a"]);
    expect(g.edges).toEqual([{ from: INPUT, to: "a", span: 1 }]);
  });
});

describe("tracksOf past a sane count", () => {
  it("columns of 7, 8 and 9 don't make 504 tracks", () => {
    const wide = (n: number, at: string[]) =>
      Array.from({ length: n }, (_, i) => ({ id: `${at.length}-${i}`, after: at }));
    const c1 = wide(7, []);
    const c2 = wide(
      8,
      c1.map((s) => s.id),
    );
    const c3 = wide(
      9,
      c2.map((s) => s.id),
    );
    expect(tracksOf(flowOf([...c1, ...c2, ...c3], all))).toBe(9);
  });
});
