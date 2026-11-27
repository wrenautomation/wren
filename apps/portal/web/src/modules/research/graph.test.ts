import { describe, expect, it } from "vitest";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "../../mocks/data/research.js";
import { BOARD_VIEW } from "../../mocks/data/research-board.js";
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

describe("a social run as the graph's data (WA-1405)", () => {
  const g = runGraphOf(BOARD_VIEW);

  it("makes one source per author on a social site, not one per site", () => {
    const x = g.sources.filter((s) => s.icon?.endsWith("url=https://x.com"));
    expect(x.map((s) => s.name).sort()).toEqual([
      "a_very_long_handle_that_never_wraps_well",
      "bakehouse_ops",
      "crumbandco",
      "rackandroll",
      "sourdoughsally",
    ]);
    expect(x.find((s) => s.name === "crumbandco")?.home).toBe("https://x.com/crumbandco");
  });

  it("gives a source its best pick's picture, else any page's", () => {
    const withPick = g.sources.filter((s) => s.pick != null);
    for (const s of withPick) {
      const best = s.pages.filter((p) => p.og).sort((a, b) => (a.pick ?? 999) - (b.pick ?? 999))[0];
      expect(s.og).toBe(best?.og ?? null);
    }
    const posters = g.sources.filter((s) => s.pages.some((p) => p.og));
    expect(posters.every((s) => s.og)).toBe(true);
  });
});
