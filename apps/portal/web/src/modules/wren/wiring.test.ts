// The canvas's editing: wires only where the kinds match, a draft over what the server drew.

import type { Port } from "@wren/core/components";
import { describe, expect, it } from "vitest";
import type { Drawn } from "../marketplace/boxes.js";
import {
  addNode,
  changesOf,
  diffOf,
  draftOf,
  drawnDiff,
  drawnWith,
  endText,
  type Palette,
  pairsOf,
  problemsOf,
  settingSet,
  stepOf,
  wired,
  withoutStep,
  withSet,
} from "./wiring.js";

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

  it("narrows a drag to the ports it joined", () => {
    const two = { ...w, nodes: [...w.nodes, node("b", [lead("x"), lead("y")], [])] };
    expect(pairsOf(two, "a", "b")).toHaveLength(2);
    expect(pairsOf(two, "a", "b", { from: "sent", to: "y" })).toEqual([
      { from: "a.sent", to: "b.y", via: "events" },
    ]);
  });
});

const palette: Palette = {
  logic: [],
  parts: [
    {
      id: "x.mail",
      name: "Mail",
      blurb: "Sends a mail.",
      icon: "mail",
      in: [lead("leads")],
      out: [reply("replied")],
      effects: ["sends"],
      ready: "ready",
    },
  ],
  workflows: [],
};

describe("editor", () => {
  it("adds a logic node with its start settings, its ports following its kind", () => {
    const first = draftOf(w, null, false);
    const got = addNode(w, first, "logic.if", palette);
    expect(got?.id).toBe("if");
    const d = withSet(got?.draft ?? first, "if", "kind", "reply");
    const shown = drawnWith(w, first, d, palette);
    const n = shown.nodes.find((x) => x.id === "if");
    expect(n?.out?.map((p) => [p.id, p.kind])).toEqual([
      ["yes", "reply"],
      ["no", "reply"],
    ]);
    expect(addNode(w, d, "logic.if", palette)?.id).toBe("if_2");
    expect(addNode(w, d, "nothing", palette)).toBeNull();
    expect(withSet(d, "if", "kind", "").steps[0]?.with).toEqual({});
  });

  it("changes a built-in Wait's settings in place, and counts it as one change", () => {
    const wait = {
      ...node("wait1", [lead("in")], [lead("out")]),
      uses: "logic.wait",
      with: { mode: "until", until: "answer", most: "2 days" },
    };
    const ww: Drawn = { ...w, nodes: [...w.nodes, wait] };
    const first = draftOf(ww, null, false);
    const d = settingSet(first, "wait1", wait.with, "most", "5 days");
    expect(d.settings).toEqual({ wait1: { mode: "until", until: "answer", most: "5 days" } });
    expect(d.steps).toEqual([]);
    const shown = drawnWith(ww, first, d).nodes.find((x) => x.id === "wait1");
    expect(shown?.with?.most).toBe("5 days");
    expect(shown?.note).toBe("Until an answer or 5 days");
    expect(changesOf(first, d)).toBe(1);
    const saved = draftOf(ww, { edits: d, by: "t", at: "now" }, false);
    expect(saved.settings).toEqual(d.settings);
    expect(draftOf(ww, { edits: d, by: "t", at: "now" }, true).settings).toBeUndefined();
  });

  it("adds a part from the palette with its ports", () => {
    const got = addNode(w, draftOf(w, null, false), "x.mail", palette);
    const shown = drawnWith(
      w,
      draftOf(w, null, false),
      got?.draft ?? { wires: [], steps: [] },
      palette,
    );
    expect(shown.nodes.find((n) => n.id === "mail")).toMatchObject({
      uses: "x.mail",
      name: "Mail",
      in: [lead("leads")],
    });
  });

  it("counts changes, marks the diff, and says what won't run", () => {
    const first = draftOf(w, null, false);
    const next = wired(
      { wires: [], steps: [{ id: "if", uses: "logic.if", with: { kind: "lead" } }] },
      { from: "a.sent", to: "if.in", via: "events" },
    );
    const diff = diffOf(first, next);
    expect([...diff.nodes]).toEqual([["if", "added"]]);
    expect([...diff.wires]).toEqual([
      ["a.sent>if.in", "added"],
      ["a.replied>out.replied", "removed"],
    ]);
    expect(changesOf(first, next)).toBe(3);
    // A draft read back from jsonb has its keys in another order: no change.
    const back = {
      steps: [],
      wires: first.wires.map((x) => Object.fromEntries(Object.entries(x).reverse()) as typeof x),
    };
    expect(changesOf(first, back)).toBe(0);
    const dd = drawnDiff(w, first, first, next, palette);
    expect(dd.drawn.wires.map((x) => x.from)).toContain("a.replied");
    expect(dd.edges.get("a>out.replied")).toBe("removed");
    expect(dd.edges.get("a>if")).toBe("added");
    expect(problemsOf(next)).toEqual(["if: If needs a rule"]);
    expect(
      problemsOf({ steps: [], wires: [{ from: "a.x", to: "b.y", via: "events", wait: "soon" }] }),
    ).toHaveLength(1);
  });
});
