import { describe, expect, it } from "vitest";
import { funnelGraph } from "./funnel-map.js";

const P1 = "00000000-0000-4000-8000-000000000001";

describe("funnel map", () => {
  it("draws sources into pages, pages into forms, forms into bookings", () => {
    const g = funnelGraph([
      { id: "a", page: P1, title: "Lander", channel: "ads", views: 100, forms: 10, books: 2 },
      { id: "b", page: P1, title: "Lander", channel: "organic", views: 50, forms: 5, books: 1 },
      { id: "c", page: "x", title: "Empty", channel: "ads", views: 0, forms: 0, books: 0 },
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "src:ads",
      "src:organic",
      `page:${P1}`,
      "forms",
      "books",
    ]);
    expect(g.nodes.find((n) => n.id === "src:ads")?.number?.value).toBe(100);
    expect(g.edges.find((e) => e.to === "forms")).toMatchObject({
      count: { value: 15 },
      rate: { from: 150, to: 15 },
    });
    expect(g.edges.find((e) => e.to === "books")?.count?.value).toBe(3);
  });
});
