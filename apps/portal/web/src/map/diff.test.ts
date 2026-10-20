import type { ShapeDiff } from "@wren/pipeline/diff";
import type { ShapeBody } from "@wren/pipeline/model";
import { describe, expect, it } from "vitest";
import { diffGraph, diffLines } from "./diff.js";

const a: ShapeBody = {
  name: "Sample",
  nodes: [
    { id: "mail", kind: "source", name: "Spring list", via: "outbound", channel: "email" },
    { id: "engaged", kind: "step", name: "Engaged", action: "reply", advance: [] },
    { id: "joined", kind: "step", name: "Joined", action: "other", advance: [] },
  ],
  edges: [
    { id: "mail_to_engaged", from: "mail", to: "engaged", kind: "flow" },
    { id: "engaged_to_joined", from: "engaged", to: "joined", kind: "flow" },
  ],
};
const b: ShapeBody = {
  name: "Sample",
  nodes: [
    a.nodes[0] as ShapeBody["nodes"][number],
    { id: "engaged", kind: "step", name: "Replied", action: "reply", advance: [] },
    { id: "booked", kind: "step", name: "Booked", action: "book", advance: [] },
  ],
  edges: [
    { id: "mail_to_engaged", from: "mail", to: "engaged", kind: "flow" },
    { id: "engaged_to_booked", from: "engaged", to: "booked", kind: "flow" },
  ],
};
const diff: ShapeDiff = {
  nodes: {
    added: ["booked"],
    removed: ["joined"],
    renamed: [{ id: "engaged", from: "Engaged", to: "Replied" }],
    changed: ["engaged"],
  },
  edges: { added: ["engaged_to_booked"], removed: ["engaged_to_joined"], changed: [] },
  name: null,
};

describe("diffGraph", () => {
  it("draws the newer version with the removed ones beside it, each marked", () => {
    const g = diffGraph(a, b, diff);
    expect(g.nodes.map((n) => [n.id, n.mark ?? null])).toEqual([
      ["mail", null],
      ["engaged", "changed"],
      ["booked", "added"],
      ["joined", "removed"],
    ]);
    expect(g.edges.map((e) => [e.from, e.to, e.mark ?? null])).toEqual([
      ["mail", "engaged", null],
      ["engaged", "booked", "added"],
      ["engaged", "joined", "removed"],
    ]);
  });

  it("says each change in a line, by node name", () => {
    expect(diffLines(a, b, diff)).toEqual([
      "Added node Booked.",
      "Removed node Joined.",
      "Renamed node Engaged to Replied.",
      "Changed node Replied.",
      "Added edge Replied to Booked.",
      "Removed edge Engaged to Joined.",
    ]);
  });
});
