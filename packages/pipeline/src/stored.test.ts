import { describe, expect, it } from "vitest";
import { ctx, metroShape, shape } from "../test/fixtures.js";
import { graphOf, lowerable, metroOf } from "./convert.js";
import type { MetroBody, MetroFlow } from "./metro.js";
import type { ShapeBody } from "./model.js";
import { Refused } from "./refused.js";
import {
  checkStored,
  diffAnswerOf,
  diffStored,
  drawnOf,
  historyOfStored,
  metroView,
  parseStoredChangeKey,
  runOf,
  sameStored,
  storedChangeKey,
  storedChangeLine,
  storedChangeLines,
  storedChangesOf,
} from "./stored.js";

/** The shape fixture, drawn as a metro body. */
const drawn = (): MetroBody => {
  const r = metroOf(shape());
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r.body;
};

const renamed = (m: MetroBody, id: string, label: string): MetroBody => ({
  ...m,
  stations: m.stations.map((s) => (s.id === id ? { ...s, label } : s)),
});

describe("runOf and metroView", () => {
  it("keeps a graph and lowers a metro body", () => {
    const g = shape();
    expect(runOf(g)).toBe(g);
    expect(runOf(drawn())).toEqual(graphOf(drawn()));
  });

  it("keeps a metro body and draws a graph", () => {
    const m = drawn();
    expect(metroView(m)).toBe(m);
    expect(metroView(shape())).toEqual(m);
  });

  it("draws a graph with no attach and no flows", () => {
    const m = metroView(shape());
    expect("flows" in m).toBe(false);
    for (const x of [...m.lines, ...m.stations, ...m.groups]) expect("attach" in x).toBe(false);
  });

  it("lowers a metro body with attach and flows to the graph it had without them", () => {
    const base = drawn();
    const extra: MetroBody = {
      ...base,
      lines: base.lines.map((l) => ({ ...l, attach: [{ kind: "sop", ref: "playbook" }] })),
      flows: [
        {
          id: "spare",
          label: "Spare",
          stations: [
            {
              id: "s1",
              label: "S1",
              kind: "att",
              line: "signed",
              column: "sales",
              action: "other",
            },
          ],
          tracks: [],
        },
      ],
    };
    expect(checkStored(extra, ctx())).toEqual([]);
    expect(runOf(extra)).toEqual(runOf(base));
  });

  it("refuses to draw a graph that has a node called hub", () => {
    const g: ShapeBody = {
      ...shape(),
      nodes: shape().nodes.map((n) => (n.id === "engaged" ? { ...n, id: "hub" } : n)),
      edges: shape().edges.map((e) => ({
        ...e,
        id: e.id.replace("engaged", "hub"),
        from: e.from === "engaged" ? "hub" : e.from,
        to: e.to === "engaged" ? "hub" : e.to,
      })),
    };
    expect(checkStored(g, ctx())).toEqual([]);
    expect(() => metroView(g)).toThrow(Refused);
  });
});

describe("checkStored", () => {
  it("passes what each model passes", () => {
    expect(checkStored(shape(), ctx())).toEqual([]);
    expect(checkStored(drawn(), ctx())).toEqual([]);
  });

  it("gives every reason of a metro body at once", () => {
    const m: MetroBody = { ...metroShape(), name: "" };
    const why = checkStored(m, ctx());
    expect(why).toContain("The shape needs a name.");
    for (const reason of lowerable(m)) expect(why).toContain(reason);
    expect(lowerable(m).length).toBeGreaterThan(0);
  });

  it("gives a fault in attach or in a flow, and refuses a body that links a flow", () => {
    const m = drawn();
    const bad: MetroBody = {
      ...m,
      lines: m.lines.map((l, i) => (i === 0 ? { ...l, attach: [{ kind: "sop", ref: "a b" }] } : l)),
      flows: [{ id: "f", label: "", stations: [], tracks: [] }],
    };
    expect(checkStored(bad, ctx())).toEqual([
      `Line "${m.lines[0]?.id}" attach 1 has a ref with a space in it.`,
      'Flow "f": It needs a label.',
    ]);
    const linked: MetroBody = {
      ...m,
      stations: [
        ...m.stations,
        {
          id: "again",
          label: "Again",
          kind: "link",
          line: "signed",
          column: "delivery",
          flow: "f",
        },
      ],
      flows: [{ id: "f", label: "F", stations: [], tracks: [] }],
    };
    expect(checkStored(linked, ctx())).toEqual([
      'Station "again" is a link station. The runtime does not run it yet.',
    ]);
  });

  it("refuses a trigger the context does not know", () => {
    const m = drawn();
    const bad: MetroBody = {
      ...m,
      stations: m.stations.map((s) =>
        s.id === "engaged" ? { ...s, advance: [{ trigger: "trigger.nope" }] } : s,
      ),
    };
    expect(checkStored(bad, ctx()).join(" ")).toMatch(/trigger\.nope/);
  });
});

describe("sameStored", () => {
  it("ignores key order, and tells a graph from its metro form", () => {
    const g = shape();
    const flipped: ShapeBody = { edges: g.edges, nodes: g.nodes, name: g.name };
    expect(sameStored(g, flipped)).toBe(true);
    expect(sameStored(g, drawn())).toBe(false);
  });
});

describe("sameStored: attach and flows", () => {
  it("tells a body with a flow or an attach from one without", () => {
    const m = drawn();
    const flowed: MetroBody = { ...m, flows: [{ id: "f", label: "F", stations: [], tracks: [] }] };
    expect(sameStored(m, flowed)).toBe(false);
    expect(sameStored(flowed, structuredClone(flowed))).toBe(true);
    const attached = structuredClone(m);
    (attached.lines[0] as MetroBody["lines"][0]).attach = [{ kind: "doc", ref: "d" }];
    expect(sameStored(m, attached)).toBe(false);
  });
});

describe("diffStored", () => {
  it("diffs two graphs as graphs, with graph keys", () => {
    const b = shape();
    b.nodes = b.nodes.map((n) => (n.id === "booked" ? { ...n, name: "Call booked" } : n));
    const d = diffStored(shape(), b);
    expect(d.model).toBe("graph");
    const keys = storedChangesOf(d).map(storedChangeKey);
    expect(keys).toEqual(["node:booked:renamed"]);
  });

  it("diffs a graph against its metro form as no change", () => {
    const d = diffStored(shape(), drawn());
    expect(d.model).toBe("metro");
    expect(storedChangesOf(d)).toEqual([]);
  });

  it("diffs two metro bodies by station, and reads the keys back", () => {
    const a = drawn();
    const b = renamed(a, "booked", "Call booked");
    const d = diffStored(a, b);
    expect(d.model).toBe("metro");
    const [change] = storedChangesOf(d);
    expect(change && storedChangeKey(change)).toBe("station:booked:renamed");
    expect(change && parseStoredChangeKey(storedChangeKey(change))).toEqual(change);
    expect(storedChangeLines(a, b, d)).toEqual(["Renamed station Booked to Call booked."]);
    expect(change && storedChangeLine(a, b, change)).toBe("Renamed station Booked to Call booked.");
  });

  it("diffs a flow and an attach as flow and owner changes, and says each in a line", () => {
    const a = metroShape();
    const b = structuredClone(a);
    (b.flows?.[0] as MetroFlow).label = "Follow up";
    (b.lines.find((l) => l.id === "growth") as MetroBody["lines"][0]).attach = [];
    const d = diffStored(a, b);
    const keys = storedChangesOf(d).map(storedChangeKey);
    expect(keys).toEqual(["line:growth:changed", "flow:shared_followup:renamed"]);
    for (const k of keys) {
      const c = parseStoredChangeKey(k);
      expect(c && storedChangeKey(c)).toBe(k);
    }
    expect(storedChangeLines(a, b, d)).toEqual([
      "Changed line Growth.",
      "Renamed flow Follow-up flow to Follow up.",
    ]);
  });

  it("reads a key of either model, and none for a stray word", () => {
    expect(parseStoredChangeKey("flow:f:added")).toEqual({ on: "flow", id: "f", how: "added" });
    expect(parseStoredChangeKey("node:a:added")).toEqual({ on: "node", id: "a", how: "added" });
    expect(parseStoredChangeKey("track:a_to_b:removed")).toEqual({
      on: "track",
      id: "a_to_b",
      how: "removed",
    });
    expect(parseStoredChangeKey("name")).toEqual({ on: "name" });
    expect(parseStoredChangeKey("later")).toBeNull();
  });
});

describe("historyOfStored", () => {
  const at = new Date("2027-01-01T00:00:00Z");
  const v = (number: number, body: ShapeBody | MetroBody, note: string) => ({
    number,
    body,
    note,
    createdBy: "t",
    createdAt: at,
  });

  it("follows a station across the change of model", () => {
    const m = drawn();
    const versions = [
      v(1, shape(), "graph"),
      v(2, m, "metro"),
      v(3, renamed(m, "booked", "Call booked"), "rename"),
    ];
    const lines = historyOfStored(versions, "booked", "station");
    expect(lines.map((l) => [l.version, l.how])).toEqual([
      [3, "renamed"],
      [1, "added"],
    ]);
  });

  it("follows a node of the graph the runtime runs", () => {
    const m = drawn();
    const versions = [v(1, shape(), "graph"), v(2, renamed(m, "booked", "Call booked"), "rename")];
    expect(historyOfStored(versions, "booked", "node").map((l) => [l.version, l.how])).toEqual([
      [2, "renamed"],
      [1, "added"],
    ]);
  });

  it("follows a flow across versions, and a flow of the graph model has none", () => {
    const m = metroShape();
    const renamedFlow = structuredClone(m);
    (renamedFlow.flows?.[0] as MetroFlow).label = "Follow up";
    const versions = [v(1, m, "first"), v(2, renamedFlow, "rename")];
    expect(
      historyOfStored(versions, "shared_followup", "flow").map((l) => [l.version, l.how]),
    ).toEqual([
      [2, "renamed"],
      [1, "added"],
    ]);
    expect(historyOfStored([v(1, shape(), "graph")], "shared_followup", "flow")).toEqual([]);
  });
});

describe("diffAnswerOf", () => {
  const base = shape();
  const renamedBooked = (): ShapeBody => ({
    ...base,
    nodes: base.nodes.map((n) => (n.id === "booked" ? { ...n, name: "Call booked" } : n)),
  });

  it("answers two graphs with graph keys, both sides drawn and the marks", () => {
    const a = diffAnswerOf(base, renamedBooked());
    expect(a.diff.model).toBe("graph");
    expect(a.changes).toEqual([
      { key: "node:booked:renamed", line: "Renamed node Booked to Call booked." },
    ]);
    expect(a.views?.[0]).toEqual(metroView(base));
    expect(a.views?.[1].stations.find((s) => s.id === "booked")?.label).toBe("Call booked");
    expect(a.marks?.stations.renamed.map((r) => r.id)).toEqual(["booked"]);
  });

  it("answers a graph against a metro body with metro keys", () => {
    const m = renamed(drawn(), "booked", "Call booked");
    const a = diffAnswerOf(base, m);
    expect(a.diff.model).toBe("metro");
    expect(a.changes.map((c) => c.key)).toEqual(["station:booked:renamed"]);
    expect(a.views?.[0]).toEqual(drawn());
    expect(a.views?.[1]).toBe(m);
  });

  it("keys two graphs as metro when the newest version is metro", () => {
    const a = diffAnswerOf(base, renamedBooked(), true);
    expect(a.diff.model).toBe("metro");
    expect(a.changes).toEqual([
      { key: "station:booked:renamed", line: "Renamed station Booked to Call booked." },
    ]);
    // A graph that cannot be drawn keeps its graph keys.
    const hub = (name: string): ShapeBody => ({
      ...base,
      nodes: [...base.nodes, { id: "hub", kind: "step", name, action: "reply", advance: [] }],
    });
    expect(diffAnswerOf(hub("Hub"), hub("Hub two"), true).diff.model).toBe("graph");
  });

  it("keeps the diff and the lines when a side cannot be drawn", () => {
    const hub = (name: string): ShapeBody => ({
      ...base,
      nodes: [...base.nodes, { id: "hub", kind: "step", name, action: "reply", advance: [] }],
    });
    expect(drawnOf(hub("Hub"))).toMatchObject({ ok: false });
    const a = diffAnswerOf(hub("Hub"), hub("Hub two"));
    expect(a.views).toBeNull();
    expect(a.marks).toBeNull();
    expect(a.diff.model).toBe("graph");
    expect(a.changes.map((c) => c.key)).toEqual(["node:hub:renamed"]);
  });
});
