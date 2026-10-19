import { describe, expect, it } from "vitest";
import { flow, grown, shape } from "../test/fixtures.js";
import { diffShapes } from "./store.js";

describe("diffShapes", () => {
  it("is empty for the same body", () => {
    expect(diffShapes(shape(), shape())).toEqual({
      nodes: { added: [], removed: [], renamed: [], changed: [] },
      edges: { added: [], removed: [], changed: [] },
      name: null,
    });
  });

  it("lists added nodes and edges by id", () => {
    const next = grown(
      [{ id: "won", kind: "step", name: "Won", action: "other", advance: [] }],
      [flow("standard", "won")],
    );
    const d = diffShapes(shape(), next);
    expect(d.nodes.added).toEqual(["won"]);
    expect(d.edges.added).toEqual(["standard_to_won"]);
  });

  it("lists removed nodes and edges", () => {
    const next = shape();
    next.nodes = next.nodes.filter((n) => n.id !== "standard");
    next.edges = next.edges.filter((e) => e.to !== "standard");
    const d = diffShapes(shape(), next);
    expect(d.nodes.removed).toEqual(["standard"]);
    expect(d.edges.removed).toEqual(["signed_to_standard"]);
  });

  it("tells a rename from another change", () => {
    const next = shape();
    next.nodes = next.nodes.map((n) => (n.id === "booked" ? { ...n, name: "On the calendar" } : n));
    let d = diffShapes(shape(), next);
    expect(d.nodes.renamed).toEqual([{ id: "booked", from: "Booked", to: "On the calendar" }]);
    expect(d.nodes.changed).toEqual([]);

    next.nodes = next.nodes.map((n) =>
      n.id === "proposal" && n.kind === "step" ? { ...n, idleDays: 9 } : n,
    );
    d = diffShapes(shape(), next);
    expect(d.nodes.changed).toEqual(["proposal"]);
  });

  it("lists an edge whose kind changed", () => {
    const next = shape();
    next.edges = next.edges.map((e) =>
      e.id === "booked_to_proposal" ? { ...e, label: "yes" } : e,
    );
    expect(diffShapes(shape(), next).edges.changed).toEqual(["booked_to_proposal"]);
  });

  it("reports a new name", () => {
    expect(diffShapes(shape(), shape({ name: "Other" })).name).toEqual({
      from: "Test shape",
      to: "Other",
    });
  });
});
