import { describe, expect, it } from "vitest";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "../../mocks/data/research.js";
import { runGraphOf } from "./graph.js";

describe("a run as the graph's data", () => {
  const g = runGraphOf(RESEARCH_VIEW, RESEARCH_ROWS[0]);

  it("takes the ask, claims from patterns and the cost from the brief", () => {
    expect(g.rid).toBe("r1");
    expect(g.t).toBe("How do small bakeries find wholesale buyers?");
    expect(g.claims.map((c) => c.findings)).toEqual([1, 1]);
    expect(g.meta).toMatch(/\$0\.42$/);
  });

  it("groups pages by site, keeps only kept findings, and lists dropped hits", () => {
    const yt = g.sources.find((s) => s.site === "youtube");
    expect(yt?.pages[0]?.th).toBe("https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
    expect(g.sources.flatMap((s) => s.fs).map((f) => f.t)).not.toContain(
      "Most bakers price wholesale at 60% of retail.",
    );
    expect(g.dropped.map((d) => d.t)).toContain("Bakery software for every shop");
    expect(g.funnel.findings).toBe(2);
  });

  it("marks read-list picks with their rank, a source with its best page's", () => {
    const yt = g.sources.find((s) => s.site === "youtube");
    expect(yt?.pages[0]?.pick).toBe(1);
    expect(yt?.pick).toBe(1);
    const web = g.sources.find((s) => s.name === "bakers.example");
    expect(web?.pick).toBeUndefined();
  });
});
