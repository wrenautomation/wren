import { describe, expect, it } from "vitest";
import { infraOf, type LoopRow } from "./hosts.js";

const NOW = Date.parse("2026-01-01T12:00:00Z");
const loop = (service: string, health = "ok", lastAt = "2026-01-01T11:50:00Z"): LoopRow => ({
  service,
  state: "running",
  health,
  lastAt,
});
const node = (g: ReturnType<typeof infraOf>, id: string) => g.nodes.find((n) => n.id === id);

describe("infraOf", () => {
  it("marks the host a failing loop runs on, and only that one", () => {
    const g = infraOf([loop("Discovery", "failing"), loop("SendScheduler")], NOW);
    expect(node(g, "box")?.state).toEqual({ label: "1 failing", tone: "bad" });
    expect(node(g, "box")?.more?.value).toBe(1);
    expect(node(g, "lambda")?.state).toEqual({ label: "Healthy", tone: "good" });
    expect(node(g, "lambda")?.number).toMatchObject({ value: 1, label: "loops running" });
    expect(node(g, "lambda")?.lines?.map((l) => l.text)).toContain("last pass 10 min ago");
    expect(node(g, "restate")?.state?.tone).toBe("good");
  });

  it("says Restate isn't answering when the loops can't be read", () => {
    const g = infraOf(new Error("admin down"), NOW);
    expect(node(g, "restate")?.state).toEqual({ label: "Not answering", tone: "bad" });
    expect(node(g, "lambda")?.state?.label).toBe("Unknown");
  });

  it("says where the hosts it can't see are checked", () => {
    const g = infraOf([], NOW);
    expect(node(g, "probe")?.state?.label).toBe("Measured elsewhere");
    expect(node(g, "probe")?.lines?.map((l) => l.text)).toEqual(["Checked in the daily digest"]);
    expect(g.edges.every((e) => g.nodes.some((n) => n.id === e.from))).toBe(true);
  });
});
