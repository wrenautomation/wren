import { describe, expect, it } from "vitest";
import { flow, grown, metroShape, shape } from "../test/fixtures.js";
import { changeKey, changesOf, diffShapes, type ShapeChange } from "./diff.js";
import {
  edgeOf,
  ON_GRAPH,
  undoChange,
  undoStoredChange,
  withEdge,
  withNode,
  withoutEdge,
  withoutNode,
} from "./edit.js";
import type { ShapeBody, ShapeNode } from "./model.js";
import { Refused } from "./store.js";

const won: ShapeNode = { id: "won", kind: "step", name: "Won", action: "other", advance: [] };

describe("withNode", () => {
  it("adds a node and its edges, and leaves the old body alone", () => {
    const before = shape();
    const next = withNode(before, won, [flow("standard", "won")]);
    expect(next.nodes.map((n) => n.id)).toContain("won");
    expect(next.edges.map((e) => e.id)).toContain("standard_to_won");
    expect(before.nodes.some((n) => n.id === "won")).toBe(false);
  });

  it("refuses an id in use", () => {
    expect(() => withNode(shape(), { ...won, id: "booked" })).toThrow(Refused);
  });
});

describe("edges", () => {
  it("makes a flow edge with the default id, and a loop edge with its own", () => {
    expect(edgeOf("a", "b")).toEqual({ id: "a_to_b", from: "a", to: "b", kind: "flow" });
    expect(edgeOf("a", "b", { loop: true, label: "again" })).toEqual({
      id: "a_loop_b",
      from: "a",
      to: "b",
      kind: "loop",
      label: "again",
    });
    expect(edgeOf("a", "b", { id: "x" }).id).toBe("x");
  });

  it("connects two nodes", () => {
    const next = withEdge(shape(), edgeOf("proposal", "booked", { loop: true }));
    expect(next.edges.at(-1)).toMatchObject({ id: "proposal_loop_booked", kind: "loop" });
  });

  it("refuses an edge to a node the shape lacks, and an id in use", () => {
    expect(() => withEdge(shape(), edgeOf("booked", "nowhere"))).toThrow(/no node nowhere/);
    expect(() => withEdge(shape(), edgeOf("engaged", "booked"))).toThrow(/already has an edge/);
  });
});

describe("remove", () => {
  it("drops a node with every edge that touches it", () => {
    const next = withoutNode(shape(), "booked");
    expect(next.nodes.some((n) => n.id === "booked")).toBe(false);
    expect(next.edges.some((e) => e.from === "booked" || e.to === "booked")).toBe(false);
    expect(next.edges.length).toBe(shape().edges.length - 2);
  });

  it("drops one edge", () => {
    const next = withoutEdge(shape(), "engaged_to_booked");
    expect(next.edges.some((e) => e.id === "engaged_to_booked")).toBe(false);
    expect(next.nodes).toEqual(shape().nodes);
  });

  it("refuses what is not there", () => {
    expect(() => withoutNode(shape(), "gone")).toThrow(/no node gone/);
    expect(() => withoutEdge(shape(), "gone")).toThrow(/no edge gone/);
  });
});

describe("undoChange", () => {
  const rename = (body: ShapeBody, id: string, name: string): ShapeBody => ({
    ...body,
    nodes: body.nodes.map((n) => (n.id === id ? { ...n, name } : n)),
  });
  const edit = (body: ShapeBody, id: string, over: Partial<ShapeNode>): ShapeBody => ({
    ...body,
    nodes: body.nodes.map((n) => (n.id === id ? ({ ...n, ...over } as ShapeNode) : n)),
  });
  const node = (body: ShapeBody, id: string) => body.nodes.find((n) => n.id === id);
  const edge = (body: ShapeBody, id: string) => body.edges.find((e) => e.id === id);
  const snapshot = (...bodies: ShapeBody[]) => JSON.stringify(bodies);
  const later = /Undo the later change first\./;

  it("puts the shape's name back", () => {
    const a = shape();
    const b = { ...a, name: "Renamed" };
    expect(undoChange(b, a, b, { on: "name" }).name).toBe("Test shape");
    expect(() => undoChange({ ...b, name: "Third" }, a, b, { on: "name" })).toThrow(/Third.*later/);
  });

  it("removes an added node with its edges, and refuses when it is gone", () => {
    const a = shape();
    const b = grown(
      [{ id: "won", kind: "step", name: "Won", action: "other", advance: [] }],
      [flow("standard", "won")],
    );
    const out = undoChange(b, a, b, { on: "node", id: "won", how: "added" });
    expect(node(out, "won")).toBeUndefined();
    expect(edge(out, "standard_to_won")).toBeUndefined();
    expect(() => undoChange(a, a, b, { on: "node", id: "won", how: "added" })).toThrow(
      /Node Won is not in the shape/,
    );
  });

  it("adds a removed node back with the edges whose ends are still there", () => {
    const a = shape();
    const b = withoutNode(a, "booked");
    const out = undoChange(b, a, b, { on: "node", id: "booked", how: "removed" });
    expect(node(out, "booked")).toEqual(node(a, "booked"));
    expect(edge(out, "engaged_to_booked")).toBeDefined();
    expect(edge(out, "booked_to_proposal")).toBeDefined();
    // Newer: "proposal" went too, and an edge id was taken by a new edge.
    const newest = withEdge(
      withoutNode(b, "proposal"),
      edgeOf("yt", "mail", { id: "engaged_to_booked" }),
    );
    const part = undoChange(newest, a, b, { on: "node", id: "booked", how: "removed" });
    expect(node(part, "booked")).toBeDefined();
    expect(edge(part, "booked_to_proposal")).toBeUndefined();
    expect(edge(part, "engaged_to_booked")).toMatchObject({ from: "yt", to: "mail" });
  });

  it("refuses to add back a node whose id is in use again", () => {
    const a = shape();
    const b = withoutNode(a, "standard");
    const newest = withNode(b, {
      id: "standard",
      kind: "plan",
      name: "Again",
      terms: "t",
      advance: [],
    });
    expect(() => undoChange(newest, a, b, { on: "node", id: "standard", how: "removed" })).toThrow(
      /Node Again is in the shape again\. Undo the later change first/,
    );
  });

  it("puts a node's old name back and keeps its other fields", () => {
    const a = shape();
    const b = rename(a, "booked", "Call");
    const newest = edit(b, "booked", { action: "other" } as Partial<ShapeNode>);
    const out = undoChange(newest, a, b, { on: "node", id: "booked", how: "renamed" });
    expect(node(out, "booked")).toMatchObject({ name: "Booked", action: "other" });
    expect(() =>
      undoChange(rename(b, "booked", "Third"), a, b, { on: "node", id: "booked", how: "renamed" }),
    ).toThrow(/Node Call is now called Third.*later/);
    expect(() =>
      undoChange(withoutNode(b, "booked"), a, b, { on: "node", id: "booked", how: "renamed" }),
    ).toThrow(/Node Call is not in the shape/);
  });

  it("puts a node's old fields back and keeps its newest name", () => {
    const a = shape();
    const b = edit(a, "engaged", { action: "other" } as Partial<ShapeNode>);
    const newest = rename(b, "engaged", "Replied");
    const out = undoChange(newest, a, b, { on: "node", id: "engaged", how: "changed" });
    expect(node(out, "engaged")).toEqual({ ...node(a, "engaged"), name: "Replied" });
    const again = edit(b, "engaged", { idleDays: 3 } as Partial<ShapeNode>);
    expect(() => undoChange(again, a, b, { on: "node", id: "engaged", how: "changed" })).toThrow(
      /Node Engaged was changed again.*later/,
    );
  });

  it("removes an added edge only while it stands as it was", () => {
    const a = shape();
    const b = withEdge(a, edgeOf("proposal", "booked", { loop: true }));
    const change: ShapeChange = { on: "edge", id: "proposal_loop_booked", how: "added" };
    expect(edge(undoChange(b, a, b, change), "proposal_loop_booked")).toBeUndefined();
    const newest = {
      ...b,
      edges: b.edges.map((e) => (e.id === change.id ? { ...e, label: "again" } : e)),
    };
    expect(() => undoChange(newest, a, b, change)).toThrow(
      /Edge Proposal to Booked was changed again/,
    );
    expect(() => undoChange(a, a, b, change)).toThrow(/not in the shape any more.*later/);
  });

  it("adds a removed edge back when its id is free and both ends are there", () => {
    const a = shape();
    const b = withoutEdge(a, "engaged_to_booked");
    const change: ShapeChange = { on: "edge", id: "engaged_to_booked", how: "removed" };
    expect(edge(undoChange(b, a, b, change), "engaged_to_booked")).toEqual(
      edge(a, "engaged_to_booked"),
    );
    expect(() => undoChange(a, a, b, change)).toThrow(
      /Edge Engaged to Booked is in the shape again/,
    );
    const noEnd = withoutNode(b, "booked");
    expect(() => undoChange(noEnd, a, b, change)).toThrow(/needs node Booked/);
  });

  it("puts a changed edge back while the newest holds the changed one", () => {
    const a = shape();
    const relabel = (body: ShapeBody, label: string): ShapeBody => ({
      ...body,
      edges: body.edges.map((e) => (e.id === "engaged_to_booked" ? { ...e, label } : e)),
    });
    const b = relabel(a, "yes");
    const change: ShapeChange = { on: "edge", id: "engaged_to_booked", how: "changed" };
    expect(edge(undoChange(b, a, b, change), "engaged_to_booked")).toEqual(
      edge(a, "engaged_to_booked"),
    );
    expect(() => undoChange(relabel(a, "maybe"), a, b, change)).toThrow(later);
  });

  it("refuses a change that is not a line of the diff", () => {
    const a = shape();
    const b = rename(a, "booked", "Call");
    for (const change of [
      { on: "node", id: "booked", how: "changed" },
      { on: "node", id: "yt", how: "renamed" },
      { on: "edge", id: "nowhere", how: "added" },
      { on: "name" },
    ] as ShapeChange[])
      expect(() => undoChange(b, a, b, change)).toThrow(
        /That change is not between these versions\./,
      );
  });

  it("changes none of its inputs", () => {
    const a = shape();
    const b = withoutNode(rename(a, "yt", "Videos"), "booked");
    const newest = rename(b, "yt", "Videos");
    const before = snapshot(newest, a, b);
    for (const c of changesOf(diffShapes(a, b))) {
      try {
        undoChange(newest, a, b, c);
      } catch {
        // A refusal is fine here; the inputs must still be whole.
      }
      expect(snapshot(newest, a, b)).toBe(before);
    }
  });

  it("round trips: each change undone on b gives exactly the inverse line", () => {
    const a = grown([{ id: "side", kind: "step", name: "Side", action: "other", advance: [] }], []);
    let b: ShapeBody = { ...a, name: "Newer name" };
    b = { ...b, nodes: b.nodes.filter((n) => n.id !== "side") };
    b = {
      ...b,
      nodes: [
        ...b.nodes.map((n) => {
          if (n.id === "booked") return { ...n, name: "Call" };
          if (n.id === "engaged") return { ...n, action: "other" as const };
          if (n.id === "signed") return { ...n, name: "Won deal", offer: "offer-b" };
          return n;
        }),
        { id: "won", kind: "step", name: "Won", action: "other", advance: [] } as ShapeNode,
      ],
      edges: [
        ...b.edges
          .filter((e) => e.id !== "yt_to_engaged")
          .map((e) => (e.id === "booked_to_proposal" ? { ...e, label: "soon" } : e)),
        flow("mail", "booked"),
      ],
    };
    const diff = diffShapes(a, b);
    const changes = changesOf(diff);
    // Every kind is in the diff: name, node x4 (one node twice), edge x3.
    expect(changes.map(changeKey).sort()).toEqual(
      [
        "name",
        "node:won:added",
        "node:side:removed",
        "node:booked:renamed",
        "node:signed:renamed",
        "node:signed:changed",
        "node:engaged:changed",
        "edge:mail_to_booked:added",
        "edge:yt_to_engaged:removed",
        "edge:booked_to_proposal:changed",
      ].sort(),
    );
    const inverse = {
      added: "removed",
      removed: "added",
      renamed: "renamed",
      changed: "changed",
    } as const;
    for (const c of changes) {
      const out = undoChange(b, a, b, c);
      const back = diffShapes(b, out);
      const want: ShapeChange =
        c.on === "name"
          ? c
          : c.on === "node"
            ? { ...c, how: inverse[c.how] }
            : { ...c, how: inverse[c.how] };
      expect(changesOf(back).map(changeKey), changeKey(c)).toEqual([changeKey(want)]);
      if (c.on === "name") expect(back.name).toEqual({ from: b.name, to: a.name });
      if (c.on === "node" && c.how === "renamed") {
        const r = diff.nodes.renamed.find((x) => x.id === c.id);
        expect(back.nodes.renamed).toEqual([{ id: c.id, from: r?.to, to: r?.from }]);
      }
    }
  });
});

describe("undoStoredChange guards", () => {
  const g = shape();
  const m = metroShape();

  it("refuses a metro key on a graph newest version", () => {
    for (const change of [
      { on: "station", id: "book", how: "changed" },
      { on: "line", id: "growth", how: "renamed" },
      { on: "group", id: "g", how: "added" },
    ] as const) {
      const run = () => undoStoredChange(g, g, g, change);
      expect(run).toThrow(Refused);
      expect(run).toThrow(ON_GRAPH);
    }
  });

  it("refuses a graph key on a metro newest version", () => {
    expect(() => undoStoredChange(m, g, g, { on: "node", id: "booked", how: "changed" })).toThrow(
      /on the metro model now/,
    );
  });

  it("still undoes a graph key on a graph newest version, and the name", () => {
    const a = g;
    const b = shape({ name: "Other" });
    const out = undoStoredChange(b, a, b, { on: "name" });
    expect((out as ShapeBody).name).toBe(a.name);
  });
});
