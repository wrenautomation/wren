import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("location", new URL("http://localhost:8803/"));
const { metroFor } = await import("../../mocks/data/journeys.js");
const { CADENCE } = await import("../../mocks/data/marketing.js");
const { STUDIO_GRAPH, STUDIO_WAITING } = await import("../../mocks/data/studio.js");
const { dueOf } = await import("./plan.js");
const { headlineOf, lateSlot, waited } = await import("./studio-common.js");

type Idea = Parameters<typeof lateSlot>[0];

describe("Studio sample shape", () => {
  it("has two offer lines", () => {
    const lines = metroFor(STUDIO_GRAPH).lines.filter((l) => l.tier === "core");
    expect(lines.map((l) => l.label)).toEqual(["Offer builder", "Reactivation"]);
  });

  it("names a line on the plan's pieces", () => {
    expect(dueOf(CADENCE).some((d) => d.line === "react")).toBe(true);
  });
});

describe("Studio waiting rows", () => {
  const ideas = STUDIO_WAITING.ideas as unknown as Idea[];
  it("marks the one past its slot", () => {
    expect(ideas.filter((i) => lateSlot(i)).length).toBe(1);
  });
  it("says how long it waited", () => {
    expect(waited(ideas[0] as Idea)).toBe("26h");
  });
  it("never shows a thread's divider as its hook", () => {
    expect(headlineOf(ideas[1] as Idea).hook).not.toBe("---");
  });
});
