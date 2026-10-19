import type { ShapeBody } from "@wren/pipeline/model";
import { describe, expect, it } from "vitest";
import { graphOf, type MapData, numbersSay, windowOf, windowSays } from "./model.js";

const body: ShapeBody = {
  name: "Sample",
  nodes: [
    { id: "mail", kind: "source", name: "Spring list", via: "outbound", channel: "email" },
    { id: "engaged", kind: "step", name: "Engaged", action: "reply", advance: [] },
    { id: "signed", kind: "offer", name: "Signed", offer: "starter", advance: [] },
    { id: "standard", kind: "plan", name: "Standard plan", terms: "standard", advance: [] },
  ],
  edges: [
    { id: "mail_to_engaged", from: "mail", to: "engaged", kind: "flow" },
    { id: "engaged_to_signed", from: "engaged", to: "signed", kind: "flow" },
    { id: "signed_to_standard", from: "signed", to: "standard", kind: "flow" },
    { id: "signed_to_engaged", from: "signed", to: "engaged", kind: "loop" },
  ],
};

const none = { opened: null, deals: null, collected: null, scheduled: null };
const data: MapData = {
  body,
  depths: {},
  versions: [],
  nodes: new Map([
    [
      "mail",
      {
        id: "mail",
        now: null,
        arrived: null,
        left: null,
        medianDays: null,
        ...none,
        opened: 11,
        deals: 2,
      },
    ],
    ["engaged", { id: "engaged", now: 5, arrived: 14, left: 9, medianDays: 4.25, ...none }],
    [
      "standard",
      {
        id: "standard",
        now: 3,
        arrived: 3,
        left: 0,
        medianDays: 0,
        ...none,
        collected: { amount: 1_800, currency: "CAD" },
        scheduled: { amount: 3_000, currency: "CAD" },
      },
    ],
  ]),
  edges: new Map([
    ["mail_to_engaged", 14],
    ["engaged_to_signed", 4],
    ["signed_to_engaged", 1],
  ]),
  people: [],
  ghosts: [
    {
      id: "joined",
      name: "Joined",
      people: [
        {
          id: "j7",
          name: "Gus Held",
          node: "joined",
          nodeName: "Joined",
          movedAt: null,
          daysAtNode: 1,
        },
      ],
    },
  ],
};

describe("windowOf", () => {
  it("takes the address's window, 30 days when it names none or an unknown one", () => {
    expect(windowOf("7")).toBe("7");
    expect(windowOf("all")).toBe("all");
    expect(windowOf(null)).toBe("30");
    expect(windowOf("365")).toBe("30");
    expect(windowSays("30")).toBe("in the last 30 days");
    expect(windowSays("all")).toBe("in all time");
  });
});

describe("graphOf", () => {
  const g = graphOf(data);

  it("draws a node per shape node, kind by kind, and a ghost beside them", () => {
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([
      ["mail", "part"],
      ["engaged", "step"],
      ["signed", "record"],
      ["standard", "workflow"],
      ["joined", "step"],
    ]);
    const ghost = g.nodes.find((n) => n.id === "joined");
    expect(ghost).toMatchObject({ dashed: true, dim: true, number: { value: 1, label: "now" } });
  });

  it("gives each node one number: people now, opened for a source, collected for a plan", () => {
    const by = (id: string) => g.nodes.find((n) => n.id === id)?.number;
    expect(by("engaged")).toEqual({ value: 5, label: "now" });
    expect(by("mail")).toEqual({ value: 11, label: "opened" });
    expect(by("standard")).toEqual({ value: 1_800, label: "CAD collected" });
  });

  it("carries the offer and plan in the accent and the rest by kind", () => {
    const tint = (id: string) => g.nodes.find((n) => n.id === id)?.tint;
    expect(tint("signed")).toBe("var(--ui-active)");
    expect(tint("standard")).toBe("var(--ui-active)");
    expect(tint("engaged")).not.toBe("var(--ui-active)");
  });

  it("weights each wire by its crossings and marks a loop", () => {
    expect(g.edges.map((e) => [e.from, e.to, e.weight, e.loop ?? false])).toEqual([
      ["mail", "engaged", 14, false],
      ["engaged", "signed", 4, false],
      ["signed", "standard", 0, false],
      ["signed", "engaged", 1, true],
    ]);
  });
});

describe("numbersSay", () => {
  it("says a step's four numbers", () => {
    expect(numbersSay("step", data.nodes.get("engaged"))).toEqual([
      "Now: 5",
      "Arrived: 14",
      "Left: 9",
      "Median days there: 4.3",
    ]);
  });

  it("says a plan's scheduled and collected money", () => {
    expect(numbersSay("plan", data.nodes.get("standard"))).toEqual([
      "Now: 3",
      "Deals: 0",
      "Scheduled: CA$3,000",
      "Collected: CA$1,800",
    ]);
  });

  it("says nothing is known for a node with no row", () => {
    expect(numbersSay("step", undefined)).toEqual(["No numbers yet."]);
  });
});
