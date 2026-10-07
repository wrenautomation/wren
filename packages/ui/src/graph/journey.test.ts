import { describe, expect, it } from "vitest";
import { gapOf, journeyOf, MOST_TOUCHES, type Touch } from "./journey.js";
import { lanes } from "./lanes.js";

const touches: Touch[] = [
  {
    at: "2026-01-05T10:00:00Z",
    channel: "Email",
    kind: "reply",
    label: "Sounds good",
    note: "interested",
  },
  {
    at: "2026-01-01T10:00:00Z",
    channel: "Email",
    kind: "sent",
    label: "Quick question",
    note: "step 1",
  },
  { at: "2026-01-05T13:00:00Z", channel: "Meetings", kind: "booked", label: "Meeting booked" },
];

describe("gapOf", () => {
  it("says the time between two touches the way a person would", () => {
    expect(gapOf("2026-01-01T10:00:00Z", "2026-01-01T10:00:30Z")).toBe("same time");
    expect(gapOf("2026-01-01T10:00:00Z", "2026-01-01T10:40:00Z")).toBe("40 min later");
    expect(gapOf("2026-01-01T10:00:00Z", "2026-01-01T15:00:00Z")).toBe("5 h later");
    expect(gapOf("2026-01-01T10:00:00Z", "2026-01-02T10:00:00Z")).toBe("1 day later");
    expect(gapOf("2026-01-01T10:00:00Z", "2026-01-05T10:00:00Z")).toBe("4 days later");
  });
});

describe("journeyOf", () => {
  it("orders touches by time, a lane per channel, each wire the gap", () => {
    const g = journeyOf(touches, "UTC");
    expect(g.nodes.map((n) => [n.label, n.lane, n.state?.label])).toEqual([
      ["Quick question", "Email", "Sent"],
      ["Sounds good", "Email", "Replied"],
      ["Meeting booked", "Meetings", "Booked"],
    ]);
    expect(g.nodes[0]?.note).toBe("Email · Jan 1 · step 1");
    expect(g.edges.map((e) => e.label)).toEqual(["4 days later", "3 h later"]);
  });

  it("keeps the newest touches and says how many earlier it left out", () => {
    const many = Array.from({ length: MOST_TOUCHES + 3 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
      channel: "Email",
      kind: "sent",
      label: `Email ${i}`,
    }));
    const g = journeyOf(many, "UTC");
    expect(g.nodes).toHaveLength(MOST_TOUCHES);
    expect(g.nodes[0]?.label).toBe("Email 3");
    expect(g.nodes[0]?.note).toContain("3 earlier not shown");
  });
});

describe("lanes", () => {
  const nodes = [
    { id: "a", width: 100, height: 40, lane: "Email" },
    { id: "b", width: 100, height: 40, lane: "Meetings" },
    { id: "c", width: 100, height: 40, lane: "Email" },
  ];
  const edges = [
    { id: "a>b", from: "a", to: "b", label: { width: 60, height: 15 } },
    { id: "b>c", from: "b", to: "c" },
  ];

  it("puts each node in its own column, on its lane's row", () => {
    const l = lanes(nodes, edges, "RIGHT");
    expect(l.nodes.a).toMatchObject({ x: 0, y: 0 });
    // The gap makes room for the words on the wire into b.
    expect(l.nodes.b?.x).toBe(100 + 60 + 12);
    expect(l.nodes.b?.y).toBeGreaterThan(40);
    expect(l.nodes.c?.y).toBe(0);
    expect(l.nodes.c?.x).toBeGreaterThan(l.nodes.b?.x ?? 0);
    // A lane change turns at the far end, under its words.
    expect(l.edges["a>b"]?.points).toHaveLength(4);
    expect(l.edges["a>b"]?.label?.x).toBe(106);
  });

  it("stacks them in one column on a phone", () => {
    const l = lanes(nodes, edges, "DOWN");
    expect(new Set(Object.values(l.nodes).map((n) => n.x))).toEqual(new Set([0]));
    expect(l.nodes.b?.y).toBeGreaterThan((l.nodes.a?.y ?? 0) + 40);
    expect(l.edges["b>c"]?.points).toHaveLength(2);
  });
});
