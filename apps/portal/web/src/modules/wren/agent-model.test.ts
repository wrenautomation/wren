import type { AgentLine, LoopRow } from "@wren/core/console";
import { describe, expect, it } from "vitest";
import { agentsOf, countKey, departments, since, tally } from "./agent-model.js";

const line = (id: string, o: Partial<AgentLine> = {}): AgentLine => ({
  id,
  name: id,
  blurb: "b",
  icon: "flag",
  stage: "run",
  department: "Run Wren",
  ready: true,
  loops: [],
  counts: [],
  ...o,
});
const loop = (service: string, o: Partial<LoopRow> = {}): LoopRow => ({
  service,
  key: "k",
  running: true,
  lastAt: null,
  failures: 0,
  error: null,
  nextAt: null,
  delayMs: null,
  timeouts: [],
  ...o,
});

describe("agentsOf", () => {
  const lines = [
    line("ok", { loops: ["A"] }),
    line("bad", { loops: ["B", "C"] }),
    line("stopped", { loops: ["D"] }),
    line("called"),
  ];
  it("reads each state off its loops", () => {
    const got = agentsOf(lines, [
      loop("A", { lastAt: "2026-10-11T08:00:00Z" }),
      loop("B", { lastAt: "2026-10-11T07:00:00Z" }),
      loop("C", { failures: 2, error: "boom\nstack", lastAt: "2026-10-11T09:00:00Z" }),
      loop("D", { running: false, failures: 3, error: "old" }),
    ]);
    expect(got.map((a) => [a.id, a.state])).toEqual([
      ["ok", "running"],
      ["bad", "failing"],
      ["stopped", "off"],
      ["called", "call"],
    ]);
    expect(got[1]).toMatchObject({ lastAt: "2026-10-11T09:00:00Z", error: "boom" });
    expect(got[2]?.error).toBeNull();
  });
  it("says unknown when the loops didn't read", () => {
    expect(agentsOf(lines, null).map((a) => a.state)).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "call",
    ]);
  });
});

describe("departments and tally", () => {
  const agents = agentsOf(
    [
      line("b", { department: "Find leads", loops: ["X"] }),
      line("a", { department: "Find leads", loops: ["Y"] }),
      line("c", { counts: [{ port: "p", label: "posts", record: "r", view: "all" }] }),
      line("d", { counts: [{ port: "p", label: "posts", record: "r", view: "all" }] }),
    ],
    [loop("X", { error: "e" }), loop("Y", { running: false })],
  );
  it("groups in order, failing first", () => {
    expect(departments(agents).map((d) => [d.name, d.agents.map((a) => a.id)])).toEqual([
      ["Find leads", ["b", "a"]],
      ["Run Wren", ["c", "d"]],
    ]);
  });
  it("counts a shared number once", () => {
    const counts = new Map([[countKey({ record: "r", view: "all" }), { value: 9, today: 4 }]]);
    expect(tally(agents, counts)).toEqual({ running: 0, failing: 1, off: 1, today: 4 });
  });
});

describe("since", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("says how long ago", () => {
    expect(since(null, now)).toBe("never");
    expect(since("2026-10-11T11:59:40Z", now)).toBe("just now");
    expect(since("2026-10-11T11:48:00Z", now)).toBe("12 min ago");
    expect(since("2026-10-11T09:00:00Z", now)).toBe("3 h ago");
    expect(since("2026-10-08T12:00:00Z", now)).toBe("3 d ago");
  });
});
