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

  it("draws the page's graph data, links the run's page", () => {
    const row = RESEARCH_ROWS.find((r) => r.run === RESEARCH_VIEW.run) ?? null;
    const card = runCard(RESEARCH_VIEW, row);
    expect(card.run?.t).toBe(row?.ask);
    expect(card.run?.funnel.read).toBe(RESEARCH_VIEW.documents.length);
    expect(card.href).toBe(
      `/explorer/weaver?at=${encodeURIComponent(`weaver/${RESEARCH_VIEW.run}`)}&whole=1`,
    );
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
    expect(read?.name).toBe(d.title);
    expect(read?.findings.length).toBe(one.findings.filter((f) => f.kept).length);
    expect(read?.cut).toBe(one.findings.filter((f) => !f.kept).length);
  });

  it("shows the agent's next asks with their why; a channel ask joins once", () => {
    const by = { at: "2026-11-07T00:00:00Z", from: "stop", by: "agent-1" };
    const view: RunView = {
      ...RESEARCH_VIEW,
      asks: [{ id: "a1", ask: "Research the whole channel", why: "40 more reels", ...by }],
    };
    expect(runCard(view, null).asks).toEqual([
      { ask: "Research the whole channel", why: "40 more reels" },
    ]);
    expect(runCard(RESEARCH_VIEW, null).asks).toEqual([]);
    const [d] = view.documents;
    if (!d) throw new Error("the fixture has a page");
    const one: RunView = { ...view, queries: [], documents: [{ ...d, channel: "Mara Bakes" }] };
    expect(sourceRead(one)?.asks).toEqual([
      { ask: "Research the whole channel", why: "40 more reels" },
    ]);
    expect(sourceRead({ ...one, asks: [] })?.asks).toEqual([{ ask: "Research the whole channel" }]);
  });
});
