import { describe, expect, it } from "vitest";
import { automationRows, triggerWords } from "./automations.js";
import { defineComponent } from "./components.js";
import { defineWorkflow } from "./workflows.js";

const hypothesis = { bet: "x", measure: "y" } as never;
const part = defineComponent({
  id: "texts",
  name: "Texts",
  blurb: "",
  icon: "chat",
  for: "wren",
  stage: "reach",
  ready: true,
  hypothesis,
  provides: { loops: ["SmsSender"] },
});
const mine = defineWorkflow({
  id: "triage",
  name: "Triage",
  blurb: "",
  icon: "mail",
  for: "wren",
  stage: "run",
  in: [{ id: "mail", label: "new mail", kind: "item" }],
  nodes: [],
  wires: [],
});
const theirs = defineWorkflow({ ...mine, id: "client_only", name: "Client only", for: "client" });
const setup = defineWorkflow({ ...mine, id: "setup.x", kind: "setup" });

const base = {
  workflows: [mine, theirs, setup],
  components: [part],
  stats: [],
  made: [],
  loops: [],
  keywords: [],
  replies: {},
};

describe("automationRows", () => {
  it("lists Wren's workflows and any that ran, never setups", () => {
    const rows = automationRows({
      ...base,
      stats: [
        {
          workflow: "client_only",
          runs: 4,
          failed: 1,
          waiting: 2,
          lastAt: "2026-10-01T00:00:00.000Z",
          nextAt: null,
          error: "boom",
        },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["workflow:triage", "workflow:client_only"]);
    const ran = rows[1];
    expect(ran).toMatchObject({ runs: 4, failed: 1, waiting: 2, health: "failing", error: "boom" });
    expect(rows[0]).toMatchObject({ trigger: "Takes in new mail", runs: 0, health: "ok" });
  });

  it("says a made workflow's trigger and its switch", () => {
    const nodes = [{ id: "t", uses: "trigger.booking", with: { on: "booked" } }];
    const rows = automationRows({
      ...base,
      made: [
        {
          id: "made.a",
          made: { name: "A", blurb: "", for: "wren" },
          live: true,
          draft: false,
          off: true,
          nodes,
        },
        {
          id: "made.b",
          made: { name: "B", blurb: "", for: "wren" },
          live: false,
          draft: true,
          off: false,
          nodes: [],
        },
      ],
    });
    const [a, b] = rows;
    expect(a).toMatchObject({ kind: "made", state: "off", ref: "made.a" });
    expect(a?.trigger).toBe(triggerWords({ nodes, in: [] }));
    expect(a?.trigger).not.toBe("No trigger yet");
    expect(b).toMatchObject({ state: "draft", trigger: "No trigger yet" });
  });

  it("folds loops by service, named for the part that owns them", () => {
    const at = (h: number) => `2026-10-14T0${h}:00:00.000Z`;
    const rows = automationRows({
      ...base,
      workflows: [],
      loops: [
        {
          service: "SmsSender",
          key: "a",
          running: true,
          lastAt: at(1),
          failures: 0,
          error: null,
          nextAt: at(5),
        },
        {
          service: "SmsSender",
          key: "b",
          running: true,
          lastAt: at(3),
          failures: 2,
          error: "down",
          nextAt: at(4),
        },
        {
          service: "Other",
          key: "default",
          running: false,
          lastAt: null,
          failures: 0,
          error: null,
          nextAt: null,
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "loop:SmsSender",
      name: "Texts: SMS sender",
      state: "on",
      health: "failing",
      runs: 2,
      failed: 1,
      lastAt: at(3),
      nextAt: at(4),
      error: "down",
    });
    expect(rows[1]).toMatchObject({ id: "loop:Other", state: "off", health: "ok" });
  });

  it("no loop read means no loop rows, not every loop off", () => {
    expect(automationRows({ ...base, workflows: [], loops: null })).toEqual([]);
  });

  it("keywords and auto-replies carry their own state", () => {
    const rows = automationRows({
      ...base,
      workflows: [],
      keywords: [
        {
          id: "7",
          keyword: "GUIDE",
          platform: "any",
          state: "off",
          caught: 3,
          sent: 2,
          failed: 1,
          lastAt: null,
        },
      ],
      replies: { email: "off", text: "suggest", dm: "auto" },
    });
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ["keyword:7", "off"],
      ["reply:email", "off"],
      ["reply:text", "suggest"],
      ["reply:dm", "auto"],
    ]);
    expect(rows[0]).toMatchObject({ runs: 3, failed: 1 });
  });
});
