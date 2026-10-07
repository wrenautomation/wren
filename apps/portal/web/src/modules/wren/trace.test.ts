// One execution on its canvas: the cards it reached, how each went, and the data of each step.
import { describe, expect, it } from "vitest";
import type { Drawn } from "../marketplace/boxes.js";
import { age, cardOf, dataText, forText, litNodes, type TraceStep, traceOf } from "./trace.js";

const w: Drawn = {
  id: "flow",
  name: "Flow",
  in: [{ id: "leads", label: "leads", kind: "lead" }] as Drawn["in"],
  out: [{ id: "won", label: "won", kind: "client" }] as Drawn["out"],
  nodes: [
    { id: "a", uses: "x.a", name: "A", note: null, ready: "ready" },
    { id: "b", uses: "inner", name: "B", note: null, ready: "ready", opens: "inner" },
    { id: "c", uses: "x.c", name: "C", note: null, ready: "ready" },
  ],
  wires: [
    { from: "in.leads", to: "a.leads", via: "events" },
    { from: "a.sent", to: "b.leads", via: "events" },
    { from: "b.won", to: "out.won", via: "events" },
  ] as Drawn["wires"],
};
const step = (node: string, more: Partial<TraceStep> = {}): TraceStep => ({
  id: node,
  node,
  port: "leads",
  kind: "lead",
  data: {},
  at: "2026-10-06T10:00:00.000Z",
  due: null,
  until: null,
  error: null,
  sent: null,
  sentAt: null,
  ...more,
});

describe("traceOf", () => {
  it("lights the input it came in by and every card it reached, a nested step on its card", () => {
    const t = traceOf(w, [step("a"), step("b.inner1"), step("b.inner2", { error: "down" })]);
    expect(t.lit).toEqual(["in.leads", "a", "b"]);
    expect(t.states.get("a")).toEqual({ label: "Done", tone: "good" });
    expect(t.states.get("b")).toEqual({ label: "Failed", tone: "bad" });
    expect(t.steps.get("b")?.map((s) => s.id)).toEqual(["b.inner1", "b.inner2"]);
  });

  it("marks a card waiting, and an output as its own card", () => {
    const t = traceOf(w, [step("a"), step("out", { port: "won", due: "2026-10-07T10:00:00Z" })]);
    expect(cardOf({ node: "out", port: "won" })).toBe("out.won");
    expect(t.states.get("out.won")).toEqual({ label: "Waiting", tone: "warn" });
  });

  it("says what a Wait holds it for", () => {
    expect(forText("reply")).toBe(" for a reply");
    expect(forText("booking")).toBe(" for a booking");
    expect(forText(null)).toBe("");
  });
});

describe("litNodes", () => {
  it("says when each reached card got its step and drops the 30-day numbers", () => {
    const t = traceOf(w, [step("a", { sentAt: "2026-10-06T10:01:00.000Z" })]);
    const nodes = litNodes(
      [
        { id: "a", kind: "part", label: "A", number: { value: 9, label: "leads" } },
        { id: "c", kind: "part", label: "C", dim: true },
      ],
      t,
      (iso) => iso.slice(11, 16),
    );
    expect(nodes[0]).toMatchObject({ note: "10:01", state: { tone: "good" }, number: undefined });
    expect(nodes[1]).toMatchObject({ dim: false, number: undefined });
  });
});

describe("age and dataText", () => {
  it("reads short", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(age("2026-10-06T11:59:30Z", now)).toBe("now");
    expect(age("2026-10-06T11:48:00Z", now)).toBe("12m");
    expect(age("2026-10-04T11:00:00Z", now)).toBe("2d");
    expect(dataText({ a: "x".repeat(50) }, 20)).toMatch(/…$/);
  });
});
