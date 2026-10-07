// A dry test on its canvas: the cards it reached, what each would do, on the test's own clock.
import type { GraphNode } from "@wren/ui";
import { describe, expect, it } from "vitest";
import type { Drawn } from "../marketplace/boxes.js";
import { afterText, type DryStep, dryNodes, entriesOf } from "./dry.js";

const w: Drawn = {
  id: "flow",
  name: "Flow",
  in: [{ id: "leads", label: "leads", kind: "lead" }] as Drawn["in"],
  out: [],
  nodes: [
    { id: "wait", uses: "logic.wait", name: "Wait", note: null, ready: "ready" },
    { id: "text", uses: "sms.send", name: "Text", note: null, ready: "ready" },
    { id: "c", uses: "x.c", name: "C", note: null, ready: "ready" },
  ],
  wires: [
    { from: "in.leads", to: "wait.in", via: "events" },
    { from: "wait.out", to: "text.leads", via: "events" },
  ] as Drawn["wires"],
};
const step = (node: string, more: Partial<DryStep> = {}): DryStep => ({
  node,
  port: "in",
  subject: "test:lead",
  at: 0,
  in: {},
  out: [],
  ...more,
});
const card = (id: string): GraphNode =>
  ({ id, label: id, number: { value: 3, label: "sent" } }) as unknown as GraphNode;

describe("afterText", () => {
  it("says the test clock in whole units", () => {
    expect(afterText(0)).toBe("at once");
    expect(afterText(2 * 86_400_000)).toBe("after 2 days");
    expect(afterText(3_600_000)).toBe("after 1 hour");
    expect(afterText(90 * 60_000)).toBe("after 90 minutes");
  });
});

describe("dryNodes", () => {
  it("lights what the test reached, says what a stub would do, and drops the live numbers", () => {
    const got = dryNodes([card("wait"), card("text"), card("c")], w, [
      step("wait", { out: [{ port: "out", data: {} }] }),
      step("text", { at: 2 * 86_400_000, would: "Would send" }),
    ]);
    expect(got.lit).toEqual(["in.leads", "wait", "text"]);
    const [wait, text, c] = got.nodes;
    expect(wait?.state).toEqual({ label: "Passed", tone: "good" });
    expect(text?.state).toEqual({ label: "Would send", tone: "accent" });
    expect(text?.note).toBe("after 2 days");
    expect(c?.number).toBeUndefined();
  });

  it("marks a card that failed", () => {
    const got = dryNodes([card("wait")], w, [step("wait", { error: "bad rule" })]);
    expect(got.nodes[0]?.state).toEqual({ label: "Failed", tone: "bad" });
  });
});

describe("dryNodes from a trigger", () => {
  it("lights the trigger it entered at", () => {
    const got = dryNodes([card("c"), card("wait")], w, [step("wait")], "c.found");
    expect(got.lit).toEqual(["c", "wait"]);
  });
});

describe("entriesOf", () => {
  it("offers the inputs, then each output of a card nothing feeds", () => {
    const fed: Drawn = {
      ...w,
      nodes: [
        ...w.nodes,
        {
          id: "sheet",
          uses: "x.sheet",
          name: "Sheet",
          note: null,
          ready: "ready",
          out: [{ id: "found", label: "found", kind: "lead" }] as Drawn["out"],
        },
      ],
    };
    expect(entriesOf(fed).map((p) => [p.id, p.label])).toEqual([
      ["in.leads", "leads"],
      ["sheet.found", "Sheet: found"],
    ]);
  });
});
