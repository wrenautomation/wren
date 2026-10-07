import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "./components.js";
import { dryStep, dryWalk, sampleEvent } from "./dry.js";
import { defineWorkflow } from "./workflows.js";

const lead = (id: string) => ({ id, label: id, kind: "lead" as const });
const mail = defineComponent({
  id: "mail",
  name: "Mail",
  blurb: "",
  icon: "mail",
  for: "client",
  stage: "reach",
  ready: true,
  effects: ["sends"],
  hypothesis: { from: "a test", guesses: [{ is: "fixed" as const, says: "x" }] },
  in: [lead("leads")],
  out: [lead("sent"), { id: "replied", label: "replies", kind: "reply" }],
});
const flow = defineWorkflow({
  id: "t",
  name: "T",
  blurb: "",
  icon: "mail",
  for: "client",
  stage: "reach",
  in: [lead("leads")],
  out: [lead("done")],
  nodes: [
    { id: "vip", uses: "logic.if", with: { when: "a vip", kind: "lead" } },
    { id: "m", uses: "mail" },
    { id: "hold", uses: "logic.wait", with: { for: "2 days", kind: "lead" } },
    {
      id: "hook",
      own: {
        name: "Hook",
        blurb: "",
        icon: "code",
        in: [lead("in")],
        out: [lead("out")],
        run: "https://hooks.example.test/x",
      },
    },
  ],
  wires: [
    { from: "in.leads", to: "vip.in", via: "events" },
    { from: "vip.yes", to: "m.leads", via: "events" },
    { from: "vip.no", to: "hold.in", via: "events" },
    { from: "m.sent", to: "hook.in", via: "events" },
    { from: "hook.out", to: "out.done", via: "events" },
    { from: "hold.out", to: "out.done", via: "events" },
  ],
});
const at = {
  flows: new Map([[flow.id, flow]]),
  parts: new Map([[mail.id, mail]]),
  workflow: "t",
  client: null,
};
const one = sampleEvent("lead", { name: "Sam Test" });

afterEach(() => vi.unstubAllGlobals());

describe("dryWalk", () => {
  it("runs logic for real and stubs what sends or posts: nothing leaves", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const r = await dryWalk({ ...at, from: "in.leads", events: [one] });
    expect(r.steps.map((s) => [s.node, s.port, s.would ?? null, s.out.map((o) => o.port)])).toEqual(
      [
        ["vip", "in", null, ["yes"]],
        ["m", "leads", "Would send", ["sent"]],
        ["hook", "in", "Would post to hooks.example.test", ["out"]],
        ["out", "done", null, []],
      ],
    );
    expect(r.steps[0]?.in).toEqual({ name: "Sam Test" });
    expect(r.tally).toMatchObject({ out: 1, failed: 0, waiting: 0 });
    expect(r.capped).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets a wait pass on its own clock, and a rule answers as the test says", async () => {
    const r = await dryWalk({ ...at, from: "in.leads", events: [one], rules: false });
    expect(r.steps.map((s) => [s.node, s.at, s.waited ?? 0])).toEqual([
      ["vip", 0, 0],
      ["hold", 0, 0],
      ["out", 2 * 86_400_000, 2 * 86_400_000],
    ]);
    expect(r.tally).toMatchObject({ out: 1, waiting: 0 });
  });

  it("plays a part's code wires, and enters at a node's output", async () => {
    const coded = defineWorkflow({
      ...flow,
      id: "c",
      wires: [
        { from: "m.sent", to: "hook.in", via: "code" },
        { from: "hook.out", to: "out.done", via: "events" },
      ],
    });
    const r = await dryWalk({
      ...at,
      flows: new Map([[coded.id, coded]]),
      workflow: "c",
      from: "m.sent",
      events: [one],
    });
    expect(r.steps.map((s) => s.node)).toEqual(["hook", "out"]);
  });

  it("stops at its cap", async () => {
    const r = await dryWalk({ ...at, from: "in.leads", events: [one], most: 2 });
    expect(r.steps).toHaveLength(2);
    expect(r.capped).toBe(true);
  });
});

describe("a stub with no output of the event's kind", () => {
  it("sends it down every branch, as that branch's kind", async () => {
    const r = await dryStep({ ...at, node: "m", port: "leads", event: sampleEvent("call") });
    expect(r.steps[0]?.out.map((o) => o.port)).toEqual(["sent", "replied"]);
  });
});

describe("dryStep", () => {
  it("runs one node and nothing after it", async () => {
    const r = await dryStep({ ...at, node: "m", port: "leads", event: one });
    expect(r.steps).toEqual([
      expect.objectContaining({
        node: "m",
        would: "Would send",
        out: [{ port: "sent", data: { name: "Sam Test" } }],
      }),
    ]);
  });
});
