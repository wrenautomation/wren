import { describe, expect, it } from "vitest";
import { RUN_GRAPH, RUN_GRAPH_WORST } from "../../fixtures/index.js";
import { indexRun, jit } from "./model.js";
import {
  keepPlaces,
  kids,
  placesOf,
  presentSet,
  rectCollide,
  settle,
  solveWeb,
  type WNode,
  webEdges,
} from "./web.js";

const node = (key: string, x = 0, y = 0): WNode => {
  const big = "cs".includes(key[0] ?? "");
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
const solve = (run = RUN_GRAPH) => {
  const L = indexRun(run);
  const { order, par } = presentSet(L, {
    exp: new Set(L.claims.map((c) => `c${c.i}`)),
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
    expect(placesOf("t-grow", true, [...order, "c99"])).toMatchObject({ exact: false });
    expect(placesOf("t-grow", false, order)).toBeNull();
  });
});

describe("kids", () => {
  it("computes once per run index", () => {
    const L = indexRun(RUN_GRAPH);
    expect(kids(L, "c0")).toBe(kids(L, "c0"));
    expect(kids(indexRun(RUN_GRAPH), "c0")).not.toBe(kids(L, "c0"));
  });
});
