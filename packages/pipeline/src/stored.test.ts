import { describe, expect, it } from "vitest";
import { ctx, metroShape, shape } from "../test/fixtures.js";
import { graphOf, lowerable, metroOf } from "./convert.js";
import { type MetroBody, placesOf } from "./metro.js";
import { depthOf, type ShapeBody } from "./model.js";
import { Refused } from "./refused.js";
import {
  checkStored,
  diffStored,
  historyOfStored,
  metroView,
  parseStoredChangeKey,
  placesOfStored,
  runDepthsOf,
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

describe("depths and places", () => {
  it("stores graph depths for a graph and places for a metro body", () => {
    expect(placesOfStored(shape())).toEqual(depthOf(shape()));
    expect(placesOfStored(drawn())).toEqual(placesOf(drawn()));
  });

  it("reads the graph depth of a metro body for the runtime", () => {
    expect(runDepthsOf(drawn())).toEqual(depthOf(graphOf(drawn())));
    expect(runDepthsOf(shape())).toEqual(depthOf(shape()));
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

  it("reads a key of either model, and none for a stray word", () => {
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
});
