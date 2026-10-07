import { describe, expect, it } from "vitest";
import { defineComponent } from "./components.js";
import {
  checkWorkflows,
  defineWorkflow,
  effectsIn,
  flowsWith,
  partsIn,
  type Wire,
} from "./workflows.js";

const hypothesis = { from: "a test", guesses: [{ is: "fixed" as const, says: "x" }] };
const part = (id: string, inside: string | null = null) =>
  defineComponent({
    id,
    name: id,
    blurb: id,
    icon: "mail",
    for: "client",
    stage: "reach",
    ready: true,
    hypothesis,
    inside,
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [{ id: "replied", label: "replies", kind: "reply" }],
  });
const flow = (id: string, wires: Wire[], uses = "a") =>
  defineWorkflow({
    id,
    name: id,
    blurb: id,
    icon: "mail",
    for: "client",
    stage: "reach",
    in: [{ id: "leads", label: "leads", kind: "lead" }],
    out: [{ id: "replied", label: "replies", kind: "reply" }],
    nodes: [{ id: "n", uses }],
    wires,
  });
const ok: Wire[] = [
  { from: "in.leads", to: "n.leads", via: "events" },
  { from: "n.replied", to: "out.replied", via: "events", wait: "3 days" },
];

describe("checkWorkflows", () => {
  it("passes a sound workflow, and a part whose inside matches it", () => {
    expect(checkWorkflows([flow("f", ok)], [part("a"), part("b", "f")])).toEqual([]);
  });

  it("names each break", () => {
    const bad = checkWorkflows(
      [
        flow("a", ok),
        flow("kinds", [{ from: "in.leads", to: "out.replied", via: "code" }]),
        flow("wait", [...ok.slice(0, 1), { ...ok[1], wait: "soon" } as Wire]),
        flow("ghost", ok, "nope"),
        flow("loop", ok, "loop"),
      ],
      [part("a"), part("b", "missing")],
    );
    expect(bad).toEqual([
      "a: id taken",
      "b: inside missing is no workflow",
      "kinds: in.leads carries lead, out.replied takes reply",
      'wait: wait "soon" is not "<n> days" or "until <kind>"',
      "ghost.n: uses nope, which isn't one",
      "ghost: n.leads: n has no input leads",
      "ghost: n.replied: n has no output replied",
      "loop: holds itself",
    ]);
  });

  it("finds the parts a workflow runs, through nested workflows, once each", () => {
    const outer = defineWorkflow({
      ...flow("outer", []),
      nodes: [
        { id: "f", uses: "f" },
        { id: "g", uses: "b" },
      ],
    });
    const ids = partsIn("outer", [flow("f", ok), outer], [part("a"), part("b", "f")]).map(
      (c) => c.id,
    );
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("counts a Send webhook node as sending, nested too", () => {
    const hook = defineWorkflow({
      ...flow("hook", []),
      nodes: [
        { id: "n", uses: "a" },
        { id: "post", uses: "logic.webhook", with: { url: "https://api.example.com/x" } },
      ],
    });
    const outer = defineWorkflow({ ...flow("outer", []), nodes: [{ id: "h", uses: "hook" }] });
    const flows = [flow("quiet", ok), hook, outer];
    expect(effectsIn("quiet", flows, [part("a")])).toEqual([]);
    expect(effectsIn("hook", flows, [part("a")])).toEqual(["sends"]);
    expect(effectsIn("outer", flows, [part("a")])).toEqual(["sends"]);
  });
});

describe("flowsWith", () => {
  const step = (run: string) => ({
    id: "hook",
    own: {
      name: "Their CRM",
      blurb: "",
      icon: "code",
      in: [{ id: "replies", label: "replies", kind: "reply" as const }],
      out: [{ id: "replied", label: "replies", kind: "reply" as const }],
      run,
    },
  });
  const code = flow("f", [{ ...(ok[0] as Wire), via: "code" }, ok[1] as Wire]);

  it("keeps built-in wires, swaps the routed ones, adds custom steps", () => {
    const wires: Wire[] = [
      { from: "n.replied", to: "hook.replies", via: "events", when: "they asked", wait: "2 days" },
      { from: "hook.replied", to: "out.replied", via: "events" },
    ];
    const { flows, broken } = flowsWith(
      [code],
      { f: { wires, steps: [step("https://crm.example/in")] } },
      [part("a")],
    );
    expect(broken).toEqual({});
    expect(flows[0]?.nodes.map((n) => n.id)).toEqual(["n", "hook"]);
    expect(flows[0]?.wires).toEqual([code.wires[0], ...wires]);
  });

  it("leaves out a save that breaks, and says why", () => {
    const { flows, broken } = flowsWith(
      [code],
      {
        f: {
          wires: [
            { from: "in.leads", to: "n.leads", via: "code" },
            { from: "n.replied", to: "out.replied", via: "events", wait: "until reply" },
          ],
          steps: [step("crm.push")],
        },
        gone: null,
      },
      [part("a")],
    );
    expect(flows).toEqual([code]);
    expect(broken.f).toEqual([
      "f: in.leads to n.leads is built in, so it can't be rewired yet",
      "f: waits until an event aren't built yet (n.replied to out.replied)",
      "f.hook: an added custom step runs at an https URL",
    ]);
    expect(flowsWith([code], { f: { wires: [], steps: [] } }, [part("a")]).broken.f).toEqual([
      "f: out.replied gets nothing",
    ]);
  });
});
