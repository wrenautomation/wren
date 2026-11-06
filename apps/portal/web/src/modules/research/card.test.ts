import { describe, expect, it } from "vitest";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "../../mocks/data/research.js";
import { runCard, runOf, sourceRead } from "./card.js";
import type { RunView } from "./serve.js";

describe("a run as its chat card", () => {
  it("reads the run a view part names", () => {
    expect(runOf({ run: "r1" })).toBe("r1");
    expect(runOf({ run: 3 })).toBeNull();
    expect(runOf(null)).toBeNull();
  });

  it("groups pages into sources and counts kept and cut findings", () => {
    const row = RESEARCH_ROWS.find((r) => r.run === RESEARCH_VIEW.run) ?? null;
    const card = runCard(RESEARCH_VIEW, row);
    expect(card.name).toBe(row?.ask);
    expect(card.pages).toBe(RESEARCH_VIEW.documents.length);
    expect(card.claims).toEqual([]);
    const kept = RESEARCH_VIEW.findings.filter((f) => f.kept).length;
    expect(card.sources.reduce((a, s) => a + s.findings.length, 0)).toBe(kept);
    expect(card.sources.reduce((a, s) => a + s.cut, 0)).toBe(RESEARCH_VIEW.findings.length - kept);
    expect(new Set(card.sources.map((s) => s.id)).size).toBe(card.sources.length);
    expect(card.href).toBe(`/research/runs?run=${RESEARCH_VIEW.run}`);
  });

  it("a run of one page and no search is that page; any other run is a graph", () => {
    expect(sourceRead(RESEARCH_VIEW)).toBeNull();
    const [d] = RESEARCH_VIEW.documents;
    if (!d) throw new Error("the fixture has a page");
    const one: RunView = {
      ...RESEARCH_VIEW,
      queries: [],
      documents: [d],
      findings: RESEARCH_VIEW.findings.filter((f) => f.document === d.id),
    };
    const read = sourceRead(one);
    expect(read?.source.name).toBe(d.title);
    expect(read?.source.findings.length).toBe(one.findings.filter((f) => f.kept).length);
  });
});
