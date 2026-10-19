import { checkWorkflows } from "@wren/core/workflows";
import { describe, expect, it } from "vitest";
import { soundFunnels } from "./journeys.js";
import type { FunnelBody } from "./model.js";
import { funnelFlowId, funnelWorkflow, parseFunnelFlow } from "./workflow.js";

const NODE_ID = /^[a-z][a-z0-9_]*$/;

const body = (over: Partial<FunnelBody> = {}): FunnelBody => ({
  name: "Test funnel",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", research: "light", on: [{ trigger: "trigger.reply" }] },
    {
      key: "booked",
      label: "Booked",
      on: [
        { trigger: "trigger.booking", with: { on: "booked" } },
        { trigger: "trigger.document", with: { on: "viewed" } },
      ],
    },
    {
      key: "signed",
      label: "Signed",
      sale: true,
      on: [{ trigger: "trigger.document", with: { on: "signed" } }],
    },
  ],
  entries: [
    { id: "web", kind: "organic", channel: "web" },
    { id: "from_other", kind: "funnel", funnel: { id: "other", at: "paid" }, to: "booked" },
  ],
  ...over,
});

const flow = () => funnelWorkflow("main", 2, body(), "wren");

describe("funnelWorkflow", () => {
  it("names the workflow by funnel and version", () => {
    expect(flow().id).toBe("funnel.main.v2");
    expect(funnelFlowId("main", 2)).toBe("funnel.main.v2");
    expect(parseFunnelFlow("funnel.main.v2")).toEqual({ funnel: "main", version: 2 });
    expect(parseFunnelFlow("funnel.a-b_c.v13")).toEqual({ funnel: "a-b_c", version: 13 });
    expect(parseFunnelFlow("follow_up.main")).toBeNull();
    expect(parseFunnelFlow("funnel.main.v0")).toBeNull();
  });

  it("is for Wren or for a client, a follow-up stage", () => {
    expect(flow().for).toBe("wren");
    expect(funnelWorkflow("main", 1, body(), "client").for).toBe("client");
    expect(flow().stage).toBe("follow");
  });

  it("makes a trigger, a move and a stage node per stage", () => {
    const ids = flow().nodes.map((n) => n.id);
    expect(ids).toEqual([
      "m_engaged",
      "s_engaged",
      "m_booked",
      "s_booked",
      "m_signed",
      "s_signed",
      "t_engaged_0",
      "t_booked_0",
      "t_booked_1",
      "t_signed_0",
      "e_1",
      "dropped",
    ]);
    const by = new Map(flow().nodes.map((n) => [n.id, n]));
    expect(by.get("t_booked_0")).toMatchObject({
      uses: "trigger.booking",
      with: { on: "booked" },
    });
    expect(by.get("m_booked")?.own?.run).toBe("journey.move");
    expect(by.get("m_booked")?.with).toEqual({ to: "booked" });
    expect(by.get("s_booked")?.own?.run).toBe("journey.stage");
    expect(by.get("s_booked")?.with).toEqual({ stage: "booked" });
    expect(by.get("dropped")?.with).toEqual({ stage: "dropped" });
  });

  it("carries a stage's research to its stage node", () => {
    const by = new Map(flow().nodes.map((n) => [n.id, n]));
    expect(by.get("s_engaged")?.with).toEqual({ stage: "engaged", research: "light" });
    expect(by.get("s_signed")?.with).toEqual({ stage: "signed" });
  });

  it("wires causes to moves, moves to stages, inputs to moves", () => {
    const wires = flow().wires.map((w) => `${w.from} -> ${w.to}`);
    expect(wires).toContain("in.engaged -> m_engaged.journey");
    expect(wires).toContain("in.dropped -> dropped.in");
    expect(wires).toContain("m_booked.moved -> s_booked.in");
    expect(wires).toContain("t_engaged_0.out -> m_engaged.reply");
    expect(wires).toContain("t_booked_0.out -> m_booked.call");
    expect(wires).toContain("t_booked_1.out -> m_booked.document");
    expect(flow().wires.every((w) => w.via === "events")).toBe(true);
  });

  it("turns a funnel entry into a journey trigger wired to its stage", () => {
    const e = flow().nodes.find((n) => n.id === "e_1");
    expect(e).toEqual({
      id: "e_1",
      uses: "trigger.journey",
      with: { funnel: "other", stage: "paid", on: "entered" },
    });
    expect(flow().wires.map((w) => `${w.from} -> ${w.to}`)).toContain(
      "e_1.out -> m_booked.journey",
    );
  });

  it("turns a group entry into a group trigger wired to its stage", () => {
    const b = body({
      entries: [
        { id: "warm", kind: "group", group: "7", to: "booked" },
        { id: "cold", kind: "group", group: "9" },
      ],
    });
    const f = funnelWorkflow("main", 1, b, "wren");
    expect(f.nodes.find((n) => n.id === "e_0")).toEqual({
      id: "e_0",
      uses: "trigger.segment",
      with: { segment: 7, on: "entered" },
    });
    const wires = f.wires.map((w) => `${w.from} -> ${w.to}`);
    expect(wires).toContain("e_0.out -> m_booked.lead");
    // Opens at the first stage by default.
    expect(wires).toContain("e_1.out -> m_engaged.lead");
    expect(f.nodes.find((n) => n.id === "m_booked")?.own?.in.map((p) => p.id)).toContain("lead");
    for (const n of f.nodes) expect(n.id).toMatch(NODE_ID);
    expect(checkWorkflows([f], [])).toEqual([]);
    // A group that is not a number gets no node.
    const bad = body({ entries: [{ id: "x", kind: "group", group: "q-1" }] });
    expect(funnelWorkflow("main", 1, bad, "wren").nodes.some((n) => n.id === "e_0")).toBe(false);
  });

  it("turns a sourced entry into a source trigger wired to its stage", () => {
    const b = body({
      entries: [
        { id: "list", kind: "sourced", source: "import:12", to: "booked" },
        { id: "list2", kind: "sourced", source: "import:13" },
        { id: "none", kind: "sourced" },
      ],
    });
    const f = funnelWorkflow("main", 1, b, "wren");
    expect(f.nodes.find((n) => n.id === "e_0")).toEqual({
      id: "e_0",
      uses: "trigger.source",
      with: { source: "import:12" },
    });
    const wires = f.wires.map((w) => `${w.from} -> ${w.to}`);
    expect(wires).toContain("e_0.out -> m_booked.lead");
    expect(wires).toContain("e_1.out -> m_engaged.lead");
    // A sourced entry that names no source gets no node.
    expect(f.nodes.some((n) => n.id === "e_2")).toBe(false);
    expect(checkWorkflows([f], [])).toEqual([]);
  });

  it("uses the other funnel's sale stage when the entry names none", () => {
    const b = body({
      entries: [{ id: "from_other", kind: "funnel", funnel: { id: "other" } }],
    });
    const sale = (f: string) => (f === "other" ? "paid" : undefined);
    const withSale = funnelWorkflow("main", 1, b, "wren", sale);
    expect(withSale.nodes.find((n) => n.id === "e_0")?.with).toEqual({
      funnel: "other",
      stage: "paid",
      on: "entered",
    });
    // Opens at the first stage by default.
    expect(withSale.wires.map((w) => `${w.from} -> ${w.to}`)).toContain(
      "e_0.out -> m_engaged.journey",
    );
    // No answer, no node: it would hear every stage of the other funnel.
    expect(funnelWorkflow("main", 1, b, "wren").nodes.some((n) => n.id === "e_0")).toBe(false);
  });

  it("gives every node and port a valid id and passes the workflow check", () => {
    const f = flow();
    for (const n of f.nodes) expect(n.id).toMatch(NODE_ID);
    expect(checkWorkflows([f], [])).toEqual([]);
    expect(f.in.map((p) => p.id)).toEqual(["engaged", "booked", "signed", "dropped"]);
    expect(f.in.every((p) => p.kind === "journey")).toBe(true);
  });

  it("gives a move node one input per kind it hears", () => {
    const m = flow().nodes.find((n) => n.id === "m_booked")?.own;
    expect(m?.in.map((p) => `${p.id}:${p.kind}`)).toEqual([
      "journey:journey",
      "call:call",
      "document:document",
    ]);
  });

  it("refuses a trigger with no output", () => {
    const bad = body();
    bad.stages[0] = { key: "engaged", label: "x", on: [{ trigger: "trigger.nope" }] };
    expect(() => funnelWorkflow("main", 1, bad, "wren")).toThrow(/trigger.nope/);
  });

  it("checks a one-stage funnel", () => {
    const one = funnelWorkflow(
      "solo",
      1,
      {
        name: "Solo",
        offer: "o",
        stages: [{ key: "a", label: "A", sale: true, on: [] }],
        entries: [],
      },
      "client",
    );
    expect(checkWorkflows([one], [])).toEqual([]);
  });
});

describe("soundFunnels", () => {
  it("keeps a sound funnel and leaves out one that breaks the check", () => {
    const good = flow();
    const bad = {
      ...funnelWorkflow("odd", 1, body(), "wren"),
      // A wire between two different event kinds.
      wires: [{ from: "t_engaged_0.out", to: "s_signed.in", via: "events" as const }],
    };
    const logged: string[] = [];
    const kept = soundFunnels([good, bad], [], [], (m) => logged.push(m));
    expect(kept.map((f) => f.id)).toEqual(["funnel.main.v2"]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^funnel\.odd\.v1 left out: /);
  });
});
