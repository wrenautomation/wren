import { describe, expect, it } from "vitest";
import { RUN_GRAPH, RUN_GRAPH_WORST } from "../../fixtures/index.js";
import { indexRun, jit, type RunGraphData } from "./model.js";
import {
  keepPlaces,
  kids,
  linked,
  pack,
  placesOf,
  presentSet,
  rectCollide,
  settle,
  solveWeb,
  type WNode,
  webEdges,
} from "./web.js";

const node = (key: string, x = 0, y = 0): WNode => {
  const big = "qs".includes(key[0] ?? "");
  return {
    key,
    w: big ? 170 : 130,
    h: big ? 60 : 40,
    x,
    y,
    ax: null,
    ay: null,
    hold: false,
    free: false,
  };
};
// worst overlap left between any two boxes, past the gap
const overlap = (ns: WNode[], pad: number) => {
  let worst = 0;
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i] as WNode;
      const b = ns[j] as WNode;
      const ox = (a.w + b.w) / 2 + pad - Math.abs(b.x - a.x);
      const oy = (a.h + b.h) / 2 + pad - Math.abs(b.y - a.y);
      if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy));
    }
  return worst;
};
// pairs from different groups closer than the gap
const touching = (parts: WNode[][], pad: number) =>
  parts.flatMap((g, i) =>
    parts
      .slice(i + 1)
      .flatMap((h) =>
        g.flatMap((a) =>
          h.filter(
            (b) =>
              Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad &&
              Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad,
          ),
        ),
      ),
  ).length;
const solve = (run: RunGraphData = RUN_GRAPH) => {
  const L = indexRun(run);
  const { order, par } = presentSet(L, {
    exp: new Set(L.run.searches.map((q) => `q${q.i}`)),
    lift: new Set(),
    more: new Map(),
    wide: true,
  });
  const N = new Map(order.map((k) => [k, node(k)]));
  solveWeb({
    L,
    N,
    order,
    par,
    E: webEdges(L, order, par),
    fresh: new Set(N.values()),
    anim: false,
    fk: null,
    wide: true,
    shelfAt: new Map(),
  });
  return { order, N };
};

describe("rectCollide", () => {
  it("parts a pile and then reports none left", () => {
    const ns = Array.from({ length: 120 }, (_, i) =>
      node(i % 3 ? `f${i}` : `s${i}`, jit(i) * 600, jit(i + 7) * 600),
    );
    settle(ns, true);
    expect(overlap(ns, 16)).toBeLessThan(1);
    expect(rectCollide(ns, 16)()).toBe(0);
  });
});

describe("solveWeb", () => {
  it("gives every node its own place, with no overlap", () => {
    for (const run of [RUN_GRAPH, RUN_GRAPH_WORST]) {
      const { N } = solve(run);
      const ns = [...N.values()];
      expect(new Set(ns.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`)).size).toBe(ns.length);
      expect(overlap(ns, 0)).toBe(0);
    }
  });
  it("lays the same run out the same way", () => {
    const a = solve().N;
    const b = solve().N;
    for (const [k, n] of a) expect([b.get(k)?.x, b.get(k)?.y]).toEqual([n.x, n.y]);
  });
});

describe("several runs", () => {
  const merged = { ...RUN_GRAPH_WORST, runs: [{ rid: "a", t: "a" }] };
  it("groups by edges, the group with the first search first, searchless last", () => {
    const g = linked(
      ["q0", "q1", "s1", "s2", "s3"],
      [
        { id: "1", a: "q1", b: "s1", kind: "hub", w: 1, tree: false },
        { id: "2", a: "q0", b: "s2", kind: "hub", w: 1, tree: false },
      ],
    );
    expect(g).toEqual([["q0", "s2"], ["q1", "s1"], ["s3"]]);
  });
  it("packs groups apart, in order, inside the room's width", () => {
    const parts = Array.from({ length: 9 }, (_, j) =>
      Array.from({ length: 2 + (j % 4) * 3 }, (_, i) =>
        node(i ? `s${j}-${i}` : `q${j}`, jit(i + j * 31) * 160, jit(i + j * 17) * 160),
      ),
    );
    for (const g of parts) settle(g, true);
    pack(parts, true);
    expect(touching(parts, 16)).toBe(0);
    const b = (g: WNode[]) => Math.min(...g.map((n) => n.y - n.h / 2));
    expect(b(parts[0] as WNode[])).toBeLessThanOrEqual(b(parts[8] as WNode[]));
    const xs = parts.flat().flatMap((n) => [n.x - n.w / 2, n.x + n.w / 2]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(1600);
  });
  it("lays a merged graph out with no overlap, the same way each time", () => {
    const a = solve(merged).N;
    const b = solve(merged).N;
    expect(overlap([...a.values()], 0)).toBe(0);
    for (const [k, n] of a) expect([b.get(k)?.x, b.get(k)?.y]).toEqual([n.x, n.y]);
  });
});

describe("places", () => {
  it("keeps a copy: moving the nodes after does not move what was kept", () => {
    const { order, N } = solve();
    keepPlaces("t-copy", true, order, N);
    const first = N.get(order[0] as string) as WNode;
    const was = [first.x, first.y];
    N.clear();
    first.x += 500;
    expect(placesOf("t-copy", true, order)).toMatchObject({ exact: true });
    expect(placesOf("t-copy", true, order)?.at.get(first.key)).toEqual(was);
  });
  it("gives the newest places as anchors when the nodes differ", () => {
    const { order, N } = solve();
    keepPlaces("t-grow", true, order, N);
    expect(placesOf("t-grow", true, [...order, "q99"])).toMatchObject({ exact: false });
    expect(placesOf("t-grow", false, order)).toBeNull();
  });
});

describe("hubs", () => {
  it("puts every search and every source with a finding on the map, linked to the searches that found it", () => {
    const L = indexRun(RUN_GRAPH);
    const { order, par } = presentSet(L, {
      exp: new Set(),
      lift: new Set(),
      more: new Map(),
      wide: true,
    });
    for (const q of RUN_GRAPH.searches) expect(order).toContain(`q${q.i}`);
    const E = webEdges(L, order, par);
    for (const s of RUN_GRAPH.sources.filter((x) => x.kept)) {
      const qs = RUN_GRAPH.searches.filter((q) => q.ss.includes(s.id)).map((q) => `q${q.i}`);
      expect(
        E.filter((e) => e.b === `s${s.id}` && e.kind === "hub")
          .map((e) => e.a)
          .sort(),
      ).toEqual(qs.sort());
    }
  });
});

describe("kids", () => {
  it("computes once per run index", () => {
    const L = indexRun(RUN_GRAPH);
    expect(kids(L, "q0")).toBe(kids(L, "q0"));
    expect(kids(indexRun(RUN_GRAPH), "q0")).not.toBe(kids(L, "q0"));
  });
});
