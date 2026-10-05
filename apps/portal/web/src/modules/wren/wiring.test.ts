// The canvas's editing: wires only where the kinds match, a draft over what the server drew.

import type { Port } from "@wren/core/components";
import { describe, expect, it } from "vitest";
import type { Drawn } from "../marketplace/boxes.js";
import { draftOf, drawnWith, endText, pairsOf, stepOf, wired, withoutStep } from "./wiring.js";

const lead = (id: string) => ({ id, label: id, kind: "lead" as const });
const reply = (id: string) => ({ id, label: id, kind: "reply" as const });
const node = (id: string, i: Port[], o: Port[]) => ({
  id,
  uses: id,
  name: id.toUpperCase(),
  note: null,
  ready: "ready" as const,
  in: i,
  out: o,
});
const w: Drawn = {
  id: "f",
  name: "F",
  in: [lead("leads")],
  out: [reply("replied")],
  nodes: [node("a", [lead("leads")], [lead("sent"), reply("replied")])],
  wires: [
    { from: "in.leads", to: "a.leads", via: "code", label: "leads" },
    { from: "a.replied", to: "out.replied", via: "events", wait: "2 days", label: "replied" },
  ],
};

describe("wiring", () => {
  it("pairs an output with an input only when the kinds match", () => {
    expect(pairsOf(w, "a", "out.replied")).toEqual([
      { from: "a.replied", to: "out.replied", via: "events" },
    ]);
    expect(pairsOf(w, "in.leads", "out.replied")).toEqual([]);
    expect(pairsOf(w, "out.replied", "a")).toEqual([]);
    expect(endText(w, "a.sent", "from")).toBe("A: sent");
    expect(endText(w, "out.replied", "to")).toBe("Out: replied");
  });

  it("drafts the routed wires, adds a custom step, and drops it with its wires", () => {
    const first = draftOf(w, null, false);
    expect(first).toEqual({
      wires: [{ from: "a.replied", to: "out.replied", via: "events", wait: "2 days" }],
      steps: [],
    });
    const s = stepOf(w, {
      name: "Their CRM!",
      url: " https://crm.example/in ",
      takes: "lead",
      gives: "reply",
      outs: "answered, ",
    });
    expect(s).toMatchObject({
      id: "their_crm",
      own: { run: "https://crm.example/in", in: [lead("lead")], out: [reply("answered")] },
    });
    const d = wired(
      { ...first, steps: [s] },
      { from: "a.sent", to: "their_crm.lead", via: "events" },
    );
    expect(wired(d, { from: "a.sent", to: "their_crm.lead", via: "events" })).toBe(d);
    const shown = drawnWith(w, first, d);
    expect(shown.nodes.map((n) => n.id)).toEqual(["a", "their_crm"]);
    expect(shown.wires.map((x) => [x.from, x.label])).toEqual([
      ["in.leads", "leads"],
      ["a.replied", "replied"],
      ["a.sent", "sent"],
    ]);
    expect(pairsOf(shown, "their_crm", "out.replied")).toHaveLength(1);
    expect(withoutStep(d, "their_crm")).toEqual(first);
  });
});
