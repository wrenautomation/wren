import { checkWorkflows } from "@wren/core/workflows";
import { describe, expect, it } from "vitest";
import { flow, grown, shape, withPain, withStudy } from "../test/fixtures.js";
import { graphOf } from "./convert.js";
import { soundShapes } from "./journeys.js";
import type { ShapeBody, ShapeNode } from "./model.js";
import { parseShapeFlow, shapeFlowId, shapeWorkflow } from "./workflow.js";

const NODE_ID = /^[a-z][a-z0-9_]*$/;

const body = (): ShapeBody => {
  const b = shape();
  b.nodes = b.nodes.map((n) =>
    n.id === "engaged" && n.kind === "step"
      ? { ...n, research: "light" as const }
      : n.id === "booked" && n.kind === "step"
        ? {
            ...n,
            advance: [
              { trigger: "trigger.booking", with: { on: "booked" } },
              { trigger: "trigger.document", with: { on: "viewed" } },
            ],
          }
        : n.id === "signed" && n.kind === "offer"
          ? { ...n, advance: [{ trigger: "trigger.document", with: { on: "signed" } }] }
          : n,
  );
  return b;
};

const wf = () => shapeWorkflow(2, body(), "wren");
const wires = (w = wf()) => w.wires.map((x) => `${x.from} -> ${x.to}`);

describe("shapeWorkflow", () => {
  it("names the workflow by version", () => {
    expect(wf().id).toBe("shape.v2");
    expect(shapeFlowId(2)).toBe("shape.v2");
    expect(parseShapeFlow("shape.v2")).toEqual({ version: 2 });
    expect(parseShapeFlow("shape.v13")).toEqual({ version: 13 });
    expect(parseShapeFlow("funnel.main.v2")).toBeNull();
    expect(parseShapeFlow("shape.v0")).toBeNull();
    expect(parseShapeFlow("shape.v1.x")).toBeNull();
  });

  it("is for Wren or for a client, a follow-up stage", () => {
    expect(wf().for).toBe("wren");
    expect(shapeWorkflow(1, body(), "client").for).toBe("client");
    expect(wf().stage).toBe("follow");
  });

  it("makes a move and a stage node per node that holds journeys, none for a source", () => {
    const ids = wf().nodes.map((n) => n.id);
    expect(ids).toEqual([
      "m_engaged",
      "s_engaged",
      "m_booked",
      "s_booked",
      "m_proposal",
      "s_proposal",
      "m_signed",
      "s_signed",
      "m_standard",
      "s_standard",
      "t_engaged_0",
      "t_booked_0",
      "t_booked_1",
      "t_signed_0",
      "dropped",
    ]);
    const by = new Map(wf().nodes.map((n) => [n.id, n]));
    expect(by.get("t_booked_0")).toMatchObject({
      uses: "trigger.booking",
      with: { on: "booked" },
    });
    expect(by.get("m_booked")?.own?.run).toBe("journey.move");
    expect(by.get("m_booked")?.with).toEqual({ to: "booked" });
    expect(by.get("s_booked")?.own?.run).toBe("journey.stage");
    expect(by.get("s_booked")?.with).toEqual({ node: "booked" });
    expect(by.get("s_standard")?.with).toEqual({ node: "standard" });
    expect(by.get("dropped")?.with).toEqual({ node: "dropped" });
  });

  it("carries a node's research to its stage node", () => {
    const by = new Map(wf().nodes.map((n) => [n.id, n]));
    expect(by.get("s_engaged")?.with).toEqual({ node: "engaged", research: "light" });
    expect(by.get("s_signed")?.with).toEqual({ node: "signed" });
  });

  it("wires causes to moves, moves to stages, inputs to moves", () => {
    const w = wires();
    expect(w).toContain("in.engaged -> m_engaged.journey");
    expect(w).toContain("in.dropped -> dropped.in");
    expect(w).toContain("m_booked.moved -> s_booked.in");
    expect(w).toContain("t_engaged_0.out -> m_engaged.reply");
    expect(w).toContain("t_booked_0.out -> m_booked.call");
    expect(w).toContain("t_booked_1.out -> m_booked.document");
    expect(wf().wires.every((x) => x.via === "events")).toBe(true);
  });

  it("builds no node for a plain source and none for a parked one", () => {
    const b = grown(
      [
        { id: "seg", kind: "source", name: "Group", via: "group", group: "7", parked: true },
        {
          id: "list",
          kind: "source",
          name: "List",
          via: "sourced",
          source: "import:12",
          parked: true,
        },
      ],
      [flow("seg", "booked"), flow("list", "booked")],
    );
    const w = shapeWorkflow(1, b, "wren");
    expect(w.nodes.some((n) => n.id.startsWith("e_"))).toBe(false);
    expect(w.nodes.some((n) => n.id === "m_yt")).toBe(false);
    expect(w.in.map((p) => p.id)).not.toContain("yt");
  });

  it("turns a group source into a group trigger wired to each of its nodes", () => {
    const b = grown(
      [
        { id: "warm", kind: "source", name: "Warm", via: "group", group: "7" },
        { id: "bad", kind: "source", name: "Bad", via: "group", group: "q-1" },
      ],
      [flow("warm", "booked"), flow("warm", "proposal"), flow("bad", "booked")],
    );
    const w = shapeWorkflow(1, b, "wren");
    expect(w.nodes.find((n) => n.id === "e_warm")).toEqual({
      id: "e_warm",
      uses: "trigger.segment",
      with: { segment: 7, on: "entered", repeat: "each" },
    });
    const ws = wires(w);
    expect(ws).toContain("e_warm.out -> m_booked.lead");
    expect(ws).toContain("e_warm.out -> m_proposal.lead");
    expect(w.nodes.find((n) => n.id === "m_booked")?.own?.in.map((p) => p.id)).toContain("lead");
    // A group that is not a number gets no node.
    expect(w.nodes.some((n) => n.id === "e_bad")).toBe(false);
    for (const n of w.nodes) expect(n.id).toMatch(NODE_ID);
    expect(checkWorkflows([w], [])).toEqual([]);
  });

  it("turns a sourced source into a source trigger wired to its node", () => {
    const b = grown(
      [
        { id: "list", kind: "source", name: "List", via: "sourced", source: "import:12" },
        { id: "none", kind: "source", name: "None", via: "sourced" },
      ],
      [flow("list", "booked"), flow("none", "booked")],
    );
    const w = shapeWorkflow(1, b, "wren");
    expect(w.nodes.find((n) => n.id === "e_list")).toEqual({
      id: "e_list",
      uses: "trigger.source",
      with: { source: "import:12" },
    });
    expect(wires(w)).toContain("e_list.out -> m_booked.lead");
    expect(w.nodes.some((n) => n.id === "e_none")).toBe(false);
    expect(checkWorkflows([w], [])).toEqual([]);
  });

  it("builds no trigger.journey node", () => {
    expect(wf().nodes.some((n) => n.uses === "trigger.journey")).toBe(false);
  });

  it("gives every node and port a valid id and passes the workflow check", () => {
    const w = wf();
    for (const n of w.nodes) expect(n.id).toMatch(NODE_ID);
    expect(checkWorkflows([w], [])).toEqual([]);
    expect(w.in.map((p) => p.id)).toEqual([
      "engaged",
      "booked",
      "proposal",
      "signed",
      "standard",
      "dropped",
    ]);
    expect(w.in.every((p) => p.kind === "journey")).toBe(true);
  });

  it("gives a move node one input per kind it hears", () => {
    const m = wf().nodes.find((n) => n.id === "m_booked")?.own;
    expect(m?.in.map((p) => `${p.id}:${p.kind}`)).toEqual([
      "journey:journey",
      "call:call",
      "document:document",
    ]);
  });

  it("refuses a trigger with no output", () => {
    const bad = body();
    bad.nodes[2] = {
      id: "engaged",
      kind: "step",
      name: "x",
      action: "other",
      advance: [{ trigger: "trigger.nope" }],
    } satisfies ShapeNode;
    expect(() => shapeWorkflow(1, bad, "wren")).toThrow(/trigger.nope/);
  });

  it("checks a one-node shape", () => {
    const one = shapeWorkflow(
      1,
      {
        name: "Solo",
        nodes: [
          { id: "src", kind: "source", name: "Src", via: "manual" },
          { id: "a", kind: "offer", name: "A", offer: "o", advance: [] },
        ],
        edges: [flow("src", "a")],
      },
      "client",
    );
    expect(checkWorkflows([one], [])).toEqual([]);
  });
});

describe("soundShapes", () => {
  it("keeps a sound shape and leaves out one that breaks the check", () => {
    const good = wf();
    const bad = {
      ...shapeWorkflow(1, body(), "wren"),
      // A wire between two different event kinds.
      wires: [{ from: "t_engaged_0.out", to: "s_signed.in", via: "events" as const }],
    };
    const logged: string[] = [];
    const kept = soundShapes([good, bad], [], [], (m) => logged.push(m));
    expect(kept.map((f) => f.id)).toEqual(["shape.v2"]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^shape\.v1 left out: /);
  });

  it("keeps a shape whose find station names a study, not an SOP", () => {
    const logged: string[] = [];
    const kept = soundShapes([shapeWorkflow(3, graphOf(withStudy()), "wren")], [], [], (m) =>
      logged.push(m),
    );
    expect(kept.map((f) => f.id)).toEqual(["shape.v3"]);
    expect(logged).toEqual([]);
  });

  it("keeps a shape with a sourced out line that joins a hub track (the pain points line)", () => {
    const logged: string[] = [];
    const kept = soundShapes([shapeWorkflow(4, graphOf(withPain()), "wren")], [], [], (m) =>
      logged.push(m),
    );
    expect(kept.map((f) => f.id)).toEqual(["shape.v4"]);
    expect(logged).toEqual([]);
  });
});
