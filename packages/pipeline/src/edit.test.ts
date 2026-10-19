import { describe, expect, it } from "vitest";
import { flow, shape } from "../test/fixtures.js";
import { edgeOf, withEdge, withNode, withoutEdge, withoutNode } from "./edit.js";
import type { ShapeNode } from "./model.js";
import { Refused } from "./store.js";

const won: ShapeNode = { id: "won", kind: "step", name: "Won", action: "other", advance: [] };

describe("withNode", () => {
  it("adds a node and its edges, and leaves the old body alone", () => {
    const before = shape();
    const next = withNode(before, won, [flow("standard", "won")]);
    expect(next.nodes.map((n) => n.id)).toContain("won");
    expect(next.edges.map((e) => e.id)).toContain("standard_to_won");
    expect(before.nodes.some((n) => n.id === "won")).toBe(false);
  });

  it("refuses an id in use", () => {
    expect(() => withNode(shape(), { ...won, id: "booked" })).toThrow(Refused);
  });
});

describe("edges", () => {
  it("makes a flow edge with the default id, and a loop edge with its own", () => {
    expect(edgeOf("a", "b")).toEqual({ id: "a_to_b", from: "a", to: "b", kind: "flow" });
    expect(edgeOf("a", "b", { loop: true, label: "again" })).toEqual({
      id: "a_loop_b",
      from: "a",
      to: "b",
      kind: "loop",
      label: "again",
    });
    expect(edgeOf("a", "b", { id: "x" }).id).toBe("x");
  });

  it("connects two nodes", () => {
    const next = withEdge(shape(), edgeOf("proposal", "booked", { loop: true }));
    expect(next.edges.at(-1)).toMatchObject({ id: "proposal_loop_booked", kind: "loop" });
  });

  it("refuses an edge to a node the shape lacks, and an id in use", () => {
    expect(() => withEdge(shape(), edgeOf("booked", "nowhere"))).toThrow(/no node nowhere/);
    expect(() => withEdge(shape(), edgeOf("engaged", "booked"))).toThrow(/already has an edge/);
  });
});

describe("remove", () => {
  it("drops a node with every edge that touches it", () => {
    const next = withoutNode(shape(), "booked");
    expect(next.nodes.some((n) => n.id === "booked")).toBe(false);
    expect(next.edges.some((e) => e.from === "booked" || e.to === "booked")).toBe(false);
    expect(next.edges.length).toBe(shape().edges.length - 2);
  });

  it("drops one edge", () => {
    const next = withoutEdge(shape(), "engaged_to_booked");
    expect(next.edges.some((e) => e.id === "engaged_to_booked")).toBe(false);
    expect(next.nodes).toEqual(shape().nodes);
  });

  it("refuses what is not there", () => {
    expect(() => withoutNode(shape(), "gone")).toThrow(/no node gone/);
    expect(() => withoutEdge(shape(), "gone")).toThrow(/no edge gone/);
  });
});
