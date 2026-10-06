import { describe, expect, it } from "vitest";
import { layout } from "./layout.js";
import {
  facetsOf,
  type GraphEdge,
  type GraphNode,
  labelSize,
  litOf,
  nodeSize,
  percent,
  roundedPath,
  svgOf,
  wireLines,
} from "./model.js";

const nodes: GraphNode[] = [
  { id: "a", kind: "account", label: "Mail account", facets: { Kind: "Account" } },
  {
    id: "b",
    kind: "part",
    label: "Sequences",
    note: "Sends each step",
    number: { value: 412, label: "sent" },
    facets: { Kind: "Part", State: "Built" },
  },
  { id: "c", kind: "part", label: "Replies", facets: { Kind: "Part", State: "Planned" } },
];
const edges: GraphEdge[] = [
  { from: "a", to: "b", label: "mail" },
  {
    from: "b",
    to: "c",
    label: "warm replies",
    count: { value: 31, today: 2 },
    rate: { from: 412, to: 31 },
  },
];

describe("graph model", () => {
  it("reads a wire as its count, rate, rule and wait", () => {
    expect(wireLines(edges[1] as GraphEdge)).toEqual([
      "31 warm replies · 2 today",
      "412 → 31, 7.5%",
    ]);
    expect(
      wireLines({ from: "x", to: "y", label: "leads", when: "they replied", wait: "2 days" }),
    ).toEqual(["leads", "if they replied", "after 2 days"]);
    expect(percent(0, 0)).toBe("");
    expect(percent(1, 3)).toBe("33%");
  });

  it("sizes a node by what it says", () => {
    const small = nodeSize(nodes[2] as GraphNode);
    const big = nodeSize(nodes[1] as GraphNode);
    expect(big.height).toBeGreaterThan(small.height);
    expect(small.width).toBe(232);
  });

  it("keeps what search and filters match, null when nothing narrows", () => {
    expect(litOf(nodes, "", {})).toBeNull();
    expect([...(litOf(nodes, "seq", {}) ?? [])]).toEqual(["b"]);
    expect([...(litOf(nodes, "", { State: "Planned" }) ?? [])]).toEqual(["c"]);
    expect(facetsOf(nodes)).toEqual([
      ["Kind", ["Account", "Part"]],
      ["State", ["Built", "Planned"]],
    ]);
  });

  it("rounds a route's corners", () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
        ],
        4,
      ),
    ).toBe("M0,0 L16,0 Q20,0 20,4 L20,20");
  });

  it("lays out left to right, the same every time, and exports it", async () => {
    const sized = nodes.map((n) => ({ id: n.id, ...nodeSize(n) }));
    const wires = edges.map((e) => ({
      id: `${e.from}>${e.to}`,
      from: e.from,
      to: e.to,
      label: labelSize(wireLines(e)),
    }));
    const one = await layout(sized, wires, "RIGHT");
    const two = await layout(sized, wires, "RIGHT");
    expect(two).toEqual(one);
    expect(one.nodes.a?.x).toBeLessThan(one.nodes.b?.x ?? 0);
    expect(one.nodes.b?.x).toBeLessThan(one.nodes.c?.x ?? 0);
    expect(one.edges["b>c"]?.points.length).toBeGreaterThan(1);
    // A wire's words sit between the cards it joins, not at the corner.
    const words = one.edges["b>c"]?.label;
    expect(words?.x).toBeGreaterThan((one.nodes.b?.x ?? 0) + (one.nodes.b?.width ?? 0) - 1);
    expect(words?.x).toBeLessThan(one.nodes.c?.x ?? 0);
    const down = await layout(sized, wires, "DOWN");
    expect(down.nodes.a?.y).toBeLessThan(down.nodes.c?.y ?? 0);
    const svg = svgOf(one, nodes, edges, {
      paper: "#fff",
      ink: "#111",
      ink2: "#555",
      ink3: "#999",
      hair: "#ddd",
      tile: "#f5f5f5",
      font: "sans-serif",
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("Sequences");
    expect(svg).toContain("412 → 31, 7.5%");
  });
});
