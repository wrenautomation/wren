import { describe, expect, it } from "vitest";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "../../mocks/data/research.js";
import { treeOf } from "./tree.js";

const row = RESEARCH_ROWS[0] ?? null;

describe("the run's tree", () => {
  it("draws the ask, facets, queries, pages and people; hits fold into their query", () => {
    const g = treeOf(RESEARCH_VIEW, row, "pages");
    expect(g.nodes.map((n) => n.id)).toEqual([
      "ask",
      "f:channels",
      "f:prices",
      "q:q1",
      "q:q2",
      "q:q3",
      "d:d1",
      "d:d2",
      "d:d3",
      "p:p1",
    ]);
    const q2 = g.nodes.find((n) => n.id === "q:q2");
    expect(q2?.number?.value).toBe(1);
    expect(q2?.more?.value).toBe(1);
    // A follow hangs off the page it started from.
    expect(g.edges).toContainEqual(
      expect.objectContaining({ from: "d:d1", to: "q:q3", kind: "follow" }),
    );
    expect(g.edges).toContainEqual(expect.objectContaining({ from: "q:q2", to: "d:d3" }));
    expect(g.edges).toContainEqual(expect.objectContaining({ from: "d:d1", to: "p:p1" }));
    // Every wire lands on a drawn node.
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    expect(g.nodes.find((n) => n.id === "d:d2")?.state).toEqual({ label: "thin", tone: "warn" });
  });

  it("draws every hit between its query and its page at the deeper zoom", () => {
    const g = treeOf(RESEARCH_VIEW, row, "hits");
    expect(g.nodes.filter((n) => n.id.startsWith("h:"))).toHaveLength(5);
    expect(g.edges).toContainEqual(expect.objectContaining({ from: "q:q1", to: "h:h1" }));
    expect(g.edges).toContainEqual(expect.objectContaining({ from: "h:h1", to: "d:d1" }));
    expect(g.nodes.find((n) => n.id === "h:h3")?.dim).toBe(true);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });
});
